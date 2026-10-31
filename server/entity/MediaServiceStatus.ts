import { MediaStatus } from '@server/constants/media';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import { SERVICE_STATUS_TABLE } from '@server/lib/versionSql';
import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import Media from './Media';

// Availability of a title in each version. VSeerr's own table, see
// server/lib/versionSql.ts.
@Entity({ name: SERVICE_STATUS_TABLE })
@Index('IDX_vseerr_service_status_media_service', ['mediaId', 'serviceId'], {
  unique: true,
})
class MediaServiceStatus {
  @PrimaryGeneratedColumn({
    primaryKeyConstraintName: 'PK_vseerr_service_status',
  })
  public id: number;

  @Column()
  @Index('IDX_vseerr_service_status_media')
  public mediaId: number;

  @ManyToOne(() => Media, (media) => media.serviceStatuses, {
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'mediaId' })
  public media: Media;

  @Column({ type: 'int' })
  @Index('IDX_vseerr_service_status_service')
  public serviceId: number;

  @Column({ type: 'varchar' })
  public serviceType: 'radarr' | 'sonarr';

  @Column({ type: 'int', default: MediaStatus.UNKNOWN })
  public status: MediaStatus;

  @Column({ nullable: true, type: 'int' })
  public externalServiceId: number | null;

  @Column({ nullable: true, type: 'varchar' })
  public externalServiceSlug: string | null;

  @Column({
    type: 'text',
    nullable: true,
    transformer: {
      from: (value: string | null): Record<number, MediaStatus> | null => {
        if (!value) return null;
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      },
      to: (value: Record<number, MediaStatus> | null): string | null => {
        if (!value || Object.keys(value).length === 0) return null;
        return JSON.stringify(value);
      },
    },
  })
  public seasonStatuses: Record<number, MediaStatus> | null;

  public downloadStatus?: DownloadingItem[] = [];

  constructor(init?: Partial<MediaServiceStatus>) {
    Object.assign(this, init);
  }
}

export default MediaServiceStatus;
