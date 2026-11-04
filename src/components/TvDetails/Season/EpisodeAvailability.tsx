import StatusBadgeMini from '@app/components/Common/StatusBadgeMini';
import defineMessages from '@app/utils/defineMessages';
import type { EpisodeMark } from '@app/utils/seasonVersions';
import { XMarkIcon } from '@heroicons/react/24/solid';
import { MediaStatus } from '@server/constants/media';
import { useIntl } from 'react-intl';

const messages = defineMessages(
  'components.TvDetails.Season.EpisodeAvailability',
  {
    standard: 'Standard',
    missing: 'Missing',
    missingin: '{version}: missing',
  }
);

interface EpisodeAvailabilityProps {
  marks: EpisodeMark[];
  /** Name the versions: the season has files in more than one. */
  labelled: boolean;
}

/**
 * VSeerr: an episode's marks in an expanded season. A checkmark for each
 * version that has the episode, "Missing" for each that does not.
 */
const EpisodeAvailability = ({ marks, labelled }: EpisodeAvailabilityProps) => {
  const intl = useIntl();
  if (!marks.length) {
    return null;
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
          <div
            key={`episode-mark-${mark.key}`}
            className="relative inline-flex whitespace-nowrap rounded-full bg-gray-800/80 text-xs font-semibold leading-5 shadow-md ring-1 ring-gray-700"
          >
            <div className="w-5 rounded-full bg-gray-600/80 p-0.5 text-gray-200 shadow-md ring-1 ring-gray-500">
              <XMarkIcon />
            </div>
            <span className="pl-1 pr-2 text-gray-300">
              {labelled
                ? intl.formatMessage(messages.missingin, { version })
                : intl.formatMessage(messages.missing)}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default EpisodeAvailability;
