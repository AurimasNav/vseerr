import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CoverageVersionInput } from '@server/lib/versionCoverage';
import {
  computeCoverage,
  fileMatches,
  REQUEST_HOLD_MS,
  sanitizeDefiningFormats,
  sanitizeDefiningMatch,
  suggestDefiningFormats,
  summarizeFiles,
} from '@server/lib/versionCoverage';

const NOW = new Date('2026-11-02T12:00:00Z');
const FORMATS = ['REMUX', 'Atmos / DTS:X', 'Russian audio', 'Lithuanian audio'];

const standard = (
  over: Partial<CoverageVersionInput> = {}
): CoverageVersionInput => ({
  key: 'standard',
  definingFormats: ['REMUX', 'Atmos / DTS:X'],
  definingMatch: 'any',
  instanceFormats: FORMATS,
  file: null,
  ...over,
});
const russian = (
  over: Partial<CoverageVersionInput> = {}
): CoverageVersionInput => ({
  key: 'radarr:1',
  label: 'Russian',
  definingFormats: ['Russian audio'],
  instanceFormats: FORMATS,
  file: null,
  ...over,
});

describe('sanitizeDefiningFormats', () => {
  it('trims, drops blanks and duplicates (any case)', () => {
    assert.deepStrictEqual(
      sanitizeDefiningFormats([
        ' Russian audio ',
        '',
        'russian AUDIO',
        3,
        'REMUX',
      ]),
      ['Russian audio', 'REMUX']
    );
  });

  it('returns an empty list for anything but an array', () => {
    assert.deepStrictEqual(sanitizeDefiningFormats('REMUX'), []);
  });

  it('defaults the match mode to all', () => {
    assert.strictEqual(sanitizeDefiningMatch('any'), 'any');
    assert.strictEqual(sanitizeDefiningMatch('x'), 'all');
  });
});

describe('suggestDefiningFormats', () => {
  it('suggests the format a release cannot pass the minimum without', () => {
    assert.deepStrictEqual(
      suggestDefiningFormats({
        minFormatScore: 1000,
        formatItems: [
          { name: 'Russian audio', score: 1000 },
          { name: 'REMUX', score: 45 },
          { name: 'Lithuanian audio', score: 20 },
          { name: 'BR-DISK', score: -10000 },
        ],
      }),
      { formats: ['Russian audio'], match: 'all' }
    );
  });

  it('suggests any-of formats when each reaches the minimum alone', () => {
    assert.deepStrictEqual(
      suggestDefiningFormats({
        minFormatScore: 45,
        formatItems: [
          { name: 'REMUX', score: 45 },
          { name: 'Atmos / DTS:X (not Remux)', score: 40 },
          { name: 'Atmos / DTS:X', score: 5 },
          { name: 'Russian audio', score: 10 },
          { name: 'Lithuanian audio', score: 20 },
        ],
      }),
      { formats: ['REMUX', 'Atmos / DTS:X (not Remux)'], match: 'any' }
    );
  });

  it('suggests nothing without a minimum score', () => {
    assert.deepStrictEqual(
      suggestDefiningFormats({
        minFormatScore: 0,
        formatItems: [{ name: 'Lithuanian audio', score: 100 }],
      }),
      { formats: [], match: 'all' }
    );
  });
});

describe('fileMatches', () => {
  it('needs every format in all mode and one in any mode', () => {
    const file = { formats: ['REMUX', 'russian audio'] };
    assert.strictEqual(fileMatches(file, ['Russian audio', 'REMUX']), true);
    assert.strictEqual(
      fileMatches(file, ['Russian audio', 'Atmos / DTS:X']),
      false
    );
    assert.strictEqual(
      fileMatches(file, ['Atmos / DTS:X', 'REMUX'], 'any'),
      true
    );
  });
});

