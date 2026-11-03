import type { QualityProfile } from '@server/api/servarr/base';
import ServarrBase from '@server/api/servarr/base';
import { MediaRequestStatus, MediaType } from '@server/constants/media';
import type Media from '@server/entity/Media';
import type { DVRSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import type {
  ArrFormatSpec,
  CoverageFile,
  CoverageKey,
  CoverageVersionInput,
  DefiningMatch,
  VersionCoverageResult,
  VersionFileSummary,
} from '@server/lib/versionCoverage';
import {
  canBeCovered,
  computeCoverage,
  languageOnlyFormat,
  sanitizeCoverageMode,
  suggestDefiningFormats,
  summarizeFiles,
} from '@server/lib/versionCoverage';
import { getVersionRules } from '@server/lib/versions';
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
  /** Show: the episode numbers this version has a file for, per season. */
  seasonEpisodes?: Record<number, number[]>;
  coverage: VersionCoverageResult;
}

export interface MediaVersionsResponse {
  versions: VersionDetails[];
}

/** One version's file of an episode. */
export interface EpisodeVersion {
  key: CoverageKey;
  label?: string;
  summary: VersionFileSummary;
}

export interface SeasonEpisodeVersionsResponse {
  /** Episodes at least one version has a file for, in episode order. */
  episodes: { episodeNumber: number; versions: EpisodeVersion[] }[];
}

interface ArrFile {
  id?: number;
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
  specifications?: ArrFormatSpec[];
}

interface ArrEpisode {
  seasonNumber: number;
  episodeNumber: number;
  hasFile?: boolean;
  episodeFileId?: number;
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

