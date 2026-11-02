import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { UserType } from '@server/constants/user';
import dataSource, { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { UserVersion, VersionRequest } from '@server/entity/VSeerrVersions';
import { Permission } from '@server/lib/permissions';
import type { RadarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { USER_VERSION_TABLE } from '@server/lib/versionSql';
import { VSeerrAddVersions1790679971018 as SqliteVersionTables } from '@server/migration/sqlite/1790679971018-VSeerrAddVersions';
import { setupTestDb } from '@server/test/db';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

setupTestDb();

const newUser = (email: string) =>
  new User({
    email,
    username: email.split('@')[0],
    userType: UserType.LOCAL,
    permissions: Permission.REQUEST,
    avatar: '',
  });

describe('removing the VSeerr tables (down)', () => {
  it('deletes version requests instead of leaving them as standard ones', async () => {
    const media = await getRepository(Media).save(
      Object.assign(new Media(), {
        tmdbId: 4242,
        mediaType: MediaType.MOVIE,
        status: MediaStatus.PROCESSING,
      })
    );
    const user = await getRepository(User).findOneOrFail({
      where: { email: 'demo@seerr.dev' },
    });
    const insert = (serverId: number | null) =>
      dataSource.query(
        `INSERT INTO "media_request" ("status", "type", "mediaId", "requestedById", "is4k", "serverId", "isAutoRequest", "ignoreQuota") VALUES (?, 'movie', ?, ?, 0, ?, 0, 0)`,
        [MediaRequestStatus.APPROVED, media.id, user.id, serverId]
      );
    await insert(null);
    await insert(1);
    const [{ id: versionId }] = await dataSource.query(
      `SELECT MAX("id") AS "id" FROM "media_request"`
    );
    await getRepository(VersionRequest).insert({ requestId: versionId });

    const queryRunner = dataSource.createQueryRunner();
    try {
      await new SqliteVersionTables().down(queryRunner);
    } finally {
      await queryRunner.release();
    }

    // Plain SQL: the MediaRequest entity reads the dropped marker table.
    const left = await dataSource.query(
      `SELECT "serverId" FROM "media_request"`
    );
    assert.deepStrictEqual(
      left.map((request: { serverId: number | null }) => request.serverId),
      [null],
      'only the standard request is left'
    );
  });
});

describe('storing the versions of a new user', () => {
  afterEach(() => {
    getSettings().main.defaultRequestServices = [];
    getSettings().radarr = [];
  });

  it('still creates the user when storing their versions fails', async () => {
    getSettings().radarr = [
      { id: 0, name: 'Radarr', isDefault: true },
      { id: 1, name: 'Radarr German', buttonLabel: 'German' },
    ] as unknown as RadarrSettings[];
    getSettings().main.defaultRequestServices = ['radarr:1'];
    await dataSource.query(
      `CREATE TRIGGER "fail_user_versions" BEFORE INSERT ON "${USER_VERSION_TABLE}" BEGIN SELECT RAISE(ABORT, 'test failure'); END`
    );

    const saved = await getRepository(User).save(newUser('newcomer@seerr.dev'));

    assert.ok(saved.id);
    assert.deepStrictEqual(saved.requestServices, []);
    const stored = await getRepository(User).findOneOrFail({
      where: { email: 'newcomer@seerr.dev' },
    });
    assert.deepStrictEqual(stored.requestServices, []);
    await dataSource.query(`DROP TRIGGER "fail_user_versions"`);
  });

  it('gives a new user the default versions', async () => {
    getSettings().radarr = [
      { id: 0, name: 'Radarr', isDefault: true },
      { id: 1, name: 'Radarr German', buttonLabel: 'German' },
    ] as unknown as RadarrSettings[];
    getSettings().main.defaultRequestServices = ['radarr:1'];

    const saved = await getRepository(User).save(newUser('fresh@seerr.dev'));

    assert.deepStrictEqual(
      (
        await getRepository(UserVersion).find({ where: { userId: saved.id } })
      ).map((row) => row.version),
      ['radarr:1']
    );
  });
});
