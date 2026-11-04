import Badge from '@app/components/Common/Badge';
import StatusBadgeMini from '@app/components/Common/StatusBadgeMini';
import Tooltip from '@app/components/Common/Tooltip';
import { getStatusLabel } from '@app/components/StatusBadge';
import ServiceStatusBadges from '@app/components/StatusBadge/ServiceStatusBadges';
import defineMessages from '@app/utils/defineMessages';
import type { SeasonProgress } from '@app/utils/seasonVersions';
import {
  episodeRanges,
  isMixedSeason,
  seasonHolders,
  seasonProgress,
} from '@app/utils/seasonVersions';
import { getServiceStatusItems } from '@app/utils/serviceRequestStatus';
import { MediaStatus } from '@server/constants/media';
import type Media from '@server/entity/Media';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type { VersionDetails } from '@server/lib/mediaVersions';
import type { IntlShape } from 'react-intl';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.TvDetails.SeasonVersionBadges', {
  mixed: 'Mixed: {status}',
  mixedshort: 'Mixed',
  standard: 'Standard',
  holderepisodes:
    '{version}: {count, plural, one {episode} other {episodes}} {episodes}',
  episodesof: '{held} of {total}',
  labelepisodesof: '{label}: {held} of {total}',
});

/** "3 of 5": a season's aired episodes that a version holds. */
export const episodeProgressLabel = (
  intl: IntlShape,
  progress: { held: number; aired: number }
): string =>
  intl.formatMessage(messages.episodesof, {
    held: progress.held,
    total: progress.aired,
  });

/**
 * What a partly available season row shows for a version: "3 of 5" while
 * aired episodes are missing, Available once only unaired ones are left.
 * Without file data it stays Partially Available.
 */
export const seasonDisplay = (
  intl: IntlShape,
  status: MediaStatus,
  progress?: SeasonProgress
): { status: MediaStatus; text?: string; counted: boolean } => {
  if (status !== MediaStatus.PARTIALLY_AVAILABLE || !progress) {
    return { status, counted: false };
  }
  if (progress.missing.length === 0) {
    return {
      status: MediaStatus.AVAILABLE,
      text: getStatusLabel(intl, MediaStatus.AVAILABLE),
      counted: false,
    };
  }
  return {
    status,
    text: episodeProgressLabel(intl, progress),
    counted: true,
  };
};

interface SeasonVersionBadgesProps {
  seasonNumber: number;
  /** Episodes of the season aired so far. */
  aired: number;
  media?: Media;
  services?: ServiceCommonServer[];
  versions?: VersionDetails[];
}

/**
 * VSeerr: a season row's version badges. Each version that holds or has
 * requested the season gets its own badge, whether or not the standard
 * version has it. A season whose episodes are split across versions also
 * gets a "Mixed" badge listing which version holds which episodes.
 */
const SeasonVersionBadges = ({
  seasonNumber,
  aired,
  media,
  services,
  versions,
}: SeasonVersionBadgesProps) => {
  const intl = useIntl();
  const items = getServiceStatusItems({
    services,
    serviceStatuses: media?.serviceStatuses,
    requests: media?.requests,
    seasonNumber,
  });
  const holders = seasonHolders(versions, seasonNumber);
  const mixed = isMixedSeason(holders);

  if (items.length === 0 && !mixed) {
    return null;
  }

  const held = new Set(holders.flatMap((holder) => holder.episodes)).size;
  const mixedStatus =
    held >= aired ? MediaStatus.AVAILABLE : MediaStatus.PARTIALLY_AVAILABLE;
  // A partly available season counts the version's aired episodes.
  const progress = seasonProgress(holders, aired);
  const displayOf = (serverId: number, status: MediaStatus) =>
    seasonDisplay(intl, status, progress[`sonarr:${serverId}`]);
  const statusTexts: Record<number, string> = {};
  for (const { server, status } of items) {
    const display = displayOf(server.id, status);
    if (display.text) {
      statusTexts[server.id] = display.text;
    }
  }
  const mixedDetails = holders.map((holder) => (
    <div key={`holder-${holder.key}`}>
      {intl.formatMessage(messages.holderepisodes, {
        version: holder.label ?? intl.formatMessage(messages.standard),
        count: holder.episodes.length,
        episodes: episodeRanges(holder.episodes),
      })}
    </div>
  ));

  return (
    <>
      <div
        className="hidden items-center space-x-1 md:flex"
        data-testid="season-version-badges"
      >
        <ServiceStatusBadges
          serviceStatuses={media?.serviceStatuses}
          requests={media?.requests}
          mediaType="tv"
          seasonNumber={seasonNumber}
          statusTexts={statusTexts}
        />
        {mixed && (
          <Tooltip content={mixedDetails}>
            <span data-testid="season-mixed-badge">
              <Badge badgeType="success">
                {intl.formatMessage(messages.mixed, {
                  status:
                    mixedStatus === MediaStatus.PARTIALLY_AVAILABLE
                      ? episodeProgressLabel(intl, { held, aired })
                      : getStatusLabel(intl, mixedStatus),
                })}
              </Badge>
            </span>
          </Tooltip>
        )}
      </div>
      <div className="flex items-center space-x-1 md:hidden">
        {items.map(({ server, status }) => {
          const label = server.buttonLabel ?? server.name;
          const serverProgress = progress[`sonarr:${server.id}`];
          const display = displayOf(server.id, status);
          return (
            <StatusBadgeMini
              key={`season-version-mini-${server.id}`}
              status={display.status}
              label={
                display.counted && serverProgress
                  ? intl.formatMessage(messages.labelepisodesof, {
                      label,
                      held: serverProgress.held,
                      total: serverProgress.aired,
                    })
                  : label
              }
            />
          );
        })}
        {mixed && (
          <StatusBadgeMini
            status={mixedStatus}
            label={intl.formatMessage(messages.mixedshort)}
          />
        )}
      </div>
    </>
  );
};

export default SeasonVersionBadges;
