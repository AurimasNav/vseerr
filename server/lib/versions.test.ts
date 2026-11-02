import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getVersionRules,
  isVersionDestination,
  sanitizeHoldHours,
  versionServerIds,
} from '@server/lib/versions';

const settings = {
  radarr: [
    { id: 0, is4k: false },
    { id: 1, is4k: false, buttonLabel: 'German' },
    { id: 2, is4k: true },
    { id: 3, is4k: true, buttonLabel: 'German 4K' },
  ],
  sonarr: [
    { id: 0, buttonLabel: 'English' },
    { id: 1, buttonLabel: 'Italian' },
  ],
};

describe('isVersionDestination', () => {
  it('flags a version server as a standard destination', () => {
    assert.strictEqual(isVersionDestination('movie', 1, false, settings), true);
    assert.strictEqual(isVersionDestination('movie', 3, true, settings), true);
  });

  it('allows servers without a version name', () => {
    assert.strictEqual(
      isVersionDestination('movie', 0, false, settings),
      false
    );
    assert.strictEqual(isVersionDestination('movie', 2, true, settings), false);
    assert.strictEqual(
      isVersionDestination('movie', undefined, false, settings),
      false
    );
  });

  it("keeps Seerr's behaviour when every server is a version", () => {
    assert.strictEqual(isVersionDestination('tv', 1, false, settings), false);
  });
});

describe('versionServerIds', () => {
  it('lists non-4K servers with a version name', () => {
    assert.deepStrictEqual([...versionServerIds(settings.radarr)], [1]);
  });

  it("is empty when every server is a version (Seerr's behaviour)", () => {
    assert.deepStrictEqual([...versionServerIds(settings.sonarr)], []);
  });
});

describe('getVersionRules', () => {
  it('defaults to a 24 hour hold and one version per title', () => {
    assert.deepStrictEqual(getVersionRules({}), {
      holdHours: 24,
      oneVersionPerTitle: true,
    });
  });

  it('reads the settings', () => {
    assert.deepStrictEqual(
      getVersionRules({ versionHoldHours: 0, oneVersionPerTitle: false }),
      { holdHours: 0, oneVersionPerTitle: false }
    );
  });

  it('falls back to the default for invalid hours', () => {
    assert.strictEqual(sanitizeHoldHours(-1), 24);
    assert.strictEqual(sanitizeHoldHours('12'), 24);
    assert.strictEqual(sanitizeHoldHours(10000), 24);
    assert.strictEqual(sanitizeHoldHours(6), 6);
  });
});
