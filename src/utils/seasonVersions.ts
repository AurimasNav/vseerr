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

/** An episode TMDB lists as the last aired or next to air. */
export interface AiringEpisode {
  seasonNumber: number;
  episodeNumber: number;
  airDate?: string | null;
}

/** How far a season has aired. */
export interface SeasonAiring {
  /** Episodes aired so far (1..aired). */
  aired: number;
  /** Episodes still to air. */
  upcoming: number;
  /** The next episode to air, when it is in this season. */
  next?: AiringEpisode;
}

/**
 * How many of a season's episodes have aired, from the show's last aired
 * episode on TMDB. A file for a later episode counts it as aired too (TMDB
 * can lag). Without TMDB data, or for specials, every episode counts as
 * aired.
 */
export const seasonAiring = (
  seasonNumber: number,
  episodeCount: number,
  holders: SeasonHolder[],
  lastEpisodeToAir?: AiringEpisode | null,
  nextEpisodeToAir?: AiringEpisode | null
): SeasonAiring => {
  let aired = episodeCount;
  if (
    lastEpisodeToAir &&
    seasonNumber > 0 &&
    lastEpisodeToAir.seasonNumber > 0
  ) {
    if (seasonNumber > lastEpisodeToAir.seasonNumber) {
      aired = 0;
    } else if (seasonNumber === lastEpisodeToAir.seasonNumber) {
      aired = lastEpisodeToAir.episodeNumber;
    }
  }
  const newestFile = Math.max(
    0,
    ...holders.flatMap((holder) => holder.episodes)
  );
  aired = Math.min(episodeCount, Math.max(aired, newestFile));
  return {
    aired,
    upcoming: episodeCount - aired,
    next:
      nextEpisodeToAir?.seasonNumber === seasonNumber &&
      nextEpisodeToAir.episodeNumber > aired
        ? nextEpisodeToAir
        : undefined,
  };
};

/** A version's aired episodes in a season: how many it has, which are missing. */
export interface SeasonProgress {
  held: number;
  aired: number;
  missing: number[];
}

/**
 * Each version's progress through a season's aired episodes, by key
 * (`standard` or `sonarr:<id>`). A season row shows "3 of 5" for a version
 * missing aired episodes, and Available when only unaired ones are left.
 */
export const seasonProgress = (
  holders: SeasonHolder[],
  aired: number
): Record<string, SeasonProgress> => {
  const progress: Record<string, SeasonProgress> = {};
  for (const holder of holders) {
    const episodes = new Set(holder.episodes);
    const missing: number[] = [];
    for (let episode = 1; episode <= aired; episode++) {
      if (!episodes.has(episode)) {
        missing.push(episode);
      }
    }
    progress[holder.key] = { held: aired - missing.length, aired, missing };
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
