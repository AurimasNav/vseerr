import type { VersionDetails } from '@server/lib/mediaVersions';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  episodeMarks,
  episodeRanges,
  hasAired,
  isMixedSeason,
  seasonAiring,
  seasonHolders,
  seasonProgress,
  standardSeasonRequest,
} from './seasonVersions';

const version = (
  key: string,
  seasonEpisodes: Record<number, number[]> | undefined,
  label?: string
) =>
  ({
    key,
    label,
    seasonEpisodes,
    coverage: { key },
  }) as unknown as VersionDetails;

describe('seasonHolders', () => {
  it('lists the versions with files in the season, standard included', () => {
    const holders = seasonHolders(
      [
        version('standard', { 1: [1, 2] }),
        version('sonarr:1', { 1: [3], 2: [1] }, 'Russian'),
        version('sonarr:2', { 2: [1] }, 'Lithuanian'),
        version('sonarr:3', undefined, 'German'),
      ],
      1
    );
    assert.deepStrictEqual(holders, [
      { key: 'standard', label: undefined, episodes: [1, 2] },
      { key: 'sonarr:1', label: 'Russian', episodes: [3] },
    ]);
  });

  it('finds a season held only by a version', () => {
    const holders = seasonHolders(
      [
        version('standard', undefined),
        version('sonarr:1', { 1: [1, 2, 3, 4, 5, 6] }, 'Russian'),
      ],
      1
    );
    assert.deepStrictEqual(
      holders.map((holder) => holder.key),
      ['sonarr:1']
    );
  });
});

describe('isMixedSeason', () => {
  const holder = (key: string, episodes: number[]) => ({ key, episodes });

  it('is not mixed with one version', () => {
    assert.strictEqual(isMixedSeason([holder('sonarr:1', [1, 2, 3])]), false);
  });

  it('is mixed when the episodes are split across versions', () => {
    assert.strictEqual(
      isMixedSeason([holder('standard', [1, 2]), holder('sonarr:1', [3, 4])]),
      true
    );
  });

  it('is mixed when the versions overlap but none has every episode', () => {
    assert.strictEqual(
      isMixedSeason([holder('standard', [1, 2]), holder('sonarr:1', [2, 3])]),
      true
    );
  });

  it('is not mixed when one version has every episode', () => {
    assert.strictEqual(
      isMixedSeason([holder('standard', [1, 2, 3]), holder('sonarr:1', [2])]),
      false
    );
    assert.strictEqual(
      isMixedSeason([holder('standard', [1, 2]), holder('sonarr:1', [1, 2])]),
      false
    );
  });
});

describe('episodeRanges', () => {
  it('joins runs of episodes', () => {
    assert.strictEqual(episodeRanges([7, 1, 2, 3, 5, 8]), '1–3, 5, 7–8');
    assert.strictEqual(episodeRanges([4]), '4');
    assert.strictEqual(episodeRanges([]), '');
  });
});

describe('standardSeasonRequest', () => {
  const req = (
    id: number,
    seasons: number[],
    { isServiceRequest = false, is4k = false, day = 1 } = {}
  ) => ({
    id,
    isServiceRequest,
    is4k,
    createdAt: new Date(Date.UTC(2026, 10, day)),
    seasons: seasons.map((seasonNumber) => ({ seasonNumber })),
  });

  it('ignores version requests', () => {
    const requests = [req(1, [4], { isServiceRequest: true, day: 3 })];
    assert.strictEqual(standardSeasonRequest(requests, 4, false), undefined);
  });

  it('picks the newest standard request for the season', () => {
    const requests = [
      req(1, [1, 2], { day: 1 }),
      req(2, [2], { day: 2 }),
      req(3, [2], { isServiceRequest: true, day: 3 }),
      req(4, [2], { is4k: true, day: 4 }),
    ];
    assert.strictEqual(standardSeasonRequest(requests, 2, false)?.id, 2);
    assert.strictEqual(standardSeasonRequest(requests, 2, true)?.id, 4);
    assert.strictEqual(standardSeasonRequest(requests, 1, false)?.id, 1);
    assert.strictEqual(standardSeasonRequest(requests, 3, false), undefined);
  });
});

