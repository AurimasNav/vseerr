import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { UserType } from '@server/constants/user';
import dataSource, { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import MediaServiceStatus from '@server/entity/MediaServiceStatus';
import { User } from '@server/entity/User';
import {
  ParkedRequest,
  UserVersion,
  VersionRequest,
} from '@server/entity/VSeerrVersions';
import { Permission } from '@server/lib/permissions';
import type { RadarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import {
  ensureVersionTables,
  parkVersionRequests,
  prepareVersionDatabase,
  purgeVersionData,
  removeVersionOrphans,
} from '@server/lib/versionDatabase';
import { VSEERR_TABLES } from '@server/lib/versionSql';
import {
  getDefaultVersions,
  removeVersionEverywhere,
  setUserVersions,
} from '@server/lib/versions';
import { setupTestDb } from '@server/test/db';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

setupTestDb();

// Inserts rows without running Seerr's request subscribers, which would call
// Radarr and Sonarr.
async function insertRequest(values: {
  media: Media;
  user: User;
  serverId?: number;
  isVersion: boolean;
  type?: MediaType;
  seasons?: number[];
}): Promise<number> {
  await dataSource.query(
    `INSERT INTO "media_request" ("status", "type", "mediaId", "requestedById", "is4k", "serverId", "isAutoRequest", "ignoreQuota") VALUES (?, ?, ?, ?, 0, ?, 0, 0)`,
    [
      MediaRequestStatus.APPROVED,
      values.type ?? MediaType.MOVIE,
      values.media.id,
      values.user.id,
      values.serverId ?? null,
    ]
  );
  const [{ id }] = await dataSource.query(
    `SELECT MAX("id") AS "id" FROM "media_request"`
  );
  for (const seasonNumber of values.seasons ?? []) {
    await dataSource.query(
      `INSERT INTO "season_request" ("seasonNumber", "status", "requestId") VALUES (?, ?, ?)`,
      [seasonNumber, MediaRequestStatus.APPROVED, id]
    );
  }
  if (values.isVersion) {
    await getRepository(VersionRequest).insert({ requestId: id });
  }
  return Number(id);
}

async function insertMedia(tmdbId: number, mediaType = MediaType.MOVIE) {
  return getRepository(Media).save(
    Object.assign(new Media(), {
      tmdbId,
      mediaType,
      status: MediaStatus.PROCESSING,
    })
  );
}

const demoUser = () =>
  getRepository(User).findOneOrFail({ where: { email: 'demo@seerr.dev' } });

function configureVersions(): void {
  const settings = getSettings();
  settings.radarr = [0, 1].map(
    (id) =>
      ({
        id,
        name: `Radarr ${id}`,
        buttonLabel: id === 0 ? 'English' : 'German',
        hostname: 'localhost',
        port: 7878,
        apiKey: 'test',
        useSsl: false,
        activeProfileId: 1,
        activeProfileName: 'HD',
        activeDirectory: '/movies',
        is4k: false,
        isDefault: id === 0,
        minimumAvailability: 'released',
        tags: [],
        externalUrl: '',
        syncEnabled: false,
        preventSearch: false,
        tagRequests: false,
        overrideRule: [],
      }) as RadarrSettings
  );
  settings.sonarr = [];
  settings.main.defaultRequestServices = [];
}

describe('version flag', () => {
  it('stores version requests in VSeerr’s own table', async () => {
    const media = await insertMedia(101);
    const user = await demoUser();
    const versionId = await insertRequest({
      media,
      user,
      serverId: 1,
      isVersion: true,
    });
    const plainId = await insertRequest({ media, user, isVersion: false });

    const version = await getRepository(MediaRequest).findOneOrFail({
      where: { id: versionId },
    });
    const plain = await getRepository(MediaRequest).findOneOrFail({
      where: { id: plainId },
    });
    assert.strictEqual(version.isServiceRequest, true);
    assert.strictEqual(plain.isServiceRequest, false);

    const columns = (
      await dataSource.query(`PRAGMA table_info("media_request")`)
    ).map((column: { name: string }) => column.name);
    assert.ok(!columns.includes('isServiceRequest'));
  });

  it('saves the flag when a request is created with isServiceRequest', async () => {
    const media = await insertMedia(102);
    const user = await demoUser();
    // The app saves requests through the repository; skip Seerr's
    // subscribers, which would call Radarr.
    const saved = await dataSource.manager.save(
      new MediaRequest({
        type: MediaType.MOVIE,
        media,
        requestedBy: user,
        status: MediaRequestStatus.APPROVED,
        serverId: 0,
        isServiceRequest: true,
      }),
      { listeners: false }
    );
    assert.ok(
      await getRepository(VersionRequest).exists({
        where: { requestId: saved.id },
      })
    );
    const reloaded = await getRepository(MediaRequest).findOneOrFail({
      where: { id: saved.id },
    });
    assert.strictEqual(reloaded.isServiceRequest, true);
  });
});

describe('user versions', () => {
  afterEach(() => {
    getSettings().main.defaultRequestServices = [];
  });

  it('reads, replaces and removes versions', async () => {
    configureVersions();
    const user = await demoUser();
    await setUserVersions(user.id, [
      'radarr:1',
      'radarr:0',
      'bogus',
      'radarr:1',
    ]);
    const reloaded = await demoUser();
    assert.deepStrictEqual(reloaded.requestServices, ['radarr:0', 'radarr:1']);

    await removeVersionEverywhere('radarr:0');
    assert.deepStrictEqual((await demoUser()).requestServices, ['radarr:1']);
  });

  it('gives new users the default versions', async () => {
    configureVersions();
    getSettings().main.defaultRequestServices = ['radarr:1', 'radarr:9'];
    assert.deepStrictEqual(getDefaultVersions(), ['radarr:1']);

    const user = new User({
      email: 'new@seerr.dev',
      username: 'new',
      userType: UserType.LOCAL,
      permissions: Permission.REQUEST,
      avatar: '',
    });
    await getRepository(User).save(user);
    const reloaded = await getRepository(User).findOneOrFail({
      where: { email: 'new@seerr.dev' },
    });
    assert.deepStrictEqual(reloaded.requestServices, ['radarr:1']);
  });

  it('keeps versions given when the user is created', async () => {
    configureVersions();
    getSettings().main.defaultRequestServices = ['radarr:1'];
    await getRepository(User).save(
      new User({
        email: 'given@seerr.dev',
        username: 'given',
        userType: UserType.LOCAL,
        permissions: Permission.REQUEST,
        avatar: '',
        requestServices: ['radarr:0'],
      })
    );
    const reloaded = await getRepository(User).findOneOrFail({
      where: { email: 'given@seerr.dev' },
    });
    assert.deepStrictEqual(reloaded.requestServices, ['radarr:0']);
  });
});

describe('switching between Seerr and VSeerr', () => {
  it('parks version requests and restores them', async () => {
    const movie = await insertMedia(201);
    const show = await insertMedia(202, MediaType.TV);
    const user = await demoUser();
    const plainId = await insertRequest({
      media: movie,
      user,
      isVersion: false,
    });
    const movieVersionId = await insertRequest({
      media: movie,
      user,
      serverId: 1,
      isVersion: true,
    });
    const showVersionId = await insertRequest({
      media: show,
      user,
      serverId: 0,
      isVersion: true,
      type: MediaType.TV,
      seasons: [1, 2],
    });
    await getRepository(MediaServiceStatus).insert({
      mediaId: movie.id,
      serviceId: 1,
      serviceType: 'radarr',
      status: MediaStatus.AVAILABLE,
    });

    assert.strictEqual(await parkVersionRequests(dataSource), 2);

    // What Seerr sees: only the ordinary request.
    const left = await dataSource.query(`SELECT "id" FROM "media_request"`);
    assert.deepStrictEqual(
      left.map((row: { id: number }) => row.id),
      [plainId]
    );
    const seasonsLeft = await dataSource.query(
      `SELECT COUNT(*) AS "n" FROM "season_request"`
    );
    assert.strictEqual(Number(seasonsLeft[0].n), 0);
    assert.strictEqual(await getRepository(ParkedRequest).count(), 2);

    // Seerr removes the movie's media row in the meantime.
    await dataSource.query(`DELETE FROM "media_request" WHERE "mediaId" = ?`, [
      movie.id,
    ]);
    await dataSource.query(`DELETE FROM "media" WHERE "id" = ?`, [movie.id]);

    await prepareVersionDatabase(dataSource);

    assert.strictEqual(await getRepository(ParkedRequest).count(), 0);
    const restored = await getRepository(MediaRequest).find({
      relations: { media: true, seasons: true },
      order: { id: 'ASC' },
    });
    assert.deepStrictEqual(
      restored.map((request) => ({
        id: request.id,
        tmdbId: request.media.tmdbId,
        isServiceRequest: request.isServiceRequest,
        seasons: request.seasons.map((season) => season.seasonNumber).sort(),
      })),
      [
        {
          id: movieVersionId,
          tmdbId: 201,
          isServiceRequest: true,
          seasons: [],
        },
        {
          id: showVersionId,
          tmdbId: 202,
          isServiceRequest: true,
          seasons: [1, 2],
        },
      ]
    );
    // The movie's old availability row pointed at the deleted media row.
    assert.strictEqual(await getRepository(MediaServiceStatus).count(), 0);
  });

  it('drops parked requests whose user was deleted', async () => {
    const media = await insertMedia(301);
    const user = await getRepository(User).save(
      new User({
        email: 'gone@seerr.dev',
        username: 'gone',
        userType: UserType.LOCAL,
        permissions: Permission.REQUEST,
        avatar: '',
      })
    );
    await insertRequest({ media, user, serverId: 1, isVersion: true });
    await parkVersionRequests(dataSource);
    await dataSource.query(`DELETE FROM "user" WHERE "id" = ?`, [user.id]);

    await prepareVersionDatabase(dataSource);

    assert.strictEqual(await getRepository(ParkedRequest).count(), 0);
    assert.strictEqual(await getRepository(MediaRequest).count(), 0);
  });

  it('cleans up rows whose parent is gone', async () => {
    const media = await insertMedia(401);
    const user = await demoUser();
    const id = await insertRequest({
      media,
      user,
      serverId: 1,
      isVersion: true,
    });
    await setUserVersions(user.id, ['radarr:1']);
    await dataSource.query(`DELETE FROM "media_request" WHERE "id" = ?`, [id]);
    await dataSource.query(`DELETE FROM "user" WHERE "id" = ?`, [user.id]);

    await removeVersionOrphans(dataSource.manager);

    assert.strictEqual(await getRepository(VersionRequest).count(), 0);
    assert.strictEqual(
      await getRepository(UserVersion).count({ where: { userId: user.id } }),
      0
    );
  });

  it('re-creates missing tables', async () => {
    await dataSource.query(`DROP TABLE "vseerr_user_version"`);
    await ensureVersionTables(dataSource);
    const queryRunner = dataSource.createQueryRunner();
    const present = await Promise.all(
      VSEERR_TABLES.map((table) => queryRunner.hasTable(table))
    );
    await queryRunner.release();
    assert.deepStrictEqual(
      present,
      VSEERR_TABLES.map(() => true)
    );
  });

  it('removes everything VSeerr added', async () => {
    const media = await insertMedia(501);
    const user = await demoUser();
    const plainId = await insertRequest({ media, user, isVersion: false });
    await insertRequest({ media, user, serverId: 1, isVersion: true });

    assert.strictEqual(await purgeVersionData(dataSource), 1);

    const queryRunner = dataSource.createQueryRunner();
    const present = await Promise.all(
      VSEERR_TABLES.map((table) => queryRunner.hasTable(table))
    );
    await queryRunner.release();
    assert.deepStrictEqual(
      present,
      VSEERR_TABLES.map(() => false)
    );
    const left = await dataSource.query(`SELECT "id" FROM "media_request"`);
    assert.deepStrictEqual(
      left.map((row: { id: number }) => row.id),
      [plainId]
    );
  });
});
