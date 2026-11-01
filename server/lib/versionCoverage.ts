// VSeerr version coverage. Each Radarr/Sonarr server can list "defining
// formats": custom format names that make a file count as that version (for
// example "Russian audio" for a Russian version). When another version's
// file matches all of them, the version is covered: it shows as available
// through the other version, and only request managers can request it.
// While another version's request is younger than a day and has no file
// yet, the version is held back too, because that file may cover it.
//
// This file is shared by the server and the request dialog, so it must stay
// free of server-only imports.

/** How long a fresh request in one version holds back the others. */
export const REQUEST_HOLD_MS = 24 * 60 * 60 * 1000;

export const MAX_DEFINING_FORMATS = 20;
const MAX_FORMAT_NAME = 100;

/** `standard`, or `radarr:<id>` / `sonarr:<id>`. */
export type CoverageKey = string;

/** Whether a file needs all of the defining formats or any one of them. */
export type DefiningMatch = 'all' | 'any';

export interface CoverageRef {
  key: CoverageKey;
  /** The version name; undefined for the standard version. */
  label?: string;
}

/** What a version's files contain, as shown to users. */
export interface VersionFileSummary {
  /** Number of files (1 for a movie, episode files for a show). */
  files: number;
  /** E.g. `2160p`, lowest first. */
  resolutions: string[];
  /** Custom formats that score above zero in the item's profile. */
  formats: { name: string; files: number }[];
  /** Audio languages; `original` marks the title's original language. */
  languages: { name: string; files: number; original: boolean }[];
}

/** Matched custom formats of one file. */
export interface CoverageFile {
  formats: string[];
}

/** Input for one version (the standard one included). */
export interface CoverageVersionInput extends CoverageRef {
  definingFormats: string[];
  definingMatch?: DefiningMatch;
  /** Custom format names that exist in this version's instance. */
  instanceFormats: string[];
  /** Movie: the file, or null when there is none. */
  file?: CoverageFile | null;
  /** Show: episode files per season. */
  seasonFiles?: Record<number, CoverageFile[]>;
  /** Show: seasons whose monitored episodes all have files. */
  completeSeasons?: number[];
  /** Movie: when the newest open request in this version was made. */
  openRequestAt?: Date | null;
  /** Show: the same, per season. */
  openSeasonRequestAt?: Record<number, Date>;
}

export interface CoverageHold extends CoverageRef {
  /** ISO time when the hold ends and the file decides. */
  until: string;
}

export interface VersionCoverageState {
  coveredBy?: CoverageRef;
  requestedVia?: CoverageHold;
}

export interface VersionCoverageResult extends CoverageRef {
  definingFormats: string[];
  definingMatch: DefiningMatch;
  /** Movie only. */
  coveredBy?: CoverageRef;
  requestedVia?: CoverageHold;
  /** Show only: per season. */
  seasons?: Record<number, VersionCoverageState>;
}

const normalize = (name: string) => name.trim().toLowerCase();

/** Keeps unique, trimmed, non-empty names, up to the limit. */
export const sanitizeDefiningFormats = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const name = item.trim().slice(0, MAX_FORMAT_NAME);
    if (!name || seen.has(normalize(name))) {
      continue;
    }
    seen.add(normalize(name));
    result.push(name);
    if (result.length >= MAX_DEFINING_FORMATS) {
      break;
    }
  }
  return result;
};

export const sanitizeDefiningMatch = (value: unknown): DefiningMatch =>
  value === 'any' ? 'any' : 'all';

/**
 * Suggests defining formats from a quality profile, using its minimum
 * custom format score (Radarr's and Sonarr's own "must have"):
 * - formats a release cannot reach the minimum without, all required;
 * - otherwise formats that reach the minimum on their own, any one of them.
 */
export const suggestDefiningFormats = (profile?: {
  minFormatScore?: number;
  formatItems?: { name?: string; score?: number }[];
}): { formats: string[]; match: DefiningMatch } => {
  const minimum = profile?.minFormatScore ?? 0;
  if (!profile?.formatItems || minimum <= 0) {
    return { formats: [], match: 'all' };
  }
  const positive = profile.formatItems.filter(
    (item): item is { name: string; score: number } =>
      !!item.name && (item.score ?? 0) > 0
  );
  const total = positive.reduce((sum, item) => sum + item.score, 0);
  const required = positive
    .filter((item) => total - item.score < minimum)
    .map((item) => item.name);
  if (required.length > 0) {
    return { formats: required, match: 'all' };
  }
  // Otherwise a file needs any one format that reaches the minimum alone,
  // or with the smallest bonus (a format split into "Atmos (not Remux)" 40
  // plus "Atmos" 5 still reaches 45).
  const smallest = Math.min(...positive.map((item) => item.score));
  return {
    formats: positive
      .filter((item) => item.score + smallest >= minimum)
      .map((item) => item.name),
    match: 'any',
  };
};

/** Whether a file has the defining formats. */
export const fileMatches = (
  file: CoverageFile,
  definingFormats: string[],
  match: DefiningMatch = 'all'
): boolean => {
  const formats = new Set(file.formats.map(normalize));
  const has = (name: string) => formats.has(normalize(name));
  return match === 'any'
    ? definingFormats.some(has)
    : definingFormats.every(has);
};

