import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type Media from '@server/entity/Media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type MediaServiceStatus from '@server/entity/MediaServiceStatus';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type { DownloadingItem } from '@server/lib/downloadtracker';

export const getLabelledServices = <T extends { buttonLabel?: string | null }>(
  services?: T[]
): T[] => (services ?? []).filter((service) => !!service.buttonLabel?.trim());

export interface ServiceStatusItem {
  server: ServiceCommonServer;
  status: MediaStatus;
  downloadItem: DownloadingItem[];
}

export const getServiceStatusItems = ({
  services,
  serviceStatuses,
  requests,
  seasonNumber,
}: {
  services?: ServiceCommonServer[];
  serviceStatuses?: MediaServiceStatus[];
  requests?: NonFunctionProperties<MediaRequest>[];
  seasonNumber?: number;
}): ServiceStatusItem[] => {
  const labelledServices = getLabelledServices(services);

  const items = (serviceStatuses ?? [])
    .map((ss): ServiceStatusItem | null => {
      const server = labelledServices.find((s) => s.id === ss.serviceId);
      if (!server) return null;
      const status =
        seasonNumber !== undefined
          ? ss.seasonStatuses?.[seasonNumber]
          : ss.status;
      if (
        status === undefined ||
        status === MediaStatus.UNKNOWN ||
        status === MediaStatus.DELETED
      ) {
        return null;
      }
      const downloadItem =
        seasonNumber === undefined ? (ss.downloadStatus ?? []) : [];
      return { server, status, downloadItem };
    })
    .filter((x): x is ServiceStatusItem => x !== null);

  if (seasonNumber === undefined) {
    for (const request of requests ?? []) {
      if (
        !request.isServiceRequest ||
        request.status !== MediaRequestStatus.PENDING ||
        items.some(({ server }) => server.id === request.serverId)
      ) {
        continue;
      }
      const server = labelledServices.find((s) => s.id === request.serverId);
      if (server) {
        items.push({ server, status: MediaStatus.PENDING, downloadItem: [] });
      }
    }
  } else {
    // A season the scan hasn't seen in the version yet: show the version's
    // open request for it.
    for (const request of requests ?? []) {
      const status =
        request.status === MediaRequestStatus.PENDING
          ? MediaStatus.PENDING
          : request.status === MediaRequestStatus.APPROVED
            ? MediaStatus.PROCESSING
            : undefined;
      if (
        !request.isServiceRequest ||
        request.is4k ||
        status === undefined ||
        !(request.seasons ?? []).some(
          (season) => season.seasonNumber === seasonNumber
        ) ||
        items.some(({ server }) => server.id === request.serverId)
      ) {
        continue;
      }
      const server = labelledServices.find((s) => s.id === request.serverId);
      if (server) {
        items.push({ server, status, downloadItem: [] });
      }
    }
  }

  return items;
};

export const getStandardServiceId = (
  services: ServiceCommonServer[] | undefined,
  media: Pick<Media, 'serviceId' | 'serviceId4k'> | undefined,
  is4k: boolean
): number | undefined =>
  (is4k ? media?.serviceId4k : media?.serviceId) ??
  services?.find((s) => s.isDefault && s.is4k === is4k)?.id;

export const isCoveredByServiceStatus = (
  items: ServiceStatusItem[],
  serviceId: number | undefined
): boolean =>
  serviceId !== undefined &&
  items.some(({ server }) => server.id === serviceId);

export const getServiceSlotStatus = (
  request?: NonFunctionProperties<MediaRequest>
): { status?: MediaStatus; downloadItem?: DownloadingItem[] } => {
  if (!request?.isServiceRequest) {
    return {};
  }

  const serviceStatus = request.media.serviceStatuses?.find(
    (ss) => ss.serviceId === request.serverId
  );

  const status =
    serviceStatus && serviceStatus.status !== MediaStatus.UNKNOWN
      ? serviceStatus.status
      : request.status === MediaRequestStatus.COMPLETED
        ? MediaStatus.AVAILABLE
        : request.status === MediaRequestStatus.APPROVED
          ? MediaStatus.PROCESSING
          : MediaStatus.PENDING;

  return { status, downloadItem: serviceStatus?.downloadStatus ?? [] };
};

// VSeerr: a title can be requested in several versions. Standard is the
// version without a server id: its requests are Seerr's own and its status
// is Seerr's, which also counts the media server. Every other version is a
// Radarr/Sonarr server with a version name, and its status comes from that
// server's row. These helpers give every version the same code path.

/** Whether a request belongs to a version (`serverId`) or to Standard. */
export const isSlotRequest = (
  request: {
    isServiceRequest?: boolean;
    serverId?: number | null;
    is4k: boolean;
  },
  serverId: number | null | undefined,
  is4k = false
): boolean =>
  serverId != null
    ? !!request.isServiceRequest && request.serverId === serverId
    : !request.isServiceRequest && request.is4k === is4k;

type SlotMedia = Pick<Media, 'serviceStatuses' | 'requests'> &
  Partial<Pick<Media, 'status' | 'status4k' | 'seasons'>>;

/** A title's status in a version (`serverId`) or in Standard. */
export const getSlotStatus = (
  media: SlotMedia | undefined,
  serverId: number | null | undefined,
  is4k = false
): MediaStatus | undefined =>
  serverId != null
    ? getMediaServiceStatus(media, serverId).status
    : media?.[is4k ? 'status4k' : 'status'];

/** A season's status in a version (`serverId`) or in Standard. */
export const getSlotSeasonStatus = (
  media: SlotMedia | undefined,
  serverId: number | null | undefined,
  seasonNumber: number,
  is4k = false
): MediaStatus | undefined =>
  serverId != null
    ? media?.serviceStatuses?.find(
        (serviceStatus) => serviceStatus.serviceId === serverId
      )?.seasonStatuses?.[seasonNumber]
    : media?.seasons?.find((season) => season.seasonNumber === seasonNumber)?.[
        is4k ? 'status4k' : 'status'
      ];

export const getMediaServiceStatus = (
  media: Pick<Media, 'serviceStatuses' | 'requests'> | undefined,
  serviceId: number
): { status: MediaStatus; downloadItem: DownloadingItem[] } => {
  const serviceStatus = media?.serviceStatuses?.find(
    (ss) => ss.serviceId === serviceId
  );

  if (
    serviceStatus &&
    serviceStatus.status !== MediaStatus.UNKNOWN &&
    serviceStatus.status !== MediaStatus.DELETED
  ) {
    return {
      status: serviceStatus.status,
      downloadItem: serviceStatus.downloadStatus ?? [],
    };
  }

  const request = media?.requests?.find(
    (r) =>
      r.isServiceRequest &&
      r.serverId === serviceId &&
      (r.status === MediaRequestStatus.PENDING ||
        r.status === MediaRequestStatus.APPROVED)
  );

  return {
    status: !request
      ? MediaStatus.UNKNOWN
      : request.status === MediaRequestStatus.PENDING
        ? MediaStatus.PENDING
        : MediaStatus.PROCESSING,
    downloadItem: [],
  };
};
