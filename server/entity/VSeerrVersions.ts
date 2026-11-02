import type { MediaRequest } from '@server/entity/MediaRequest';
import {
  PARKED_REQUEST_TABLE,
  USER_PREFERENCE_TABLE,
  USER_VERSION_TABLE,
  VERSION_REQUEST_TABLE,
} from '@server/lib/versionSql';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Marks a media request as a version request. The request itself stays a
 * normal row in Seerr's `media_request` table.
 */
@Entity({ name: VERSION_REQUEST_TABLE })
export class VersionRequest {
  @PrimaryColumn({ primaryKeyConstraintName: 'PK_vseerr_version_request' })
  public requestId: number;

  @OneToOne('MediaRequest', 'versionMarker', {
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'requestId' })
  public request: MediaRequest;

  @CreateDateColumn()
  public createdAt: Date;

  constructor(init?: Partial<VersionRequest>) {
    Object.assign(this, init);
  }
}

/** A version (`radarr:<id>` or `sonarr:<id>`) a user may request. */
@Entity({ name: USER_VERSION_TABLE })
@Index('IDX_vseerr_user_version_user_version', ['userId', 'version'], {
  unique: true,
})
export class UserVersion {
  @PrimaryGeneratedColumn({
    primaryKeyConstraintName: 'PK_vseerr_user_version',
  })
  public id: number;

  @Column()
  @Index('IDX_vseerr_user_version_user')
  public userId: number;

  @Column({ type: 'varchar' })
  public version: string;

  constructor(init?: Partial<UserVersion>) {
    Object.assign(this, init);
  }
}

/**
 * A version request moved out of Seerr's tables before switching the
 * database to Seerr (see server/lib/versionDatabase.ts). The rows are kept
 * as JSON and put back when VSeerr starts again.
 */
@Entity({ name: PARKED_REQUEST_TABLE })
export class ParkedRequest {
  @PrimaryColumn({ primaryKeyConstraintName: 'PK_vseerr_parked_request' })
  public requestId: number;

  @Column({ type: 'text' })
  public request: string;

  @Column({ type: 'text' })
  public seasons: string;

  @Column({ type: 'text' })
  public media: string;

  @CreateDateColumn()
  public parkedAt: Date;
}

/**
 * A user's request dialog preference, kept per account so it follows them
 * across devices. `name` is `default-version-<movie|tv>` (value: the
 * version key, e.g. `radarr:2` or `standard`) or
 * `option-<movie|tv>-<version key>` (value: the ticked request option id).
 */
@Entity({ name: USER_PREFERENCE_TABLE })
@Index('IDX_vseerr_user_preference_user_name', ['userId', 'name'], {
  unique: true,
})
export class UserPreference {
  @PrimaryGeneratedColumn({
    primaryKeyConstraintName: 'PK_vseerr_user_preference',
  })
  public id: number;

  @Column()
  public userId: number;

  @Column({ type: 'varchar' })
  public name: string;

  @Column({ type: 'varchar' })
  public value: string;

  constructor(init?: Partial<UserPreference>) {
    Object.assign(this, init);
  }
}
