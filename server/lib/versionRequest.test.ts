import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveTarget, VersionTargetError } from '@server/lib/versionRequest';

const settings: Parameters<typeof resolveTarget>[1] = {
  radarr: [
    { id: 0 },
    { id: 1, buttonLabel: 'German' },
    { id: 2, is4k: true },
    { id: 3, buttonLabel: 'German 4K', is4k: true },
    { id: 4, buttonLabel: 'Anime', animeOnly: true },
  ],
  sonarr: [{ id: 0 }, { id: 1, buttonLabel: 'German' }],
};

const target = (
  over: Partial<Parameters<typeof resolveTarget>[0]>
): ReturnType<typeof resolveTarget> =>
  resolveTarget(
    {
      mediaType: 'movie',
      serverId: undefined,
      is4k: false,
      isServiceRequest: false,
      ...over,
    },
    settings
  );

describe('resolveTarget', () => {
  it('lets a standard request go to the default server', () => {
    assert.deepStrictEqual(target({}), { is4k: false, server: undefined });
    assert.strictEqual(target({ serverId: 0 }).server?.id, 0);
    assert.strictEqual(target({ serverId: 2, is4k: true }).is4k, true);
  });

  it('takes the 4K setting of a version request from its server', () => {
    assert.strictEqual(
      target({ serverId: 1, is4k: true, isServiceRequest: true }).is4k,
      false
    );
    assert.strictEqual(
      target({ serverId: 3, is4k: false, isServiceRequest: true }).is4k,
      true
    );
  });

  it('rejects a standard request whose 4K setting does not match the server', () => {
    assert.throws(
      () => target({ serverId: 1, is4k: true }),
      VersionTargetError
    );
    assert.throws(
      () => target({ serverId: 0, is4k: true }),
      VersionTargetError
    );
    assert.throws(
      () => target({ serverId: 2, is4k: false }),
      VersionTargetError
    );
  });

  it('rejects a standard request to a version server', () => {
    assert.throws(() => target({ serverId: 1 }), /is a version/);
    assert.throws(() => target({ serverId: 3, is4k: true }), /is a version/);
  });

  it('rejects a version request to a server without a version name', () => {
    assert.throws(
      () => target({ serverId: 0, isServiceRequest: true }),
      /not a version/
    );
  });

  it('rejects a version request to a server that does not exist', () => {
    assert.throws(
      () => target({ serverId: 9, isServiceRequest: true }),
      /configured server/
    );
  });

  it('checks the servers of the media type only', () => {
    assert.throws(
      () => target({ mediaType: 'tv', serverId: 4, isServiceRequest: true }),
      /configured server/
    );
  });

  it('returns the server so callers can check anime-only versions', () => {
    assert.strictEqual(
      target({ serverId: 4, isServiceRequest: true }).server?.animeOnly,
      true
    );
  });
});
