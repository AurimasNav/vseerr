import CachedImage from '@app/components/Common/CachedImage';
import { getStatusLabel } from '@app/components/StatusBadge';
import VersionFileDetails from '@app/components/VersionsPanel/VersionFileDetails';
import { useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { isSlotRequest } from '@app/utils/serviceRequestStatus';
import { versionSlots } from '@app/utils/versionChoices';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type Media from '@server/entity/Media';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type { MediaVersionsResponse } from '@server/lib/mediaVersions';
import Link from 'next/link';
import { FormattedRelativeTime, useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.VersionsPanel', {
  versions: 'Versions',
  standard: 'Standard',
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
  mediaType?: 'movie' | 'tv';
}

/**
 * Lists every version of a title on its details page: whether it is
 * requested or available, and who requested it.
 */
const VersionsPanel = ({
  media,
  services,
  isAnime,
  mediaType = 'movie',
}: VersionsPanelProps) => {
  const intl = useIntl();
  const { user } = useUser();

  const slots = versionSlots(mediaType, services, isAnime);
  const hasVersions = slots.some((slot) => slot.serverId !== undefined);
  // File details and coverage, read from Radarr/Sonarr by the server.
  const { data: fileDetails } = useSWR<MediaVersionsResponse>(
    hasVersions && media?.id ? `/api/v1/media/${media.id}/versions` : null
  );

  if (!hasVersions) {
    return null;
  }

  const requestedByLine = (requests: Media['requests']) => {
    const firstRequest = requests[0];
    if (!firstRequest?.requestedBy) {
      return null;
    }
    return (
      <div className="mt-1 flex items-center justify-end text-xs font-normal text-gray-400">
        {intl.formatMessage(
          requests.length > 1 ? messages.requestedbymany : messages.requestedby,
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
              (new Date(firstRequest.createdAt).getTime() - Date.now()) / 1000
            )}
            updateIntervalInSeconds={60}
            numeric="auto"
          />
        </span>
      </div>
    );
  };

  const rows = slots.map((slot) => {
    const details = fileDetails?.versions.find((v) => v.key === slot.key);
    const requests = (media?.requests ?? [])
      .filter(
        (request) =>
          isSlotRequest(request, slot.serverId) &&
          ACTIVE_REQUEST_STATUSES.includes(request.status)
      )
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

    // Standard's status is Seerr's own badge at the top of the page, so
    // its row only lists files and requesters, and only when it has some.
    if (slot.serverId === undefined) {
      const hasContent =
        !!details?.summary ||
        !!details?.coverage.coveredBy ||
        !!details?.coverage.requestedVia ||
        !!details?.coverage.seasons ||
        requests.length > 0;
      return { slot, details, requests, hasContent, status: undefined };
    }

    let status =
      media?.serviceStatuses?.find((s) => s.serviceId === slot.serverId)
        ?.status ?? MediaStatus.UNKNOWN;
    if (
      (status === MediaStatus.UNKNOWN || status === MediaStatus.DELETED) &&
      requests.length > 0
    ) {
      status = requests.some((r) => r.status === MediaRequestStatus.PENDING)
        ? MediaStatus.PENDING
        : MediaStatus.PROCESSING;
    }

    return { slot, details, requests, hasContent: true, status };
  });

  return (
    <div className="media-facts mb-6" data-testid="versions-panel">
      <div className="media-fact">
        <span>{intl.formatMessage(messages.versions)}</span>
      </div>
      {rows
        .filter(({ hasContent }) => hasContent)
        .map(({ slot, details, requests, status }) => (
          <div
            key={`version-${slot.key}`}
            className="media-fact flex-col items-stretch"
          >
            <div className="flex justify-between">
              <span>{slot.label ?? intl.formatMessage(messages.standard)}</span>
              {status !== undefined && (
                <span className="media-fact-value">
                  {status !== MediaStatus.UNKNOWN &&
                  status !== MediaStatus.DELETED
                    ? getStatusLabel(intl, status)
                    : intl.formatMessage(messages.notrequested)}
                </span>
              )}
            </div>
            <VersionFileDetails details={details} />
            {requestedByLine(requests)}
          </div>
        ))}
    </div>
  );
};

export default VersionsPanel;
