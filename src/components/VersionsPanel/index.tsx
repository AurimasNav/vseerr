import CachedImage from '@app/components/Common/CachedImage';
import { getStatusLabel } from '@app/components/StatusBadge';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { getLabelledServices } from '@app/utils/serviceRequestStatus';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type Media from '@server/entity/Media';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import Link from 'next/link';
import { FormattedRelativeTime, useIntl } from 'react-intl';

const messages = defineMessages('components.VersionsPanel', {
  versions: 'Versions',
  notrequested: 'Not requested',
  requestedby: 'Requested by {user}',
  requestedbymany:
    'Requested by {user} and {count, plural, one {# other} other {# others}}',
});

const ACTIVE_REQUEST_STATUSES = [
  MediaRequestStatus.PENDING,
  MediaRequestStatus.APPROVED,
  MediaRequestStatus.COMPLETED,
];

interface VersionsPanelProps {
  media?: Media;
  services?: ServiceCommonServer[];
  isAnime?: boolean;
}

/**
 * Lists every version of a title on its details page: whether it is
 * requested or available, and who requested it.
 */
const VersionsPanel = ({ media, services, isAnime }: VersionsPanelProps) => {
  const intl = useIntl();
  const { user } = useUser();

  const versions = getLabelledServices(services).filter(
    (service) => !service.animeOnly || isAnime
  );

  if (versions.length === 0) {
    return null;
  }

  const rows = versions.map((version) => {
    const serviceStatus = media?.serviceStatuses?.find(
      (status) => status.serviceId === version.id
    );
    const requests = (media?.requests ?? [])
      .filter(
        (request) =>
          request.isServiceRequest &&
          request.serverId === version.id &&
          ACTIVE_REQUEST_STATUSES.includes(request.status)
      )
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

    let status = serviceStatus?.status ?? MediaStatus.UNKNOWN;
    if (
      (status === MediaStatus.UNKNOWN || status === MediaStatus.DELETED) &&
      requests.length > 0
    ) {
      status = requests.some((r) => r.status === MediaRequestStatus.PENDING)
        ? MediaStatus.PENDING
        : MediaStatus.PROCESSING;
    }

    return { version, status, requests };
  });

  return (
    <div className="media-facts mb-6" data-testid="versions-panel">
      <div className="media-fact">
        <span>{intl.formatMessage(messages.versions)}</span>
      </div>
      {rows.map(({ version, status, requests }) => {
        const firstRequest = requests[0];
        const isRequested =
          status !== MediaStatus.UNKNOWN && status !== MediaStatus.DELETED;

        return (
          <div
            key={`version-${version.id}`}
            className="media-fact flex-col items-stretch"
          >
            <div className="flex justify-between">
              <span>{version.buttonLabel}</span>
              <span className="media-fact-value">
                {isRequested
                  ? getStatusLabel(intl, status)
                  : intl.formatMessage(messages.notrequested)}
              </span>
            </div>
            {firstRequest?.requestedBy && (
              <div className="mt-1 flex items-center justify-end text-xs font-normal text-gray-400">
                {intl.formatMessage(
                  requests.length > 1
                    ? messages.requestedbymany
                    : messages.requestedby,
                  {
                    count: requests.length - 1,
                    user: (
                      <Link
                        href={
                          firstRequest.requestedBy.id === user?.id
                            ? '/profile'
                            : `/users/${firstRequest.requestedBy.id}`
                        }
                        className="mx-1 inline-flex items-center font-semibold text-gray-300 hover:text-white hover:underline"
                      >
                        <span className="avatar-sm mr-1">
                          <CachedImage
                            type="avatar"
                            src={firstRequest.requestedBy.avatar}
                            alt=""
                            className="avatar-sm object-cover"
                            width={16}
                            height={16}
                          />
                        </span>
                        {firstRequest.requestedBy.displayName}
                      </Link>
                    ),
                  }
                )}
                <span className="ml-1">
                  <FormattedRelativeTime
                    value={Math.floor(
                      (new Date(firstRequest.createdAt).getTime() -
                        Date.now()) /
                        1000
                    )}
                    updateIntervalInSeconds={60}
                    numeric="auto"
                  />
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default VersionsPanel;
