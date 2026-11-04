import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { VersionDetails } from '@server/lib/mediaVersions';
import { isSlotRequest } from './serviceRequestStatus';

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

/** Whether an episode has aired: its air date is before today (UTC). */
export const hasAired = (
  airDate: string | null | undefined,
  today: string = new Date().toISOString().slice(0, 10)
): boolean => !!airDate && airDate.slice(0, 10) < today;

/** One version's mark on an episode: it has the file, or it is missing. */
export interface EpisodeMark {
  key: string;
  label?: string;
  held: boolean;
}

/**
 * The marks of an episode in an expanded season: one per version holding
 * files in the season. A version without the episode is marked missing
 * once the episode has aired; before that it gets no mark.
 */
export const episodeMarks = (
  holders: SeasonHolder[],
  episodeNumber: number,
  aired: boolean
): EpisodeMark[] =>
  holders
    .map((holder) => ({
      key: holder.key,
      label: holder.label,
      held: holder.episodes.includes(episodeNumber),
    }))
    .filter((mark) => mark.held || aired);

/** How many of a season's episodes a version holds. */
export interface EpisodeProgress {
  held: number;
  total: number;
}

/**
 * The versions that hold some but not all of a season's episodes, by key
 * (`standard` or `sonarr:<id>`). A season row shows these as "3 of 8"
 * instead of "Partially Available", which is kept for the whole show.
 */
export const seasonEpisodeProgress = (
  versions: VersionDetails[] | undefined,
  seasonNumber: number,
  episodeCount: number
): Record<string, EpisodeProgress> => {
  const progress: Record<string, EpisodeProgress> = {};
  for (const holder of seasonHolders(versions, seasonNumber)) {
    const held = new Set(holder.episodes).size;
    if (held < episodeCount) {
      progress[holder.key] = { held, total: episodeCount };
    }
  }
  return progress;
};

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

/**
 * The newest request for a season in the standard version (or standard
 * 4K). Version requests are left out: they have their own badges, and
 * counting them showed a version's pending request as a standard "Pending".
 */
export const standardSeasonRequest = <
  T extends Pick<
    NonFunctionProperties<MediaRequest>,
    'is4k' | 'isServiceRequest' | 'createdAt'
  > & { seasons: { seasonNumber: number }[] },
>(
  requests: T[] | undefined,
  seasonNumber: number,
  is4k: boolean
): T | undefined =>
  (requests ?? [])
    .filter(
      (request) =>
        isSlotRequest(request, null, is4k) &&
        request.seasons.some((season) => season.seasonNumber === seasonNumber)
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];
