import {
  ParkedRequest,
  RowIdentity,
  VersionRequest,
} from '@server/entity/VSeerrVersions';
import {
  SERVICE_STATUS_TABLE,
  USER_PREFERENCE_TABLE,
  USER_VERSION_TABLE,
  VERSION_REQUEST_TABLE,
  VSEERR_TABLES,
} from '@server/lib/versionSql';
import logger from '@server/logger';
import { VSeerrAddVersions1790680026383 as PostgresVersionTables } from '@server/migration/postgres/1790680026383-VSeerrAddVersions';
import { VSeerrAddUserPreferences1793601938700 as PostgresPreferenceTable } from '@server/migration/postgres/1793601938700-VSeerrAddUserPreferences';
import { VSeerrAddRowIdentity1793652825970 as PostgresIdentityTable } from '@server/migration/postgres/1793652825970-VSeerrAddRowIdentity';
import { VSeerrAddVersions1790679971018 as SqliteVersionTables } from '@server/migration/sqlite/1790679971018-VSeerrAddVersions';
import { VSeerrAddUserPreferences1793601938687 as SqlitePreferenceTable } from '@server/migration/sqlite/1793601938687-VSeerrAddUserPreferences';
import { VSeerrAddRowIdentity1793652825955 as SqliteIdentityTable } from '@server/migration/sqlite/1793652825955-VSeerrAddRowIdentity';
import type { DataSource, EntityManager } from 'typeorm';

// Keeps one database usable by both Seerr and VSeerr.
//
// VSeerr's data lives in its own `vseerr_*` tables, which Seerr ignores.
// Version requests themselves are rows in Seerr's `media_request` table,
// though, and Seerr would treat them as ordinary requests. Before a database
// goes back to Seerr they are "parked": copied into `vseerr_parked_request`
// and removed from Seerr's tables. VSeerr puts them back when it starts.

const LABEL = { label: 'Versions' };

