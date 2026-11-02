import { MediaRequestStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import MediaServiceStatus from '@server/entity/MediaServiceStatus';
import { removeVersionEverywhere } from '@server/lib/versions';
import { isVersionRequestSql } from '@server/lib/versionSql';
import logger from '@server/logger';
import { In } from 'typeorm';

export async function removeRequestServiceGrants(
  serviceType: 'radarr' | 'sonarr',
  serviceId: number
): Promise<void> {
  await removeVersionEverywhere(`${serviceType}:${serviceId}`);
}

/**
 * VSeerr: a version is gone, because its server was deleted or lost its
 * version name. Its grants and default go, its open requests are declined,
 * and (for a deleted server) the statuses recorded for it are removed.
 * Server ids are reused by the next server that is added, which must not
 * inherit any of this.
 */
export async function retireVersion(
  serviceType: 'radarr' | 'sonarr',
  serviceId: number,
  { keepStatuses = false }: { keepStatuses?: boolean } = {}
): Promise<void> {
  await removeRequestServiceGrants(serviceType, serviceId);

  const requestRepository = getRepository(MediaRequest);
  const open = await requestRepository
    .createQueryBuilder('request')
    .innerJoin('request.media', 'media')
    .select('request.id', 'id')
    .where(isVersionRequestSql('request'))
    .andWhere('request.serverId = :serviceId', { serviceId })
    .andWhere('media.mediaType = :mediaType', {
      mediaType: serviceType === 'radarr' ? MediaType.MOVIE : MediaType.TV,
    })
    // Failed ones too: a retry would go to whatever server gets this id next.
    .andWhere('request.status IN (:...statuses)', {
      statuses: [
        MediaRequestStatus.PENDING,
        MediaRequestStatus.APPROVED,
        MediaRequestStatus.FAILED,
      ],
    })
    .getRawMany<{ id: number }>();

  if (open.length > 0) {
    const requests = await requestRepository.find({
      where: { id: In(open.map((row) => Number(row.id))) },
      relations: { media: true },
    });
    for (const request of requests) {
      request.status = MediaRequestStatus.DECLINED;
      await requestRepository.save(request);
    }
    logger.info(
      `Declined ${requests.length} open request(s) of the removed ${serviceType}:${serviceId} version`,
      { label: 'Versions' }
    );
  }

  if (!keepStatuses) {
    const result = await getRepository(MediaServiceStatus).delete({
      serviceType,
      serviceId,
    });
    if (result.affected) {
      logger.info(
        `Removed ${result.affected} recorded status(es) of ${serviceType}:${serviceId}`,
        { label: 'Versions' }
      );
    }
  }
}
