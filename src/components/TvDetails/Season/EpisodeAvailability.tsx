import StatusBadgeMini from '@app/components/Common/StatusBadgeMini';
import defineMessages from '@app/utils/defineMessages';
import type { EpisodeMark } from '@app/utils/seasonVersions';
import { ClockIcon, XMarkIcon } from '@heroicons/react/24/solid';
import { MediaStatus } from '@server/constants/media';
import type React from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages(
  'components.TvDetails.Season.EpisodeAvailability',
  {
    standard: 'Standard',
    missing: 'Missing',
    missingin: '{version}: missing',
    upcoming: 'Upcoming',
  }
);

interface EpisodeAvailabilityProps {
  marks: EpisodeMark[];
  /** Name the versions: the season has files in more than one. */
  labelled: boolean;
  /** The episode has not aired yet (and no version has it). */
  upcoming?: boolean;
}

const GreyMark = ({ icon, text }: { icon: React.ReactNode; text: string }) => (
  <div className="relative inline-flex whitespace-nowrap rounded-full bg-gray-800/80 text-xs font-semibold leading-5 shadow-md ring-1 ring-gray-700">
    <div className="w-5 rounded-full bg-gray-600/80 p-0.5 text-gray-200 shadow-md ring-1 ring-gray-500">
      {icon}
    </div>
    <span className="pl-1 pr-2 text-gray-300">{text}</span>
  </div>
);

/**
 * VSeerr: an episode's marks in an expanded season. A checkmark for each
 * version that has the episode, "Missing" for each that does not, and
 * "Upcoming" for an episode that has not aired yet.
 */
const EpisodeAvailability = ({
  marks,
  labelled,
  upcoming = false,
}: EpisodeAvailabilityProps) => {
  const intl = useIntl();
  if (!marks.length) {
    return upcoming ? (
      <div data-testid="episode-availability">
        <GreyMark
          icon={<ClockIcon />}
          text={intl.formatMessage(messages.upcoming)}
        />
      </div>
    ) : null;
  }
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      data-testid="episode-availability"
    >
      {marks.map((mark) => {
        const version = mark.label ?? intl.formatMessage(messages.standard);
        if (mark.held) {
          return (
            <StatusBadgeMini
              key={`episode-mark-${mark.key}`}
              status={MediaStatus.AVAILABLE}
              label={labelled ? version : undefined}
            />
          );
        }
        return (
          <GreyMark
            key={`episode-mark-${mark.key}`}
            icon={<XMarkIcon />}
            text={
              labelled
                ? intl.formatMessage(messages.missingin, { version })
                : intl.formatMessage(messages.missing)
            }
          />
        );
      })}
    </div>
  );
};

export default EpisodeAvailability;