/** VSeerr's table migrations, oldest first. */
const tableMigrations = (dataSource: DataSource) =>
  dataSource.options.type === 'postgres'
    ? [
        new PostgresVersionTables(),
        new PostgresPreferenceTable(),
        new PostgresIdentityTable(),
      ]
    : [
        new SqliteVersionTables(),
        new SqlitePreferenceTable(),
        new SqliteIdentityTable(),
      ];

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
    for (const migration of tableMigrations(dataSource)) {
      await migration.up(queryRunner);
    }
  } finally {
    await queryRunner.release();
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

/**
 * Whole rows of one of Seerr's tables, to be stored as JSON and inserted
 * again later. Postgres builds the JSON itself: through the driver, its
 * timestamps (without time zone) would become JavaScript dates in the
 * process's time zone and come back shifted.
 */
const selectRows = async (
  manager: EntityManager,
  table: string,
  column: string,
  value: unknown
): Promise<Row[]> => {
  if (manager.connection.options.type !== 'postgres') {
    return sql(manager, `SELECT * FROM "${table}" WHERE "${column}" = ?`, [
      value,
    ]);
  }
  const rows = await sql(
    manager,
    `SELECT row_to_json("row")::text AS "json" FROM "${table}" "row" WHERE "${column}" = ?`,
    [value]
  );
  return rows.map((row) => JSON.parse(String(row.json)) as Row);
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

// Row identities.
//
// VSeerr's rows point to Seerr's users, titles and requests by id only. A
// deleted row's id is normally never handed out again, but on SQLite it can
// be: Seerr's migrations rebuild whole tables, which resets the id counter,
// so after the highest id is deleted the next new row gets it. Without a
// check, a new user would inherit a deleted user's versions, and a new title
// a deleted title's availability.
//
// So VSeerr keeps a fingerprint of each row it points to (vseerr_row_identity)
// and compares it when it starts. A row is the same one if any part of the
// fingerprint still matches; a user who changed their email still has the
// same creation time. When nothing matches, the id now belongs to someone
// or something else, and VSeerr forgets what it had stored for it.
type IdentityKind = 'user' | 'media' | 'request';
const IDENTITY_KINDS: IdentityKind[] = ['user', 'media', 'request'];

/** A creation time, compared to the second whatever the stored format. */
const timeKey = (value: unknown): string | null => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 14 ? `time:${digits.slice(0, 14)}` : null;
};

const textKey = (prefix: string, value: unknown): string | null =>
  value == null || value === '' ? null : `${prefix}:${String(value)}`;

const identitySpecs: Record<
  IdentityKind,
  {
    table: string;
    /** Columns the fingerprint is built from; `true` for a timestamp. */
    columns: [string, boolean][];
    keys: (row: Row) => (string | null)[];
  }
> = {
  user: {
    table: 'user',
    columns: [
      ['createdAt', true],
      ['email', false],
      ['plexId', false],
      ['jellyfinUserId', false],
    ],
    keys: (row) => [
      timeKey(row.createdAt),
      textKey('email', row.email && String(row.email).toLowerCase()),
      textKey('plex', row.plexId),
      textKey('jellyfin', row.jellyfinUserId),
    ],
  },
  media: {
    table: 'media',
    columns: [
      ['mediaType', false],
      ['tmdbId', false],
    ],
    keys: (row) => [
      row.mediaType != null && row.tmdbId != null
        ? `title:${row.mediaType}:${row.tmdbId}`
        : null,
    ],
  },
  // A request's user and title can change (an admin can reassign it, a
  // restore can re-create its title); its creation time does not.
  request: {
    table: 'media_request',
    columns: [['createdAt', true]],
    keys: (row) => [timeKey(row.createdAt)],
  },
};

/**
 * The current fingerprint of each of the given rows that still exists, or
 * undefined if the table has none of the fingerprint's columns any more.
 */
const currentIdentities = async (
  manager: EntityManager,
  kind: IdentityKind,
  ids: number[]
): Promise<Map<number, string[]> | undefined> => {
  const spec = identitySpecs[kind];
  const present = await columnsOf(manager, spec.table);
  const columns = spec.columns.filter(([name]) => present.has(name));
  if (columns.length === 0) {
    return undefined;
  }
  const select = columns
    .map(([name, isTime]) =>
      isTime ? `CAST("${name}" AS TEXT) AS "${name}"` : `"${name}"`
    )
    .join(', ');
  const found = new Map<number, string[]>();
  for (let start = 0; start < ids.length; start += 500) {
    const chunk = ids.slice(start, start + 500);
    const rows = await sql(
      manager,
      `SELECT "id", ${select} FROM "${spec.table}" WHERE "id" IN (${chunk.map(() => '?').join(', ')})`,
      chunk
    );
    for (const row of rows) {
      found.set(
        Number(row.id),
        spec.keys(row).filter((key): key is string => key !== null)
      );
    }
  }
  return found;
};

/** The Seerr rows VSeerr's tables point to, by kind. */
const referencedRows = async (
  manager: EntityManager
): Promise<Record<IdentityKind, Set<number>>> => {
  const ids: Record<IdentityKind, Set<number>> = {
    user: new Set(),
    media: new Set(),
    request: new Set(),
  };
  const references: [IdentityKind, string, string][] = [
    ['user', USER_VERSION_TABLE, 'userId'],
    ['user', USER_PREFERENCE_TABLE, 'userId'],
    ['media', SERVICE_STATUS_TABLE, 'mediaId'],
    ['request', VERSION_REQUEST_TABLE, 'requestId'],
  ];
  for (const [kind, table, column] of references) {
    for (const row of await sql(
      manager,
      `SELECT DISTINCT "${column}" AS "id" FROM "${table}"`
    )) {
      ids[kind].add(Number(row.id));
    }
  }
  // Parked requests keep their users' ids; their titles are found again by
  // TMDB id when they are restored.
  for (const entry of await manager.find(ParkedRequest)) {
    const request = JSON.parse(entry.request) as Row;
    for (const id of [request.requestedById, request.modifiedById]) {
      if (id != null) {
        ids.user.add(Number(id));
      }
    }
  }
  return ids;
};

/**
 * Stores the fingerprint of every Seerr row VSeerr's tables point to, and
 * drops fingerprints nothing points to any more.
 */
export const recordRowIdentities = async (
  manager: EntityManager
): Promise<void> => {
  const referenced = await referencedRows(manager);
  const stored = new Map(
    (await manager.find(RowIdentity)).map((entry) => [
      `${entry.kind}:${entry.rowId}`,
      entry.fingerprint,
    ])
  );
  for (const kind of IDENTITY_KINDS) {
    const current = await currentIdentities(manager, kind, [
      ...referenced[kind],
    ]);
    if (!current) {
      continue;
    }
    const added: RowIdentity[] = [];
    for (const [rowId, keys] of current) {
      const fingerprint = JSON.stringify(keys);
      const before = stored.get(`${kind}:${rowId}`);
      if (before === undefined) {
        added.push(
          Object.assign(new RowIdentity(), { kind, rowId, fingerprint })
        );
      } else if (before !== fingerprint) {
        await manager.update(RowIdentity, { kind, rowId }, { fingerprint });
      }
    }
    for (let start = 0; start < added.length; start += 100) {
      await manager.insert(RowIdentity, added.slice(start, start + 100));
    }
    for (const key of stored.keys()) {
      const [storedKind, id] = key.split(':');
      if (storedKind === kind && !current.has(Number(id))) {
        await manager.delete(RowIdentity, { kind, rowId: Number(id) });
      }
    }
  }
};

/**
 * Forgets what VSeerr stored for users, titles and requests whose id now
 * belongs to a different row (see the note on row identities above).
 */
const forgetReplacedRows = async (manager: EntityManager): Promise<void> => {
  const stored = await manager.find(RowIdentity);
  const replaced: Record<IdentityKind, Set<number>> = {
    user: new Set(),
    media: new Set(),
    request: new Set(),
  };
  for (const kind of IDENTITY_KINDS) {
    const entries = stored.filter((entry) => entry.kind === kind);
    if (entries.length === 0) {
      continue;
    }
    const current = await currentIdentities(
      manager,
      kind,
      entries.map((entry) => entry.rowId)
    );
    for (const entry of entries) {
      const keys = current?.get(entry.rowId);
      const before = JSON.parse(entry.fingerprint) as string[];
      if (
        keys?.length &&
        before.length &&
        !keys.some((key) => before.includes(key))
      ) {
        replaced[kind].add(entry.rowId);
      }
    }
  }

  const removeFor = async (table: string, column: string, ids: Set<number>) => {
    for (const id of ids) {
      await sql(manager, `DELETE FROM "${table}" WHERE "${column}" = ?`, [id]);
    }
  };
  await removeFor(USER_VERSION_TABLE, 'userId', replaced.user);
  await removeFor(USER_PREFERENCE_TABLE, 'userId', replaced.user);
  await removeFor(SERVICE_STATUS_TABLE, 'mediaId', replaced.media);
  await removeFor(VERSION_REQUEST_TABLE, 'requestId', replaced.request);
  if (replaced.user.size > 0) {
    for (const entry of await manager.find(ParkedRequest)) {
      const request = JSON.parse(entry.request) as Row;
      if (replaced.user.has(Number(request.requestedById))) {
        logger.warn(
          `Dropping parked version request ${entry.requestId}: its user was deleted`,
          LABEL
        );
        await manager.delete(ParkedRequest, { requestId: entry.requestId });
      } else if (
        request.modifiedById != null &&
        replaced.user.has(Number(request.modifiedById))
      ) {
        await manager.update(
          ParkedRequest,
          { requestId: entry.requestId },
          { request: JSON.stringify({ ...request, modifiedById: null }) }
        );
      }
    }
  }
  for (const kind of IDENTITY_KINDS) {
    for (const rowId of replaced[kind]) {
      await manager.delete(RowIdentity, { kind, rowId });
    }
    if (replaced[kind].size > 0) {
      logger.warn(
        `Forgot version data of ${replaced[kind].size} deleted ${kind === 'media' ? 'title' : kind}(s) whose id was given to a new one`,
        LABEL
      );
    }
  }
};

/**
 * Deletes version data whose request, title or user no longer exists, or
 * whose id now belongs to a different one. VSeerr's tables have no foreign
 * keys to Seerr's tables (so they can never block a Seerr migration), which
 * means nothing cascades automatically.
 */
export const removeVersionOrphans = async (
  manager: EntityManager
): Promise<void> => {
  const statements: [string, string, string][] = [
    [VERSION_REQUEST_TABLE, 'requestId', 'media_request'],
    [SERVICE_STATUS_TABLE, 'mediaId', 'media'],
    [USER_VERSION_TABLE, 'userId', 'user'],
    [USER_PREFERENCE_TABLE, 'userId', 'user'],
  ];
  for (const [table, column, parent] of statements) {
    await manager.query(
      `DELETE FROM "${table}" WHERE "${column}" NOT IN (SELECT "id" FROM "${parent}")`
    );
  }
  await forgetReplacedRows(manager);
};

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
      const [request] = await selectRows(
        manager,
        'media_request',
        'id',
        requestId
      );
      if (!request) {
        continue;
      }
      const seasons = await selectRows(
        manager,
        'season_request',
        'requestId',
        requestId
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
    // Fingerprint the users of the parked requests while they are known, so
    // a new user given one of their ids in Seerr does not get them back.
    await recordRowIdentities(manager);
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

      // The original id is normally free. On SQLite a Seerr migration that
      // rebuilt the table can hand it to a new request; then use a new id.
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
      // Explicit ids do not move the sequence; keep it past the highest id,
      // and never move it back.
      await manager.query(
        `SELECT setval(pg_get_serial_sequence('"media_request"', 'id'), GREATEST((SELECT MAX("id") FROM "media_request"), pg_sequence_last_value(pg_get_serial_sequence('"media_request"', 'id')::regclass)))`
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
  await dataSource.transaction((manager) => removeVersionOrphans(manager));
  const restored = await restoreParkedRequests(dataSource);
  if (restored > 0) {
    logger.info(`Restored ${restored} parked version request(s)`, LABEL);
  }
  await dataSource.transaction((manager) => recordRowIdentities(manager));
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
    for (const migration of tableMigrations(dataSource).reverse()) {
      await migration.down(queryRunner);
    }
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
