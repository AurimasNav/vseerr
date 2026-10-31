import { ParkedRequest, VersionRequest } from '@server/entity/VSeerrVersions';
import {
  SERVICE_STATUS_TABLE,
  USER_VERSION_TABLE,
  VERSION_REQUEST_TABLE,
  VSEERR_TABLES,
} from '@server/lib/versionSql';
import logger from '@server/logger';
import { VSeerrAddVersions1790680026383 as PostgresVersionTables } from '@server/migration/postgres/1790680026383-VSeerrAddVersions';
import { VSeerrAddVersions1790679971018 as SqliteVersionTables } from '@server/migration/sqlite/1790679971018-VSeerrAddVersions';
import type { DataSource, EntityManager } from 'typeorm';

// Keeps one database usable by both Seerr and VSeerr.
//
// VSeerr's data lives in its own `vseerr_*` tables, which Seerr ignores.
// Version requests themselves are rows in Seerr's `media_request` table,
// though, and Seerr would treat them as ordinary requests. Before a database
// goes back to Seerr they are "parked": copied into `vseerr_parked_request`
// and removed from Seerr's tables. VSeerr puts them back when it starts.

const LABEL = { label: 'Versions' };

const tablesMigration = (dataSource: DataSource) =>
  dataSource.options.type === 'postgres'
    ? new PostgresVersionTables()
    : new SqliteVersionTables();

/**
 * Creates VSeerr's tables if any are missing. Covers a database whose
 * migration history says VSeerr's tables exist when they do not, for example
 * after a restore of only Seerr's tables.
 */
export const ensureVersionTables = async (
  dataSource: DataSource
): Promise<void> => {
  const queryRunner = dataSource.createQueryRunner();
  try {
    const existing: boolean[] = [];
    for (const table of VSEERR_TABLES) {
      existing.push(await queryRunner.hasTable(table));
    }
    if (existing.every(Boolean)) {
      return;
    }
    logger.info('Creating missing VSeerr tables', LABEL);
    await tablesMigration(dataSource).up(queryRunner);
  } finally {
    await queryRunner.release();
  }
};

/**
 * Deletes version data whose request, title or user no longer exists.
 * VSeerr's tables have no foreign keys to Seerr's tables (so they can never
 * block a Seerr migration), which means nothing cascades automatically.
 */
export const removeVersionOrphans = async (
  manager: EntityManager
): Promise<void> => {
  const statements: [string, string, string][] = [
    [VERSION_REQUEST_TABLE, 'requestId', 'media_request'],
    [SERVICE_STATUS_TABLE, 'mediaId', 'media'],
    [USER_VERSION_TABLE, 'userId', 'user'],
  ];
  for (const [table, column, parent] of statements) {
    await manager.query(
      `DELETE FROM "${table}" WHERE "${column}" NOT IN (SELECT "id" FROM "${parent}")`
    );
  }
};

// Seerr's tables are read and written with plain SQL: TypeORM would map
// them to Seerr's entities, drop columns it does not know and run Seerr's
// subscribers, which talk to Radarr and Sonarr.
type Row = Record<string, unknown>;

const sql = (
  manager: EntityManager,
  text: string,
  parameters: unknown[] = []
): Promise<Row[]> => {
  let index = 0;
  const query =
    manager.connection.options.type === 'postgres'
      ? text.replace(/\?/g, () => `$${++index}`)
      : text;
  return manager.query(query, parameters);
};

/** Column names of a table as they exist in the database. */
const columnsOf = async (
  manager: EntityManager,
  table: string
): Promise<Set<string>> => {
  const queryRunner =
    manager.queryRunner ?? manager.connection.createQueryRunner();
  try {
    const found = await queryRunner.getTable(table);
    return new Set(found?.columns.map((column) => column.name) ?? []);
  } finally {
    if (!manager.queryRunner) {
      await queryRunner.release();
    }
  }
};

