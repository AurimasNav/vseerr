import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';

import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import MediaServiceStatus from '@server/entity/MediaServiceStatus';
import { User } from '@server/entity/User';
import { retireVersion } from '@server/lib/requestServices';
import type { RadarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { setUserVersions } from '@server/lib/versions';
import { MediaRequestSubscriber } from '@server/subscriber/MediaRequestSubscriber';
import { setupTestDb } from '@server/test/db';

// Declining sends a notification, which looks the title up on TMDB, and an
// approved request is sent to Radarr; neither is under test here.
mock.method(MediaRequest, 'sendNotification', async () => undefined);
mock.method(MediaRequestSubscriber.prototype, 'sendToRadarr', async () => {});

setupTestDb();

beforeEach(() => {
  getSettings().radarr = [];
  getSettings().sonarr = [];
  getSettings().main.defaultRequestServices = ['radarr:1', 'sonarr:1'];
});

async function versionRequest(
  tmdbId: number,
  serverId: number,
  status: MediaRequestStatus
): Promise<MediaRequest> {
  const requestedBy = await getRepository(User).findOneOrFail({
    where: { email: 'admin@seerr.dev' },
  });
  const media = await getRepository(Media).save(
    new Media({ tmdbId, mediaType: MediaType.MOVIE })
  );
  return getRepository(MediaRequest).save(
    new MediaRequest({
      type: MediaType.MOVIE,
      media,
      requestedBy,
      status,
      is4k: false,
      serverId,
      isServiceRequest: true,
    })
  );
}

describe('retireVersion (review M3)', () => {
  it('removes grants, the default, open requests and recorded statuses', async () => {
    const user = await getRepository(User).findOneOrFail({
      where: { email: 'demo@seerr.dev' },
    });
    await setUserVersions(user.id, ['radarr:1', 'sonarr:1']);
    const open = await versionRequest(5001, 1, MediaRequestStatus.PENDING);
    const done = await versionRequest(5002, 1, MediaRequestStatus.COMPLETED);
    const other = await versionRequest(5003, 2, MediaRequestStatus.PENDING);
    await getRepository(MediaServiceStatus).save([
      new MediaServiceStatus({
        mediaId: open.media.id,
        serviceId: 1,
        serviceType: 'radarr',
        status: MediaStatus.AVAILABLE,
      }),
      new MediaServiceStatus({
        mediaId: other.media.id,
        serviceId: 1,
        serviceType: 'sonarr',
        status: MediaStatus.AVAILABLE,
      }),
    ]);

    await retireVersion('radarr', 1);

    const reloaded = await getRepository(User).findOneOrFail({
      where: { id: user.id },
    });
    assert.deepStrictEqual(reloaded.requestServices, ['sonarr:1']);
    assert.deepStrictEqual(getSettings().main.defaultRequestServices, [
      'sonarr:1',
    ]);
    const status = async (id: number) =>
      (await getRepository(MediaRequest).findOneOrFail({ where: { id } }))
        .status;
    assert.strictEqual(await status(open.id), MediaRequestStatus.DECLINED);
    assert.strictEqual(await status(done.id), MediaRequestStatus.COMPLETED);
    assert.strictEqual(await status(other.id), MediaRequestStatus.PENDING);
    const rows = await getRepository(MediaServiceStatus).find();
    assert.deepStrictEqual(
      rows.map((row) => [row.serviceType, row.serviceId]),
      [['sonarr', 1]]
    );
  });

  it('keeps the recorded statuses when asked to', async () => {
    const open = await versionRequest(5004, 1, MediaRequestStatus.PENDING);
    await getRepository(MediaServiceStatus).save(
      new MediaServiceStatus({
        mediaId: open.media.id,
        serviceId: 1,
        serviceType: 'radarr',
        status: MediaStatus.AVAILABLE,
      })
    );

    await retireVersion('radarr', 1, { keepStatuses: true });

    assert.strictEqual(await getRepository(MediaServiceStatus).count(), 1);
  });
});

describe('server ids after a delete (review M3)', () => {
  it('a server added after a delete does not inherit the old version', async () => {
    // Settings routes give a new server the last id + 1, so deleting the last
    // server and adding another reuses its id.
    getSettings().radarr = [
      { id: 0 },
      { id: 1, buttonLabel: 'German' },
    ] as RadarrSettings[];
    const open = await versionRequest(5005, 1, MediaRequestStatus.APPROVED);

    await retireVersion('radarr', 1);
    getSettings().radarr = [
      { id: 0 },
      { id: 1, buttonLabel: 'French' },
    ] as RadarrSettings[];

    const request = await getRepository(MediaRequest).findOneOrFail({
      where: { id: open.id },
    });
    assert.strictEqual(request.status, MediaRequestStatus.DECLINED);
  });
});
