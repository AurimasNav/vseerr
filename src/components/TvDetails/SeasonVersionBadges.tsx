import Badge from '@app/components/Common/Badge';
import StatusBadgeMini from '@app/components/Common/StatusBadgeMini';
import Tooltip from '@app/components/Common/Tooltip';
import { getStatusLabel } from '@app/components/StatusBadge';
import ServiceStatusBadges from '@app/components/StatusBadge/ServiceStatusBadges';
import defineMessages from '@app/utils/defineMessages';
import {
  episodeRanges,
  isMixedSeason,
  seasonHolders,
} from '@app/utils/seasonVersions';
import { getServiceStatusItems } from '@app/utils/serviceRequestStatus';
import { MediaStatus } from '@server/constants/media';
import type Media from '@server/entity/Media';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type { VersionDetails } from '@server/lib/mediaVersions';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.TvDetails.SeasonVersionBadges', {
  mixed: 'Mixed: {status}',
  mixedshort: 'Mixed',
  standard: 'Standard',
  holderepisodes:
    '{version}: {count, plural, one {episode} other {episodes}} {episodes}',
});

interface SeasonVersionBadgesProps {
  seasonNumber: number;
  /** Episodes in the season (from TMDB). */
  episodeCount: number;
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
  episodeCount,
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
    held >= episodeCount
      ? MediaStatus.AVAILABLE
      : MediaStatus.PARTIALLY_AVAILABLE;
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
        />
        {mixed && (
          <Tooltip content={mixedDetails}>
            <span data-testid="season-mixed-badge">
              <Badge badgeType="success">
                {intl.formatMessage(messages.mixed, {
                  status: getStatusLabel(intl, mixedStatus),
                })}
              </Badge>
            </span>
          </Tooltip>
        )}
      </div>
      <div className="flex items-center space-x-1 md:hidden">
        {items.map(({ server, status }) => (
          <StatusBadgeMini
            key={`season-version-mini-${server.id}`}
            status={status}
            label={server.buttonLabel ?? server.name}
          />
        ))}
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
