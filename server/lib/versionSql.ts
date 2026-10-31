import { isPgsql } from '@server/utils/dbType';

// VSeerr stores everything about versions in tables of its own instead of
// adding columns to Seerr's tables. Seerr ignores these tables, and Seerr's
// own migrations, which on SQLite rebuild whole tables and drop columns they
// do not know, never touch them. That keeps one database usable by both
// Seerr and VSeerr.
//
// This file must stay free of entity imports: entity decorators use it.

export const VERSION_REQUEST_TABLE = 'vseerr_version_request';
export const USER_VERSION_TABLE = 'vseerr_user_version';
export const SERVICE_STATUS_TABLE = 'vseerr_service_status';
export const PARKED_REQUEST_TABLE = 'vseerr_parked_request';
export const VSEERR_TABLES = [
  USER_VERSION_TABLE,
  VERSION_REQUEST_TABLE,
  SERVICE_STATUS_TABLE,
  PARKED_REQUEST_TABLE,
];

/**
 * SQL condition that is true when the request with the given alias is a
 * version request. Pass a query builder alias such as `request`, or an
 * escaped one such as `"request"`.
 */
export const isVersionRequestSql = (alias: string): string =>
  `EXISTS (SELECT 1 FROM "${VERSION_REQUEST_TABLE}" "vseerr_vr" WHERE "vseerr_vr"."requestId" = ${alias}."id")`;

/** SQL expression listing a user's versions, separated by commas. */
export const userVersionsSql = (alias: string): string =>
  isPgsql
    ? `(SELECT string_agg("vseerr_uv"."version", ',' ORDER BY "vseerr_uv"."version") FROM "${USER_VERSION_TABLE}" "vseerr_uv" WHERE "vseerr_uv"."userId" = ${alias}."id")`
    : `(SELECT group_concat("vseerr_uv"."version", ',') FROM (SELECT "version" FROM "${USER_VERSION_TABLE}" WHERE "userId" = ${alias}."id" ORDER BY "version") "vseerr_uv")`;

export const booleanFromDb = (value: unknown): boolean =>
  value === true || value === 1 || value === '1' || value === 't';

export const versionsFromDb = (value: unknown): string[] =>
  typeof value === 'string' && value.length > 0 ? value.split(',') : [];