describe('seasonAiring', () => {
  const holders = [{ key: 'standard', episodes: [1, 2, 3] }];
  const last = { seasonNumber: 2, episodeNumber: 5 };
  const next = { seasonNumber: 2, episodeNumber: 6, airDate: '2026-11-12' };

  it('counts the current season up to the last aired episode', () => {
    assert.deepEqual(seasonAiring(2, 8, holders, last, next), {
      aired: 5,
      upcoming: 3,
      next,
    });
  });

  it('counts earlier seasons as aired and later ones as upcoming', () => {
    assert.deepEqual(seasonAiring(1, 8, holders, last, next), {
      aired: 8,
      upcoming: 0,
      next: undefined,
    });
    assert.deepEqual(seasonAiring(3, 8, [], last, next), {
      aired: 0,
      upcoming: 8,
      next: undefined,
    });
  });

  it('counts a file for a later episode as aired', () => {
    const ahead = [{ key: 'sonarr:1', episodes: [7] }];
    assert.equal(seasonAiring(2, 8, ahead, last, next).aired, 7);
  });

  it('counts everything as aired without TMDB data or for specials', () => {
    assert.equal(seasonAiring(2, 8, holders, undefined).aired, 8);
    assert.equal(seasonAiring(0, 4, holders, last).aired, 4);
  });
});

describe('seasonProgress', () => {
  it('lists the aired episodes each version is missing', () => {
    assert.deepEqual(
      seasonProgress(
        [
          { key: 'standard', episodes: [1, 2, 3, 4, 5] },
          { key: 'sonarr:1', label: 'Russian', episodes: [1, 2, 3, 6] },
        ],
        5
      ),
      {
        standard: { held: 5, aired: 5, missing: [] },
        'sonarr:1': { held: 3, aired: 5, missing: [4, 5] },
      }
    );
  });

  it('is empty without versions', () => {
    assert.deepEqual(seasonProgress([], 5), {});
  });
});

describe('hasAired', () => {
  it('counts only days before today', () => {
    assert.equal(hasAired('2026-11-03', '2026-11-04'), true);
    assert.equal(hasAired('2026-11-04', '2026-11-04'), false);
    assert.equal(hasAired('2026-11-05', '2026-11-04'), false);
    assert.equal(hasAired(undefined, '2026-11-04'), false);
    assert.equal(hasAired(null, '2026-11-04'), false);
  });
});

describe('episodeMarks', () => {
  const holders = [
    { key: 'standard', episodes: [1, 2, 3] },
    { key: 'sonarr:1', label: 'Russian', episodes: [1, 4] },
  ];

  it('marks each version as having the episode or missing it', () => {
    assert.deepEqual(episodeMarks(holders, 1, true), [
      { key: 'standard', label: undefined, held: true },
      { key: 'sonarr:1', label: 'Russian', held: true },
    ]);
    assert.deepEqual(episodeMarks(holders, 2, true), [
      { key: 'standard', label: undefined, held: true },
      { key: 'sonarr:1', label: 'Russian', held: false },
    ]);
    assert.deepEqual(episodeMarks(holders, 5, true), [
      { key: 'standard', label: undefined, held: false },
      { key: 'sonarr:1', label: 'Russian', held: false },
    ]);
  });

  it('marks nothing missing before the episode airs', () => {
    assert.deepEqual(episodeMarks(holders, 5, false), []);
    assert.deepEqual(episodeMarks(holders, 4, false), [
      { key: 'sonarr:1', label: 'Russian', held: true },
    ]);
  });

  it('has no marks without files in the season', () => {
    assert.deepEqual(episodeMarks([], 1, true), []);
  });
});
