import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

import ExternalAPI from '@server/api/externalapi';
import { MediaRequestStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import {
  DuplicateMediaRequestError,
  MediaRequest,
} from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import type { RadarrSettings, SonarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { setUserVersions } from '@server/lib/versions';
import { MediaRequestSubscriber } from '@server/subscriber/MediaRequestSubscriber';
import { setupTestDb } from '@server/test/db';

// Users without Manage Requests request one version of each title.

mock.method(
  ExternalAPI.prototype as unknown as {
    get: (endpoint: string) => Promise<unknown>;
  },
  'get',
  async (endpoint: string) => {
    const tmdbId = Number(endpoint.replace(/^\/(movie|tv)\//, ''));
    if (!tmdbId) {
      throw new Error(`Unstubbed external endpoint: ${endpoint}`);
    }
    return {
      id: tmdbId,
      external_ids: { tvdb_id: tmdbId },
      seasons: [1, 2].map((season_number) => ({ season_number })),
      videos: { results: [{ type: 'Trailer', key: 'trailer' }] },
    };
  }
);
mock.method(MediaRequest, 'sendNotification', async () => undefined);
// Requests are not sent to Radarr or Sonarr in these tests.
mock.method(MediaRequestSubscriber.prototype, 'sendToRadarr', async () => {});
mock.method(MediaRequestSubscriber.prototype, 'sendToSonarr', async () => {});

setupTestDb();

beforeEach(() => {
  const settings = getSettings();
  settings.radarr = [
    { id: 0, isDefault: true, is4k: false },
    { id: 1, buttonLabel: 'German', is4k: false },
    { id: 2, buttonLabel: 'French', is4k: false },
  ] as RadarrSettings[];
  settings.sonarr = [
    { id: 0, isDefault: true, is4k: false },
    { id: 1, buttonLabel: 'German', is4k: false },
  ] as SonarrSettings[];
  settings.main.defaultRequestServices = [];
});

async function createUser(
  email: string,
  permissions = Permission.REQUEST
): Promise<User> {
  const user = await getRepository(User).save(
    new User({ email, permissions, avatar: '' })
  );
  user.requestServices = await setUserVersions(user.id, [
    'radarr:1',
    'radarr:2',
    'sonarr:1',
  ]);
  return user;
}

const movie = (mediaId: number, serverId?: number) => ({
  mediaId,
  mediaType: MediaType.MOVIE,
  is4k: false,
  ...(serverId !== undefined ? { serverId, isServiceRequest: true } : {}),
});

describe('one version per title', () => {
  it('rejects a version request after a standard request', async () => {
    const user = await createUser('one@seerr.dev');
    await MediaRequest.request(movie(1001), user);

    await assert.rejects(
      () => MediaRequest.request(movie(1001, 1), user),
      DuplicateMediaRequestError
    );
    assert.strictEqual(await getRepository(MediaRequest).count(), 1);
  });

  it('rejects the standard version and other versions after a version request', async () => {
    const user = await createUser('two@seerr.dev');
    await MediaRequest.request(movie(1002, 1), user);

    await assert.rejects(
      () => MediaRequest.request(movie(1002), user),
      DuplicateMediaRequestError
    );
    await assert.rejects(
      () => MediaRequest.request(movie(1002, 2), user),
      DuplicateMediaRequestError
    );
  });

  it('leaves other titles and other users alone', async () => {
    const user = await createUser('three@seerr.dev');
    const other = await createUser('four@seerr.dev');
    await MediaRequest.request(movie(1003, 1), user);

    await MediaRequest.request(movie(1004), user);
    await MediaRequest.request(movie(1003, 2), other);
    assert.strictEqual(await getRepository(MediaRequest).count(), 3);
  });

  it('allows another version once the request was declined', async () => {
    const user = await createUser('five@seerr.dev');
    const first = await MediaRequest.request(movie(1005, 1), user);
    await getRepository(MediaRequest).update(first.id, {
      status: MediaRequestStatus.DECLINED,
    });

    await MediaRequest.request(movie(1005), user);
    assert.strictEqual(await getRepository(MediaRequest).count(), 2);
  });

  it('allows more seasons of the version the user chose', async () => {
    const user = await createUser('six@seerr.dev');
    const show = (seasons: number[], serverId?: number) => ({
      mediaId: 2001,
      mediaType: MediaType.TV,
      is4k: false,
      seasons,
      ...(serverId !== undefined ? { serverId, isServiceRequest: true } : {}),
    });
    await MediaRequest.request(show([1], 1), user);

    await MediaRequest.request(show([2], 1), user);
    await assert.rejects(
      () => MediaRequest.request(show([2]), user),
      DuplicateMediaRequestError
    );
  });

  it('does not limit 4K requests', async () => {
    const user = await createUser(
      'seven@seerr.dev',
      Permission.REQUEST | Permission.REQUEST_4K
    );
    await MediaRequest.request(movie(1006, 1), user);

    await MediaRequest.request({ ...movie(1006), is4k: true }, user);
    assert.strictEqual(await getRepository(MediaRequest).count(), 2);
  });

  it('does not limit request managers', async () => {
    const manager = await createUser(
      'eight@seerr.dev',
      Permission.REQUEST | Permission.MANAGE_REQUESTS
    );
    await MediaRequest.request(movie(1007), manager);

    await MediaRequest.request(movie(1007, 1), manager);
    await MediaRequest.request(movie(1007, 2), manager);
    assert.strictEqual(await getRepository(MediaRequest).count(), 3);
  });
});
