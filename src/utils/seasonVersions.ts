import type { VersionDetails } from '@server/lib/mediaVersions';

// VSeerr: which versions hold a season's episodes, for the season rows of a
// show's page.

export interface SeasonHolder {
  /** `standard` or `sonarr:<id>`. */
  key: string;
  label?: string;
  /** Episode numbers with a file, in order. */
  episodes: number[];
}

/** The versions (standard included) with at least one file in the season. */
export const seasonHolders = (
  versions: VersionDetails[] | undefined,
  seasonNumber: number
): SeasonHolder[] =>
  (versions ?? [])
    .map((version) => ({
      key: version.key,
      label: version.label,
      episodes: version.seasonEpisodes?.[seasonNumber] ?? [],
    }))
    .filter((holder) => holder.episodes.length > 0);

/**
 * A season is mixed when its episodes are split across versions: no single
 * version holds every episode that some version has. A version holding the
 * whole season next to another holding part of it is not mixed; each shows
 * its own badge.
 */
export const isMixedSeason = (holders: SeasonHolder[]): boolean => {
  if (holders.length < 2) {
    return false;
  }
  const held = new Set(holders.flatMap((holder) => holder.episodes));
  return !holders.some((holder) => holder.episodes.length >= held.size);
};

/** `[1, 2, 3, 5, 7, 8]` → `1–3, 5, 7–8`. */
export const episodeRanges = (episodes: number[]): string => {
  const sorted = [...new Set(episodes)].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (const episode of [...sorted.slice(1), undefined]) {
    if (episode !== undefined && episode === previous + 1) {
      previous = episode;
      continue;
    }
    if (start !== undefined) {
      ranges.push(start === previous ? `${start}` : `${start}–${previous}`);
    }
    start = episode as number;
    previous = episode as number;
  }
  return ranges.join(', ');
};