  public async episodes(seriesId: number): Promise<ArrEpisode[]> {
    return this.get<ArrEpisode[]>(
      '/episode',
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

/**
 * What the file details show of a profile: the custom formats it rewards,
 * except formats that only test an audio language (e.g. "German audio").
 * Those repeat the language list, so their languages are marked instead.
 */
const displayOptions = (
  profile: ArrProfile | undefined,
  formats: CustomFormat[],
  files: ArrFile[]
): { positiveFormats: string[]; scoredLanguages: string[] } => {
  const byId = new Map(formats.map((f) => [f.id, f]));
  const positiveFormats: string[] = [];
  const languageIds = new Set<number>();
  for (const item of profile?.formatItems ?? []) {
    if (item.score <= 0) {
      continue;
    }
    const format = byId.get(item.format);
    const languages = languageOnlyFormat(format?.specifications);
    if (languages) {
      languages.forEach((id) => languageIds.add(id));
      continue;
    }
    const name = format?.name ?? item.name;
    if (name) {
      positiveFormats.push(name);
    }
  }
  const scoredLanguages = new Set<string>();
  for (const file of files) {
    for (const language of file.languages ?? []) {
      if (languageIds.has(language.id)) {
        scoredLanguages.add(language.name);
      }
    }
  }
  return { positiveFormats, scoredLanguages: [...scoredLanguages] };
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

/** Episode numbers with a file, per season, in episode order. */
const episodesBySeason = (episodes: ArrEpisode[]): Record<number, number[]> => {
  const bySeason: Record<number, number[]> = {};
  for (const episode of episodes) {
    if (episode.hasFile) {
      (bySeason[episode.seasonNumber] ??= []).push(episode.episodeNumber);
    }
  }
  for (const list of Object.values(bySeason)) {
    list.sort((a, b) => a - b);
  }
  return bySeason;
};

/**
 * Per-version file summaries and coverage for a title. Versions whose
 * instance cannot be reached are listed without a summary and never cover
 * anything. With `withEpisodes`, a show's versions also list the episodes
 * they hold, so a season split across versions can be shown as such.
 */
export const getMediaVersions = async (
  media: Media,
  now = new Date(),
  { withEpisodes = false }: { withEpisodes?: boolean } = {}
): Promise<MediaVersionsResponse> => {
  const type = media.mediaType === MediaType.MOVIE ? 'radarr' : 'sonarr';
  const servers = versionServers(type, media);
  if (servers.length < 2) {
    return { versions: [] };
  }
  const holdMs = getVersionRules().holdHours * 60 * 60 * 1000;
  const recentSince = now.getTime() - holdMs;

  const gathered = await Promise.all(
    servers.map(async (version) => {
      const input: CoverageVersionInput = {
        key: version.key,
        label: version.label,
        definingFormats: version.server.definingFormats ?? [],
        definingMatch: version.server.definingMatch ?? 'all',
        coverageMode: sanitizeCoverageMode(version.server.coverageMode),
        instanceFormats: [],
      };
      const requests = openRequests(media, version).filter(
        (r) => new Date(r.createdAt).getTime() > recentSince
      );
      let summary: VersionFileSummary | undefined;
      let seasonSummaries: Record<number, VersionFileSummary> | undefined;
      let seasonEpisodes: Record<number, number[]> | undefined;

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
              ...displayOptions(profile, formats, [file]),
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
              ...displayOptions(profile, formats, files),
              originalLanguage: series.originalLanguage?.name,
            };
            summary = summarizeFiles(files.map(toInputFile), options);
            seasonSummaries = Object.fromEntries(
              Object.entries(bySeason).map(([season, list]) => [
                Number(season),
                summarizeFiles(list.map(toInputFile), options),
              ])
            );
            if (withEpisodes) {
              seasonEpisodes = episodesBySeason(
                await client.episodes(series.id)
              );
            }
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

      return { version, input, summary, seasonSummaries, seasonEpisodes };
    })
  );

  const coverage = computeCoverage(
    gathered.map((g) => g.input),
    { mediaType: type === 'radarr' ? 'movie' : 'tv', now, holdMs }
  );

  return {
    versions: gathered.map(
      ({ version, summary, seasonSummaries, seasonEpisodes }, i) => ({
        key: version.key,
        label: version.label,
        serverId: version.serverId,
        summary,
        seasonSummaries,
        seasonEpisodes,
        coverage: coverage[i],
      })
    ),
  };
};

/**
 * Which versions hold each episode of a season, with what each file
 * contains. A version whose instance cannot be reached is left out.
 */
export const getSeasonEpisodeVersions = async (
  media: Media,
  seasonNumber: number
): Promise<SeasonEpisodeVersionsResponse> => {
  const tvdbId = media.tvdbId;
  if (media.mediaType !== MediaType.TV || !tvdbId) {
    return { episodes: [] };
  }
  const servers = versionServers('sonarr', media);
  if (servers.length < 2) {
    return { episodes: [] };
  }

  const perVersion = await Promise.all(
    servers.map(async (version) => {
      try {
        const client = clientFor(version.server, 'sonarr');
        const series = await client.seriesByTvdbId(tvdbId);
        if (!series) {
          return [];
        }
        const [formats, profiles, files, episodes] = await Promise.all([
          client.customFormats(),
          client.profiles(),
          client.episodeFiles(series.id),
          client.episodes(series.id),
        ]);
        const seasonFiles = files.filter(
          (file) => (file.seasonNumber ?? 0) === seasonNumber
        );
        const profile = profiles.find((p) => p.id === series.qualityProfileId);
        const options = {
          ...displayOptions(profile, formats, seasonFiles),
          originalLanguage: series.originalLanguage?.name,
        };
        const filesById = new Map(
          seasonFiles
            .filter((file) => file.id != null)
            .map((file) => [file.id, file])
        );
        return episodes
          .filter((e) => e.seasonNumber === seasonNumber && e.hasFile)
          .flatMap((episode) => {
            const file = filesById.get(episode.episodeFileId);
            return file
              ? [
                  {
                    episodeNumber: episode.episodeNumber,
                    version: {
                      key: version.key,
                      label: version.label,
                      summary: summarizeFiles([toInputFile(file)], options),
                    },
                  },
                ]
              : [];
          });
      } catch (e) {
        logger.warn('Could not read version episodes', {
          label: 'Versions',
          version: version.key,
          mediaId: media.id,
          seasonNumber,
          errorMessage: e.message,
        });
        return [];
      }
    })
  );

  const byEpisode = new Map<number, EpisodeVersion[]>();
  for (const entries of perVersion) {
    for (const { episodeNumber, version } of entries) {
      byEpisode.set(episodeNumber, [
        ...(byEpisode.get(episodeNumber) ?? []),
        version,
      ]);
    }
  }
  return {
    episodes: [...byEpisode.entries()]
      .sort(([a], [b]) => a - b)
      .map(([episodeNumber, versions]) => ({ episodeNumber, versions })),
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
  if (!target || !canBeCovered(target)) {
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