describe('computeCoverage (movies)', () => {
  it('covers Russian when the standard file has Russian audio', () => {
    const [, ru] = computeCoverage(
      [standard({ file: { formats: ['REMUX', 'Russian audio'] } }), russian()],
      { mediaType: 'movie', now: NOW }
    );
    assert.deepStrictEqual(ru.coveredBy, { key: 'standard' });
  });

  it('covers standard when a Russian file is a Remux (any of)', () => {
    const [std] = computeCoverage(
      [standard(), russian({ file: { formats: ['Russian audio', 'REMUX'] } })],
      { mediaType: 'movie', now: NOW }
    );
    assert.deepStrictEqual(std.coveredBy, {
      key: 'radarr:1',
      label: 'Russian',
    });
  });

  it('does not cover standard with a Russian WEB-DL', () => {
    const [std] = computeCoverage(
      [standard(), russian({ file: { formats: ['Russian audio'] } })],
      { mediaType: 'movie', now: NOW }
    );
    assert.strictEqual(std.coveredBy, undefined);
    assert.strictEqual(std.requestedVia, undefined);
  });

  it('never covers a version without defining formats', () => {
    const [, , lt] = computeCoverage(
      [
        standard({ file: { formats: ['REMUX', 'Lithuanian audio'] } }),
        russian(),
        {
          key: 'radarr:2',
          label: 'Lithuanian',
          definingFormats: [],
          instanceFormats: FORMATS,
          file: null,
        },
      ],
      { mediaType: 'movie', now: NOW }
    );
    assert.strictEqual(lt.coveredBy, undefined);
  });

  it('does not mark a version covered when it has its own file', () => {
    const [, ru] = computeCoverage(
      [
        standard({ file: { formats: ['Russian audio'] } }),
        russian({ file: { formats: ['Russian audio'] } }),
      ],
      { mediaType: 'movie', now: NOW }
    );
    assert.strictEqual(ru.coveredBy, undefined);
  });

  it('holds a version back for a day after another version is requested', () => {
    const requestedAt = new Date(NOW.getTime() - 60 * 60 * 1000);
    const [, ru] = computeCoverage(
      [standard({ openRequestAt: requestedAt }), russian()],
      { mediaType: 'movie', now: NOW }
    );
    assert.deepStrictEqual(ru.requestedVia, {
      key: 'standard',
      until: new Date(requestedAt.getTime() + REQUEST_HOLD_MS).toISOString(),
    });
  });

  it('lets the file decide once the day has passed', () => {
    const [, ru] = computeCoverage(
      [
        standard({
          openRequestAt: new Date(NOW.getTime() - REQUEST_HOLD_MS - 1),
        }),
        russian(),
      ],
      { mediaType: 'movie', now: NOW }
    );
    assert.strictEqual(ru.requestedVia, undefined);
  });

  it('does not hold back for an instance that lacks the format', () => {
    const [, ru] = computeCoverage(
      [
        standard({
          instanceFormats: ['REMUX'],
          openRequestAt: new Date(NOW.getTime() - 1000),
        }),
        russian(),
      ],
      { mediaType: 'movie', now: NOW }
    );
    assert.strictEqual(ru.requestedVia, undefined);
  });
});

describe('computeCoverage (shows)', () => {
  const showStandard = (
    files: Record<number, string[][]>,
    complete: number[]
  ) =>
    standard({
      file: undefined,
      seasonFiles: Object.fromEntries(
        Object.entries(files).map(([s, list]) => [
          Number(s),
          list.map((formats) => ({ formats })),
        ])
      ),
      completeSeasons: complete,
    });

  it('covers a season only when every episode file matches', () => {
    const [, ru] = computeCoverage(
      [
        showStandard(
          {
            1: [['Russian audio'], ['Russian audio']],
            2: [['Russian audio'], ['REMUX']],
          },
          [1, 2]
        ),
        russian({ file: undefined }),
      ],
      { mediaType: 'tv', now: NOW }
    );
    assert.deepStrictEqual(ru.seasons, {
      1: { coveredBy: { key: 'standard' } },
    });
  });

  it('does not cover an incomplete season', () => {
    const [, ru] = computeCoverage(
      [
        showStandard({ 1: [['Russian audio']] }, []),
        russian({ file: undefined }),
      ],
      { mediaType: 'tv', now: NOW }
    );
    assert.strictEqual(ru.seasons, undefined);
  });

  it('holds back a freshly requested season', () => {
    const requestedAt = new Date(NOW.getTime() - 1000);
    const [, ru] = computeCoverage(
      [
        standard({
          file: undefined,
          seasonFiles: {},
          openSeasonRequestAt: { 3: requestedAt },
        }),
        russian({ file: undefined }),
      ],
      { mediaType: 'tv', now: NOW }
    );
    assert.strictEqual(ru.seasons?.[3]?.requestedVia?.key, 'standard');
  });
});

describe('summarizeFiles', () => {
  it('lists positive formats, resolution and languages with the original first', () => {
    assert.deepStrictEqual(
      summarizeFiles(
        [
          {
            resolution: 2160,
            formats: ['2160p', 'REMUX', 'Russian audio', 'Upscaled'],
            languages: ['Lithuanian', 'Russian', 'English'],
          },
        ],
        {
          positiveFormats: [
            '2160p',
            'REMUX',
            'Russian audio',
            'Lithuanian audio',
          ],
          originalLanguage: 'English',
        }
      ),
      {
        files: 1,
        resolutions: ['2160p'],
        formats: [
          { name: 'REMUX', files: 1 },
          { name: 'Russian audio', files: 1 },
        ],
        languages: [
          { name: 'English', files: 1, original: true },
          { name: 'Lithuanian', files: 1, original: false },
          { name: 'Russian', files: 1, original: false },
        ],
      }
    );
  });
});