/** Whether an instance knows the defining formats, so it could cover. */
const canCover = (
  holder: CoverageVersionInput,
  definingFormats: string[],
  match: DefiningMatch
) => {
  const names = new Set(holder.instanceFormats.map(normalize));
  const known = (name: string) => names.has(normalize(name));
  return match === 'any'
    ? definingFormats.some(known)
    : definingFormats.every(known);
};

const ref = ({ key, label }: CoverageRef): CoverageRef =>
  label ? { key, label } : { key };

const holdFrom = (
  holder: CoverageVersionInput,
  requestedAt: Date | null | undefined,
  now: Date
): CoverageHold | undefined => {
  if (!requestedAt) {
    return undefined;
  }
  const until = requestedAt.getTime() + REQUEST_HOLD_MS;
  if (until <= now.getTime()) {
    return undefined;
  }
  return { ...ref(holder), until: new Date(until).toISOString() };
};

/** Works out, for every version, whether another version covers it. */
export const computeCoverage = (
  versions: CoverageVersionInput[],
  { mediaType, now = new Date() }: { mediaType: 'movie' | 'tv'; now?: Date }
): VersionCoverageResult[] =>
  versions.map((target) => {
    const match = target.definingMatch ?? 'all';
    const result: VersionCoverageResult = {
      ...ref(target),
      definingFormats: target.definingFormats,
      definingMatch: match,
    };
    const defining = target.definingFormats;
    if (defining.length === 0) {
      return result;
    }
    const others = versions.filter((v) => v.key !== target.key);

    if (mediaType === 'movie') {
      if (target.file) {
        return result;
      }
      const cover = others.find(
        (other) => other.file && fileMatches(other.file, defining, match)
      );
      if (cover) {
        result.coveredBy = ref(cover);
        return result;
      }
      for (const other of others) {
        const hold =
          !other.file && canCover(other, defining, match)
            ? holdFrom(other, other.openRequestAt, now)
            : undefined;
        if (hold) {
          result.requestedVia = hold;
          break;
        }
      }
      return result;
    }

    const seasonNumbers = new Set<number>();
    for (const other of others) {
      for (const n of Object.keys(other.seasonFiles ?? {})) {
        seasonNumbers.add(Number(n));
      }
      for (const n of Object.keys(other.openSeasonRequestAt ?? {})) {
        seasonNumbers.add(Number(n));
      }
    }

    const seasons: Record<number, VersionCoverageState> = {};
    for (const season of [...seasonNumbers].sort((a, b) => a - b)) {
      if ((target.seasonFiles?.[season] ?? []).length > 0) {
        continue;
      }
      const cover = others.find((other) => {
        const files = other.seasonFiles?.[season] ?? [];
        return (
          files.length > 0 &&
          (other.completeSeasons ?? []).includes(season) &&
          files.every((file) => fileMatches(file, defining, match))
        );
      });
      if (cover) {
        seasons[season] = { coveredBy: ref(cover) };
        continue;
      }
      for (const other of others) {
        const hold =
          (other.seasonFiles?.[season] ?? []).length === 0 &&
          canCover(other, defining, match)
            ? holdFrom(other, other.openSeasonRequestAt?.[season], now)
            : undefined;
        if (hold) {
          seasons[season] = { requestedVia: hold };
          break;
        }
      }
    }
    if (Object.keys(seasons).length > 0) {
      result.seasons = seasons;
    }
    return result;
  });

/** Summarises files for display. */
export const summarizeFiles = (
  files: {
    resolution?: number;
    formats: string[];
    languages: string[];
  }[],
  {
    positiveFormats,
    originalLanguage,
  }: { positiveFormats: string[]; originalLanguage?: string }
): VersionFileSummary => {
  const positive = new Set(positiveFormats.map(normalize));
  const formatCounts = new Map<string, number>();
  const languageCounts = new Map<string, number>();
  const resolutions = new Set<number>();

  for (const file of files) {
    if (file.resolution && file.resolution > 0) {
      resolutions.add(file.resolution);
    }
    for (const name of new Set(file.formats)) {
      // Resolution formats (e.g. "2160p") repeat the resolution.
      if (positive.has(normalize(name)) && !/^\d{3,4}p$/i.test(name.trim())) {
        formatCounts.set(name, (formatCounts.get(name) ?? 0) + 1);
      }
    }
    for (const name of new Set(file.languages)) {
      if (name && normalize(name) !== 'unknown') {
        languageCounts.set(name, (languageCounts.get(name) ?? 0) + 1);
      }
    }
  }

  const original = originalLanguage ? normalize(originalLanguage) : undefined;
  return {
    files: files.length,
    resolutions: [...resolutions].sort((a, b) => a - b).map((r) => `${r}p`),
    formats: [...formatCounts.entries()]
      .map(([name, count]) => ({ name, files: count }))
      .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name)),
    languages: [...languageCounts.entries()]
      .map(([name, count]) => ({
        name,
        files: count,
        original: normalize(name) === original,
      }))
      .sort(
        (a, b) =>
          Number(b.original) - Number(a.original) ||
          b.files - a.files ||
          a.name.localeCompare(b.name)
      ),
  };
};
