import type { QualityProfile } from '@server/api/servarr/base';
import ServarrBase from '@server/api/servarr/base';
import { MediaRequestStatus, MediaType } from '@server/constants/media';
import type Media from '@server/entity/Media';
import type { DVRSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import type {
  CoverageFile,
  CoverageKey,
  CoverageVersionInput,
  DefiningMatch,
  VersionCoverageResult,
  VersionFileSummary,
} from '@server/lib/versionCoverage';
import {
  REQUEST_HOLD_MS,
  computeCoverage,
  suggestDefiningFormats,
  summarizeFiles,
} from '@server/lib/versionCoverage';
import logger from '@server/logger';

// VSeerr: reads each version's files from Radarr/Sonarr to show what they
// contain and to work out which versions cover each other. See
// versionCoverage.ts for the rules.

/** Arr lookups are cached briefly, so a busy details page stays cheap. */
const CACHE_TTL = 120;

export interface VersionDetails {
  key: CoverageKey;
  label?: string;
  serverId?: number;
  summary?: VersionFileSummary;
  /** Show: per season. */
  seasonSummaries?: Record<number, VersionFileSummary>;
  coverage: VersionCoverageResult;
}

export interface MediaVersionsResponse {
  versions: VersionDetails[];
}

interface ArrFile {
  seasonNumber?: number;
  quality?: { quality?: { resolution?: number } };
  customFormats?: { id: number; name: string }[];
  languages?: { id: number; name: string }[];
}

interface ArrItem {
  id: number;
  qualityProfileId: number;
  originalLanguage?: { id: number; name: string };
  hasFile?: boolean;
  movieFile?: ArrFile;
  seasons?: {
    seasonNumber: number;
    monitored?: boolean;
    statistics?: { episodeFileCount?: number; episodeCount?: number };
  }[];
}

interface CustomFormat {
  id: number;
  name: string;
}

type ArrProfile = QualityProfile & {
  minFormatScore?: number;
  formatItems?: { format: number; name?: string; score: number }[];
};

/**
 * A narrow read-only client. ServarrBase's protected `get` caches per
 * instance URL, so two instances never share entries.
 */
class CoverageClient extends ServarrBase<Record<string, never>> {
  public async customFormats(): Promise<CustomFormat[]> {
    return this.get<CustomFormat[]>('/customformat', undefined, CACHE_TTL);
  }

  public async profiles(): Promise<ArrProfile[]> {
    return this.get<ArrProfile[]>('/qualityprofile', undefined, CACHE_TTL);
  }

  public async movieByTmdbId(tmdbId: number): Promise<ArrItem | undefined> {
    const movies = await this.get<ArrItem[]>(
      '/movie',
      { params: { tmdbId } },
      CACHE_TTL
    );
    return movies[0];
  }

  public async movieFile(movieId: number): Promise<ArrFile | undefined> {
    const files = await this.get<ArrFile[]>(
      '/moviefile',
      { params: { movieId } },
      CACHE_TTL
    );
    return files[0];
  }

  public async seriesByTvdbId(tvdbId: number): Promise<ArrItem | undefined> {
    const series = await this.get<ArrItem[]>(
      '/series',
      { params: { tvdbId } },
      CACHE_TTL
    );
    return series[0];
  }

  public async episodeFiles(seriesId: number): Promise<ArrFile[]> {
    return this.get<ArrFile[]>(
      '/episodefile',
      { params: { seriesId } },
      CACHE_TTL
    );
  }
}

const clientFor = (server: DVRSettings, type: 'radarr' | 'sonarr') =>
  new CoverageClient({
    url: ServarrBase.buildUrl(server, '/api/v3'),
    apiKey: server.apiKey,
    cacheName: type,
    apiName: type === 'radarr' ? 'Radarr' : 'Sonarr',
  });

/**
 * Custom format names of an instance, and the suggested defining formats
 * of each quality profile (Settings → Services).
 */
export const listCustomFormats = async (
  server: DVRSettings,
  type: 'radarr' | 'sonarr'
): Promise<{
  customFormats: string[];
  definingSuggestions: Record<
    number,
    { formats: string[]; match: DefiningMatch }
  >;
}> => {
  const client = clientFor(server, type);
  const [formats, profiles] = await Promise.all([
    client.customFormats(),
    client.profiles(),
  ]);
  const names = new Map(formats.map((f) => [f.id, f.name]));
  return {
    customFormats: formats.map((f) => f.name),
    definingSuggestions: Object.fromEntries(
      profiles.map((profile) => [
        profile.id,
        suggestDefiningFormats({
          minFormatScore: profile.minFormatScore,
          formatItems: (profile.formatItems ?? []).map((item) => ({
            name: names.get(item.format) ?? item.name,
            score: item.score,
          })),
        }),
      ])
    ),
  };
};

const fileFormats = (file: ArrFile): string[] =>
  (file.customFormats ?? []).map((format) => format.name);

const toInputFile = (file: ArrFile) => ({
  resolution: file.quality?.quality?.resolution,
  formats: fileFormats(file),
  languages: (file.languages ?? []).map((language) => language.name),
});

const positiveFormats = (
  profile: ArrProfile | undefined,
  formats: CustomFormat[]
): string[] => {
  const names = new Map(formats.map((f) => [f.id, f.name]));
  return (profile?.formatItems ?? [])
    .filter((item) => item.score > 0)
    .map((item) => names.get(item.format) ?? item.name ?? '')
    .filter(Boolean);
};

interface VersionServer {
  key: CoverageKey;
  label?: string;
  serverId?: number;
  server: DVRSettings;
}

/**
 * The standard (non-4K) server that holds the title, then every version.
 * A title in the standard version may live on any non-version server.
 */
const versionServers = (
  type: 'radarr' | 'sonarr',
  media: Pick<Media, 'serviceId'>
): VersionServer[] => {
  const servers = getSettings()[type].filter((s) => !s.is4k);
  const standard =
    servers.find((s) => s.id === media.serviceId && !s.buttonLabel?.trim()) ??
    servers.find((s) => s.isDefault && !s.buttonLabel?.trim());
  const versions = servers
    .filter((s) => !!s.buttonLabel?.trim())
    .map((s) => ({
      key: `${type}:${s.id}`,
      label: s.buttonLabel?.trim(),
      serverId: s.id,
      server: s,
    }));
  return standard
    ? [{ key: 'standard', server: standard }, ...versions]
    : versions;
};

const OPEN_REQUEST = [MediaRequestStatus.PENDING, MediaRequestStatus.APPROVED];

const openRequests = (media: Media, version: VersionServer) =>
  (media.requests ?? []).filter(
    (request) =>
      !request.is4k &&
      OPEN_REQUEST.includes(request.status) &&
      (version.serverId == null
        ? !request.isServiceRequest
        : request.isServiceRequest && request.serverId === version.serverId)
  );

const newest = (dates: Date[]): Date | null =>
  dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;

/**
 * Per-version file summaries and coverage for a title. Versions whose
 * instance cannot be reached are listed without a summary and never cover
 * anything.
 */
export const getMediaVersions = async (
  media: Media,
  now = new Date()
): Promise<MediaVersionsResponse> => {
  const type = media.mediaType === MediaType.MOVIE ? 'radarr' : 'sonarr';
  const servers = versionServers(type, media);
  if (servers.length < 2) {
    return { versions: [] };
  }
  const recentSince = now.getTime() - REQUEST_HOLD_MS;

  const gathered = await Promise.all(
    servers.map(async (version) => {
      const input: CoverageVersionInput = {
        key: version.key,
        label: version.label,
        definingFormats: version.server.definingFormats ?? [],
        definingMatch: version.server.definingMatch ?? 'all',
        instanceFormats: [],
      };
      const requests = openRequests(media, version).filter(
        (r) => new Date(r.createdAt).getTime() > recentSince
      );
      let summary: VersionFileSummary | undefined;
      let seasonSummaries: Record<number, VersionFileSummary> | undefined;

      try {
        const client = clientFor(version.server, type);
        const [formats, profiles] = await Promise.all([
          client.customFormats(),
          client.profiles(),
        ]);
        input.instanceFormats = formats.map((f) => f.name);

        if (type === 'radarr') {
          const movie = await client.movieByTmdbId(media.tmdbId);
          const file =
            movie?.hasFile && movie.id
              ? await client.movieFile(movie.id)
              : undefined;
          input.file = file
            ? ({ formats: fileFormats(file) } as CoverageFile)
            : null;
          input.openRequestAt = newest(
            requests.map((r) => new Date(r.createdAt))
          );
          if (movie && file) {
            const profile = profiles.find(
              (p) => p.id === movie.qualityProfileId
            );
            summary = summarizeFiles([toInputFile(file)], {
              positiveFormats: positiveFormats(profile, formats),
              originalLanguage: movie.originalLanguage?.name,
            });
          }
        } else {
          const series = media.tvdbId
            ? await client.seriesByTvdbId(media.tvdbId)
            : undefined;
          const files = series ? await client.episodeFiles(series.id) : [];
          const bySeason: Record<number, ArrFile[]> = {};
          for (const file of files) {
            const season = file.seasonNumber ?? 0;
            (bySeason[season] ??= []).push(file);
          }
          input.seasonFiles = Object.fromEntries(
            Object.entries(bySeason).map(([season, list]) => [
              Number(season),
              list.map((file) => ({ formats: fileFormats(file) })),
            ])
          );
          input.completeSeasons = (series?.seasons ?? [])
            .filter(
              (s) =>
                (s.statistics?.episodeCount ?? 0) > 0 &&
                (s.statistics?.episodeFileCount ?? 0) >=
                  (s.statistics?.episodeCount ?? 0)
            )
            .map((s) => s.seasonNumber);
          const openSeasons: Record<number, Date> = {};
          for (const request of requests) {
            for (const season of request.seasons ?? []) {
              const at = new Date(request.createdAt);
              const known = openSeasons[season.seasonNumber];
              if (!known || at > known) {
                openSeasons[season.seasonNumber] = at;
              }
            }
          }
          input.openSeasonRequestAt = openSeasons;
          if (series && files.length > 0) {
            const profile = profiles.find(
              (p) => p.id === series.qualityProfileId
            );
            const options = {
              positiveFormats: positiveFormats(profile, formats),
              originalLanguage: series.originalLanguage?.name,
            };
            summary = summarizeFiles(files.map(toInputFile), options);
            seasonSummaries = Object.fromEntries(
              Object.entries(bySeason).map(([season, list]) => [
                Number(season),
                summarizeFiles(list.map(toInputFile), options),
              ])
            );
          }
        }
      } catch (e) {
        logger.warn('Could not read version files', {
          label: 'Versions',
          version: version.key,
          mediaId: media.id,
          errorMessage: e.message,
        });
        input.file = undefined;
        input.seasonFiles = undefined;
      }

      return { version, input, summary, seasonSummaries };
    })
  );

  const coverage = computeCoverage(
    gathered.map((g) => g.input),
    { mediaType: type === 'radarr' ? 'movie' : 'tv', now }
  );

  return {
    versions: gathered.map(({ version, summary, seasonSummaries }, i) => ({
      key: version.key,
      label: version.label,
      serverId: version.serverId,
      summary,
      seasonSummaries,
      coverage: coverage[i],
    })),
  };
};

/**
 * Whether a request for this version is held back for users without Manage
 * Requests: another version covers it, or another version's fresh request
 * may. For a show, `seasons` lists the held-back seasons.
 */
export const coverageBlock = async ({
  media,
  serverId,
  isServiceRequest,
  now = new Date(),
}: {
  media: Media;
  serverId?: number;
  isServiceRequest: boolean;
  now?: Date;
}): Promise<{ message: string; seasons?: number[] } | undefined> => {
  const type = media.mediaType === MediaType.MOVIE ? 'radarr' : 'sonarr';
  const servers = getSettings()[type];
  const target = isServiceRequest
    ? servers.find((s) => s.id === serverId)
    : servers.find(
        (s) =>
          !s.is4k &&
          !s.buttonLabel?.trim() &&
          (s.id === media.serviceId || s.isDefault)
      );
  if (!target || !(target.definingFormats ?? []).length) {
    return undefined;
  }

  const { versions } = await getMediaVersions(media, now);
  const key = isServiceRequest ? `${type}:${serverId}` : 'standard';
  const coverage = versions.find((v) => v.key === key)?.coverage;
  if (!coverage) {
    return undefined;
  }
  const name = (ref: { label?: string }) => ref.label ?? 'Standard';

  if (media.mediaType === MediaType.MOVIE) {
    if (coverage.coveredBy) {
      return {
        message: `This title is already available in this version through ${name(coverage.coveredBy)}.`,
      };
    }
    if (coverage.requestedVia) {
      return {
        message: `This title was just requested in ${name(coverage.requestedVia)}, which may cover this version.`,
      };
    }
    return undefined;
  }

  const blocked = Object.entries(coverage.seasons ?? {})
    .filter(([, state]) => state.coveredBy || state.requestedVia)
    .map(([season]) => Number(season));
  return blocked.length > 0
    ? {
        message: 'Some seasons are already covered by another version.',
        seasons: blocked,
      }
    : undefined;
};
