import type { MigrationInterface, QueryRunner } from 'typeorm';

// The identity of each Seerr user and title VSeerr's tables point to, so a
// reused id does not inherit another user's versions or another title's
// availability (see server/lib/versionDatabase.ts). Like VSeerr's other
// tables it has no foreign keys to Seerr's tables. IF (NOT) EXISTS because
// VSeerr also runs up() at startup to re-create missing tables.
export class VSeerrAddRowIdentity1793652825970 implements MigrationInterface {
  name = 'VSeerrAddRowIdentity1793652825970';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "vseerr_row_identity" ("kind" character varying NOT NULL, "rowId" integer NOT NULL, "fingerprint" text NOT NULL, CONSTRAINT "PK_vseerr_row_identity" PRIMARY KEY ("kind", "rowId"))`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "vseerr_row_identity"`);
  }
}
