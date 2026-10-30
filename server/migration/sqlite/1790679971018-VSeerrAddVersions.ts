import type { MigrationInterface, QueryRunner } from 'typeorm';

// VSeerr keeps all version data in tables of its own, so a database stays
// usable by Seerr and Seerr's migrations never touch it. The tables have no
// foreign keys to Seerr's tables, so they can never block a Seerr migration;
// VSeerr removes rows whose parent is gone when it starts.
//
// Statements use IF EXISTS / IF NOT EXISTS because VSeerr also runs up() at
// startup to re-create tables that are missing (see versionDatabase.ts).
export class VSeerrAddVersions1790679971018 implements MigrationInterface {
  name = 'VSeerrAddVersions1790679971018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "vseerr_service_status" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "mediaId" integer NOT NULL, "serviceId" integer NOT NULL, "serviceType" varchar NOT NULL, "status" integer NOT NULL DEFAULT (1), "externalServiceId" integer, "externalServiceSlug" varchar, "seasonStatuses" text)`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_vseerr_service_status_media" ON "vseerr_service_status" ("mediaId") `
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_vseerr_service_status_service" ON "vseerr_service_status" ("serviceId") `
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vseerr_service_status_media_service" ON "vseerr_service_status" ("mediaId", "serviceId") `
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "vseerr_version_request" ("requestId" integer PRIMARY KEY NOT NULL, "createdAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP))`
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "vseerr_user_version" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "userId" integer NOT NULL, "version" varchar NOT NULL)`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vseerr_user_version_user_version" ON "vseerr_user_version" ("userId", "version") `
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_vseerr_user_version_user" ON "vseerr_user_version" ("userId") `
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "vseerr_parked_request" ("requestId" integer PRIMARY KEY NOT NULL, "request" text NOT NULL, "seasons" text NOT NULL, "media" text NOT NULL, "parkedAt" datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP))`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "vseerr_parked_request"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vseerr_user_version"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vseerr_version_request"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "vseerr_service_status"`);
  }
}
