import { MediaRequestStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import { isVersionRequestSql } from '@server/lib/versionSql';
import type { Repository } from 'typeorm';

// Users without the Manage Requests permission request one version of each
// title: the standard one or one of their versions. A declined request does
// not count, so the user can then pick again. 4K requests are separate and
// not limited.

/**
 * Whether the user already has a non-4K request for this title in a version
 * other than `serverId` (`undefined` = the standard version).
 */
export const holdsOtherVersion = async (
  repository: Repository<MediaRequest>,
  {
    mediaId,
    userId,
    serverId,
  }: { mediaId: number; userId: number; serverId?: number }
): Promise<boolean> => {
  const rows = await repository
    .createQueryBuilder('request')
    .innerJoin('request.media', 'media')
    .innerJoin('request.requestedBy', 'user')
    .select('request.serverId', 'serverId')
    .addSelect(
      `CASE WHEN ${isVersionRequestSql('request')} THEN 1 ELSE 0 END`,
      'isVersion'
    )
    .where('media.id = :mediaId', { mediaId })
    .andWhere('user.id = :userId', { userId })
    .andWhere('request.is4k = :is4k', { is4k: false })
    .andWhere('request.status != :declined', {
      declined: MediaRequestStatus.DECLINED,
    })
    .getRawMany<{ serverId: number | null; isVersion: number | string }>();

  return rows.some((row) => {
    const isVersion = Number(row.isVersion) === 1;
    return serverId === undefined
      ? isVersion
      : !isVersion || Number(row.serverId) !== serverId;
  });
};
