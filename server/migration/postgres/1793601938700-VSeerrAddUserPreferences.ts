import type { MigrationInterface, QueryRunner } from 'typeorm';

// Request dialog preferences per user (default version, ticked request
// option), so they follow the account instead of the browser. Like VSeerr's
// other tables it has no foreign keys to Seerr's tables; VSeerr removes rows
// of deleted users when it starts. IF (NOT) EXISTS because VSeerr also runs
// up() at startup to re-create missing tables (see versionDatabase.ts).
export class VSeerrAddUserPreferences1793601938700 implements MigrationInterface {
  name = 'VSeerrAddUserPreferences1793601938700';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "vseerr_user_preference" ("id" SERIAL NOT NULL, "userId" integer NOT NULL, "name" character varying NOT NULL, "value" character varying NOT NULL, CONSTRAINT "PK_vseerr_user_preference" PRIMARY KEY ("id"))`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_vseerr_user_preference_user_name" ON "vseerr_user_preference" ("userId", "name") `
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "vseerr_user_preference"`);
  }
}
