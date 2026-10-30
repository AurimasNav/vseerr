// Round trip of one database between Seerr and VSeerr:
//
//   Seerr → VSeerr → park → Seerr (adds a request) → VSeerr → remove → Seerr
//
// "Seerr" means Seerr's own migrations, which are VSeerr's migrations
// without the VSeerr ones; VSeerr is built on Seerr releases, so they are
// the same files. Checks that each side starts on what the other left
// behind and that no request is lost.
//
//   pnpm vseerr:roundtrip                        SQLite in a temp folder
//   DB_TYPE=postgres DB_HOST=… pnpm vseerr:roundtrip
//
// For Postgres the database must be empty: everything in it is dropped.
import { entities } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import {
  ParkedRequest,
  UserVersion,
  VersionRequest,
} from '@server/entity/VSeerrVersions';
import {
  parkVersionRequests,
  prepareVersionDatabase,
  purgeVersionData,
} from '@server/lib/versionDatabase';
import { VSEERR_TABLES, isVersionRequestSql } from '@server/lib/versionSql';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import { DataSource } from 'typeorm';

const isPostgres = process.env.DB_TYPE === 'postgres';
const dialect = isPostgres ? 'postgres' : 'sqlite';
const migrationDir = path.join(__dirname, '..', 'migration', dialect);
const allMigrations = readdirSync(migrationDir)
  .filter((file) => /\.(ts|js)$/.test(file) && !file.endsWith('.d.ts'))
  .map((file) => path.join(migrationDir, file));
const seerrMigrations = allMigrations.filter(
  (file) => !path.basename(file).includes('VSeerr')
);

const tempDir = isPostgres
  ? undefined
  : mkdtempSync(path.join(tmpdir(), 'vseerr-'));
const connection: DataSourceOptions = isPostgres
  ? {
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME ?? 'seerr',
    }
  : { type: 'sqlite', database: path.join(tempDir as string, 'db.sqlite3') };

const log = (message: string) => {
  // eslint-disable-next-line no-console
  console.log(`[${dialect}] ${message}`);
};

/** Opens the database as Seerr or as VSeerr and runs its migrations. */
const open = async (as: 'seerr' | 'vseerr'): Promise<DataSource> => {
  const dataSource = new DataSource({
    ...connection,
    entities: as === 'vseerr' ? entities : [],
    migrations: as === 'vseerr' ? allMigrations : seerrMigrations,
    synchronize: false,
  } as DataSourceOptions);
  await dataSource.initialize();
  if (!isPostgres) {
    await dataSource.query('PRAGMA foreign_keys=OFF');
  }
  const ran = await dataSource.runMigrations();
  if (!isPostgres) {
    await dataSource.query('PRAGMA foreign_keys=ON');
  }
  if (as === 'vseerr') {
    await prepareVersionDatabase(dataSource);
  }
  log(`opened as ${as}, ${ran.length} migration(s) run`);
  return dataSource;
};

const run = (
  dataSource: DataSource,
  text: string,
  parameters: unknown[] = []
) => {
  let index = 0;
  return dataSource.query(
    isPostgres ? text.replace(/\?/g, () => `$${++index}`) : text,
    parameters
  );
};