/** Inserts a row, keeping only columns the table has. */
const insertRow = async (
  manager: EntityManager,
  table: string,
  row: Row,
  columns: Set<string>
): Promise<void> => {
  const names = Object.keys(row).filter((name) => columns.has(name));
  await sql(
    manager,
    `INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
    names.map((name) => row[name])
  );
};

const rowExists = async (
  manager: EntityManager,
  table: string,
  id: unknown
): Promise<boolean> =>
  id != null &&
  (
    await sql(manager, `SELECT 1 AS "found" FROM "${table}" WHERE "id" = ?`, [
      id,
    ])
  ).length > 0;

/**
 * Moves every version request out of Seerr's tables into
 * `vseerr_parked_request`. Run with VSeerr stopped, before starting Seerr
 * on the same database. Returns the number of parked requests.
 */
export const parkVersionRequests = async (
  dataSource: DataSource
): Promise<number> =>
  dataSource.transaction(async (manager) => {
    await removeVersionOrphans(manager);
    const markers = await manager.find(VersionRequest);

    for (const { requestId } of markers) {
      const [request] = await sql(
        manager,
        `SELECT * FROM "media_request" WHERE "id" = ?`,
        [requestId]
      );
      if (!request) {
        continue;
      }
      const seasons = await sql(
        manager,
        `SELECT * FROM "season_request" WHERE "requestId" = ?`,
        [requestId]
      );
      const [media] = await sql(
        manager,
        `SELECT "mediaType", "tmdbId", "tvdbId" FROM "media" WHERE "id" = ?`,
        [request.mediaId]
      );

      await manager.insert(ParkedRequest, {
        requestId,
        request: JSON.stringify(request),
        seasons: JSON.stringify(seasons),
        media: JSON.stringify(media ?? {}),
      });
      await sql(manager, `DELETE FROM "season_request" WHERE "requestId" = ?`, [
        requestId,
      ]);
      await sql(manager, `DELETE FROM "media_request" WHERE "id" = ?`, [
        requestId,
      ]);
    }

    await manager.createQueryBuilder().delete().from(VersionRequest).execute();
    return markers.length;
  });

/** Finds the title's media row, creating it if Seerr removed it. */
const mediaIdFor = async (
  manager: EntityManager,
  media: { mediaType: string; tmdbId: number; tvdbId?: number | null }
): Promise<number> => {
  const find = () =>
    sql(
      manager,
      `SELECT "id" FROM "media" WHERE "tmdbId" = ? AND "mediaType" = ?`,
      [media.tmdbId, media.mediaType]
    );
  let [row] = await find();
  if (!row) {
    await sql(
      manager,
      `INSERT INTO "media" ("mediaType", "tmdbId", "tvdbId") VALUES (?, ?, ?)`,
      [media.mediaType, media.tmdbId, media.tvdbId ?? null]
    );
    [row] = await find();
  }
  return Number(row.id);
};

/**
 * Puts parked version requests back. Requests whose user was deleted in the
 * meantime are dropped. Returns the number of restored requests.
 */
export const restoreParkedRequests = async (
  dataSource: DataSource
): Promise<number> => {
  const parked = await dataSource.getRepository(ParkedRequest).find();
  if (parked.length === 0) {
    return 0;
  }

  let restored = 0;

  await dataSource.transaction(async (manager) => {
    const requestColumns = await columnsOf(manager, 'media_request');
    // Season rows get new ids; only the request keeps its original one.
    const seasonColumns = await columnsOf(manager, 'season_request');
    seasonColumns.delete('id');

    for (const entry of parked) {
      const request = JSON.parse(entry.request) as Row;
      const seasons = JSON.parse(entry.seasons) as Row[];
      const media = JSON.parse(entry.media) as {
        mediaType?: string;
        tmdbId?: number;
        tvdbId?: number | null;
      };

      if (
        !media.tmdbId ||
        !media.mediaType ||
        !(await rowExists(manager, 'user', request.requestedById))
      ) {
        logger.warn(
          `Dropping parked version request ${entry.requestId}: its user or title is missing`,
          LABEL
        );
        await manager.delete(ParkedRequest, { requestId: entry.requestId });
        continue;
      }

      // Ids are never reused by SQLite or Postgres, so the original id is
      // normally free; fall back to a new one if it is not.
      let requestId = entry.requestId;
      if (await rowExists(manager, 'media_request', requestId)) {
        const [{ maxId }] = await sql(
          manager,
          `SELECT MAX("id") AS "maxId" FROM "media_request"`
        );
        requestId = Number(maxId) + 1;
      }

      await insertRow(
        manager,
        'media_request',
        {
          ...request,
          id: requestId,
          mediaId: await mediaIdFor(manager, {
            mediaType: media.mediaType,
            tmdbId: media.tmdbId,
            tvdbId: media.tvdbId,
          }),
          modifiedById: (await rowExists(manager, 'user', request.modifiedById))
            ? request.modifiedById
            : null,
        },
        requestColumns
      );
      for (const season of seasons) {
        await insertRow(
          manager,
          'season_request',
          { ...season, requestId },
          seasonColumns
        );
      }

      await manager.insert(VersionRequest, { requestId });
      await manager.delete(ParkedRequest, { requestId: entry.requestId });
      restored += 1;
    }

    if (dataSource.options.type === 'postgres' && restored > 0) {
      // Explicit ids do not move the sequence; keep it past the highest id.
      await manager.query(
        `SELECT setval(pg_get_serial_sequence('"media_request"', 'id'), (SELECT MAX("id") FROM "media_request"))`
      );
    }
  });

  return restored;
};

/** Runs at startup, after migrations. */
export const prepareVersionDatabase = async (
  dataSource: DataSource
): Promise<void> => {
  await ensureVersionTables(dataSource);
  await removeVersionOrphans(dataSource.manager);
  const restored = await restoreParkedRequests(dataSource);
  if (restored > 0) {
    logger.info(`Restored ${restored} parked version request(s)`, LABEL);
  }
};

/**
 * Removes everything VSeerr added, leaving a database exactly as Seerr
 * expects it. Version requests are deleted, not parked.
 */
export const purgeVersionData = async (
  dataSource: DataSource
): Promise<number> => {
  const parked = await parkVersionRequests(dataSource);
  const queryRunner = dataSource.createQueryRunner();
  try {
    await queryRunner.startTransaction();
    await tablesMigration(dataSource).down(queryRunner);
    if (await queryRunner.hasTable('migrations')) {
      await queryRunner.query(
        `DELETE FROM "migrations" WHERE "name" LIKE 'VSeerr%'`
      );
    }
    await queryRunner.commitTransaction();
  } catch (e) {
    await queryRunner.rollbackTransaction();
    throw e;
  } finally {
    await queryRunner.release();
  }
  return parked;
};
