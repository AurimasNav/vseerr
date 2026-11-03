import type { VersionDetails } from '@server/lib/mediaVersions';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { episodeRanges, isMixedSeason, seasonHolders } from './seasonVersions';

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