const insertReturningId = async (
  dataSource: DataSource,
  table: string,
  row: Record<string, unknown>
): Promise<number> => {
  const names = Object.keys(row);
  await run(
    dataSource,
    `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
    Object.values(row)
  );
  const [{ id }] = await run(
    dataSource,
    `SELECT MAX("id") AS "id" FROM "${table}"`
  );
  return Number(id);
};

const requestIds = async (dataSource: DataSource): Promise<number[]> =>
  (await run(dataSource, `SELECT "id" FROM "media_request" ORDER BY "id"`)).map(
    (row: { id: number }) => Number(row.id)
  );

const tableNames = async (dataSource: DataSource): Promise<string[]> => {
  const queryRunner = dataSource.createQueryRunner();
  try {
    return (await queryRunner.getTables())
      .map((table) => table.name.replace(/^public\./, ''))
      .sort();
  } finally {
    await queryRunner.release();
  }
};

const request = (
  mediaId: number,
  userId: number,
  type: string,
  serverId?: number
) => ({
  status: 2,
  type,
  mediaId,
  requestedById: userId,
  is4k: false,
  serverId: serverId ?? null,
  isAutoRequest: false,
  ignoreQuota: false,
});

const main = async () => {
  if (isPostgres) {
    const reset = new DataSource({ ...connection } as DataSourceOptions);
    await reset.initialize();
    await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await reset.destroy();
  }

  // 1. A plain Seerr database with one ordinary request.
  let db = await open('seerr');
  const seerrTables = await tableNames(db);
  const userId = await insertReturningId(db, 'user', {
    email: 'admin@example.com',
    username: 'admin',
    permissions: 2,
    avatar: '',
    userType: 2,
  });
  const movieId = await insertReturningId(db, 'media', {
    mediaType: 'movie',
    tmdbId: 603,
    status: 3,
    status4k: 1,
  });
  const showId = await insertReturningId(db, 'media', {
    mediaType: 'tv',
    tmdbId: 1399,
    tvdbId: 121361,
    status: 3,
    status4k: 1,
  });
  const removedMovieId = await insertReturningId(db, 'media', {
    mediaType: 'movie',
    tmdbId: 27205,
    status: 1,
    status4k: 1,
  });
  const ordinary = await insertReturningId(
    db,
    'media_request',
    request(movieId, userId, 'movie')
  );
  await db.destroy();

  // 2. VSeerr adds its tables; a user requests two versions.
  db = await open('vseerr');
  assert.deepStrictEqual(
    (await tableNames(db)).filter((name) => !seerrTables.includes(name)).sort(),
    [...VSEERR_TABLES].sort()
  );
  const movieVersion = await insertReturningId(
    db,
    'media_request',
    request(movieId, userId, 'movie', 1)
  );
  const removedVersion = await insertReturningId(
    db,
    'media_request',
    request(removedMovieId, userId, 'movie', 1)
  );
  const showVersion = await insertReturningId(
    db,
    'media_request',
    request(showId, userId, 'tv', 0)
  );
  for (const seasonNumber of [1, 2]) {
    await insertReturningId(db, 'season_request', {
      seasonNumber,
      status: 2,
      requestId: showVersion,
    });
  }
  await db
    .getRepository(VersionRequest)
    .insert([
      { requestId: movieVersion },
      { requestId: removedVersion },
      { requestId: showVersion },
    ]);
  await db.getRepository(UserVersion).insert({ userId, version: 'radarr:1' });

  // 3. Park the version requests before switching to Seerr.
  assert.strictEqual(await parkVersionRequests(db), 3);
  await db.destroy();

  // 4. Seerr sees only its own request and keeps working.
  db = await open('seerr');
  assert.deepStrictEqual(await requestIds(db), [ordinary]);
  // Seerr removes a title that only had a version request.
  await run(db, `DELETE FROM "media" WHERE "id" = ?`, [removedMovieId]);
  const addedBySeerr = await insertReturningId(
    db,
    'media_request',
    request(showId, userId, 'tv')
  );
  await db.destroy();

  // 5. Back on VSeerr, the version requests return with their seasons.
  db = await open('vseerr');
  assert.strictEqual(await db.getRepository(ParkedRequest).count(), 0);
  assert.deepStrictEqual(
    await requestIds(db),
    [ordinary, movieVersion, removedVersion, showVersion, addedBySeerr].sort(
      (a, b) => a - b
    )
  );
  const markers = (await db.getRepository(VersionRequest).find())
    .map((marker) => marker.requestId)
    .sort((a, b) => a - b);
  assert.deepStrictEqual(markers, [movieVersion, removedVersion, showVersion]);
  // The removed title was re-created for its version request.
  const [recreated] = await run(
    db,
    `SELECT "media"."tmdbId" AS "tmdbId" FROM "media_request" JOIN "media" ON "media"."id" = "media_request"."mediaId" WHERE "media_request"."id" = ?`,
    [removedVersion]
  );
  assert.strictEqual(Number(recreated.tmdbId), 27205);
  const seasons = await run(
    db,
    `SELECT "seasonNumber" FROM "season_request" WHERE "requestId" = ? ORDER BY "seasonNumber"`,
    [showVersion]
  );
  assert.deepStrictEqual(
    seasons.map((row: { seasonNumber: number }) => Number(row.seasonNumber)),
    [1, 2]
  );
  assert.strictEqual(await db.getRepository(UserVersion).count(), 1);
  // VSeerr's entities read the version flag and user versions from its own
  // tables (virtual columns), on both database types.
  const loaded = await db.getRepository(MediaRequest).find({
    order: { id: 'ASC' },
  });
  assert.deepStrictEqual(
    loaded.map((r) => [r.id, r.isServiceRequest]),
    [
      [ordinary, false],
      [movieVersion, true],
      [removedVersion, true],
      [showVersion, true],
      [addedBySeerr, false],
    ].sort((a, b) => Number(a[0]) - Number(b[0]))
  );
  const versionOnly = await db
    .getRepository(MediaRequest)
    .createQueryBuilder('request')
    .where(isVersionRequestSql('request'))
    .getCount();
  assert.strictEqual(versionOnly, 3);
  const admin = await db.getRepository(User).findOneOrFail({
    where: { id: userId },
  });
  assert.deepStrictEqual(admin.requestServices, ['radarr:1']);
  // A new request still gets a fresh id after the restore.
  const afterRestore = await insertReturningId(
    db,
    'media_request',
    request(movieId, userId, 'movie')
  );
  assert.ok(
    afterRestore >
      Math.max(movieVersion, removedVersion, showVersion, addedBySeerr)
  );

  // 6. Removing VSeerr leaves a plain Seerr database.
  assert.strictEqual(await purgeVersionData(db), 3);
  await db.destroy();
  db = await open('seerr');
  assert.deepStrictEqual(await tableNames(db), seerrTables);
  assert.deepStrictEqual(await requestIds(db), [
    ordinary,
    addedBySeerr,
    afterRestore,
  ]);
  await db.destroy();

  log('round trip passed');
};

main()
  .then(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  })
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
