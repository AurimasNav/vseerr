import Tooltip from '@app/components/Common/Tooltip';
import defineMessages from '@app/utils/defineMessages';
import type {
  SeasonAiring,
  SeasonHolder,
  SeasonProgress,
} from '@app/utils/seasonVersions';
import { episodeRanges } from '@app/utils/seasonVersions';
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline';
import type React from 'react';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.TvDetails.SeasonCountsHelp', {
  explain: 'What do the episode counts mean?',
  standard: 'Standard',
  heldof: '{version}: {held} of {aired} aired episodes',
  allaired: '{version}: all {aired} aired episodes',
  missing: 'Missing: {episodes}',
  upcoming: 'Upcoming: {count}',
  upcomingnext: 'Upcoming: {count} (next E{episode}, {date})',
});

interface SeasonCountsHelpProps {
  holders: SeasonHolder[];
  progress: Record<string, SeasonProgress>;
  airing: SeasonAiring;
}

/**
 * VSeerr: a "?" on a season row that explains its counts: for each version
 * how many aired episodes it has and which are missing, and how many
 * episodes are still to air. Hover on desktop, tap on mobile. Shown only
 * when there is something to explain.
 */
const SeasonCountsHelp = ({
  holders,
  progress,
  airing,
}: SeasonCountsHelpProps) => {
  const intl = useIntl();
  // Opened by hovering with a mouse, or pinned by a click or tap; a click
  // or tap anywhere else closes it. Touch never counts as hovering, so a tap
  // opens it instead of opening and closing it at once.
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const anyMissing = holders.some(
    (holder) => (progress[holder.key]?.missing.length ?? 0) > 0
  );
  if (!holders.length || (!anyMissing && airing.upcoming === 0)) {
    return null;
  }

  // The "?" sits inside the season's toggle button: keep taps and keys on it
  // (and on the tooltip, which React bubbles through) from toggling the season.
  const stop = (event: React.SyntheticEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  const isToggleKey = (event: React.KeyboardEvent) =>
    event.key === 'Enter' || event.key === ' ';
  const stopKeys = (event: React.KeyboardEvent) => {
    if (isToggleKey(event)) {
      stop(event);
    }
  };

  const content = (
    <div
      role="presentation"
      className="-mx-2 -my-1 space-y-1 px-2 py-1"
      onClick={stop}
      onKeyDown={stopKeys}
      data-testid="season-counts-help-content"
    >
      {holders.map((holder) => {
        const holderProgress = progress[holder.key];
        if (!holderProgress) {
          return null;
        }
        const version = holder.label ?? intl.formatMessage(messages.standard);
        return (
          <div key={`season-counts-${holder.key}`}>
            <div>
              {intl.formatMessage(
                holderProgress.missing.length
                  ? messages.heldof
                  : messages.allaired,
                {
                  version,
                  held: holderProgress.held,
                  aired: holderProgress.aired,
                }
              )}
            </div>
            {holderProgress.missing.length > 0 && (
              <div className="pl-3 text-gray-300">
                {intl.formatMessage(messages.missing, {
                  episodes: episodeRanges(holderProgress.missing)
                    .split(', ')
                    .map((range) =>
                      range
                        .split('–')
                        .map((episode) => `E${episode}`)
                        .join('–')
                    )
                    .join(', '),
                })}
              </div>
            )}
          </div>
        );
      })}
      {airing.upcoming > 0 && (
        <div className="text-gray-300">
          {airing.next?.airDate
            ? intl.formatMessage(messages.upcomingnext, {
                count: airing.upcoming,
                episode: airing.next.episodeNumber,
                date: intl.formatDate(airing.next.airDate, {
                  month: 'short',
                  day: 'numeric',
                  timeZone: 'UTC',
                }),
              })
            : intl.formatMessage(messages.upcoming, {
                count: airing.upcoming,
              })}
        </div>
      )}
    </div>
  );

  return (
    <Tooltip
      content={content}
      tooltipConfig={{
        followCursor: false,
        placement: 'top',
        offset: [0, 8],
        trigger: null,
        visible: hovered || pinned,
        onVisibleChange: (visible) => {
          if (!visible) {
            setHovered(false);
            setPinned(false);
          }
        },
      }}
    >
      <span
        role="button"
        tabIndex={0}
        aria-label={intl.formatMessage(messages.explain)}
        aria-expanded={hovered || pinned}
        className="flex h-5 w-5 flex-shrink-0 cursor-help items-center text-gray-400 hover:text-gray-200 focus:text-gray-200 focus:outline-none"
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') {
            setHovered(true);
          }
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') {
            setHovered(false);
          }
        }}
        onClick={(event) => {
          stop(event);
          setPinned((value) => !value);
        }}
        onKeyDown={(event) => {
          stopKeys(event);
          if (isToggleKey(event)) {
            setPinned((value) => !value);
          } else if (event.key === 'Escape') {
            setPinned(false);
          }
        }}
        onKeyUp={stopKeys}
        data-testid="season-counts-help"
      >
        <QuestionMarkCircleIcon />
      </span>
    </Tooltip>
  );
};

export default SeasonCountsHelp;
