import { SummaryChecks } from '@app/components/VersionsPanel/VersionFileDetails';
import defineMessages from '@app/utils/defineMessages';
import type { EpisodeVersion } from '@server/lib/mediaVersions';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.TvDetails.Season.EpisodeVersions', {
  standard: 'Standard',
});

/**
 * VSeerr: the versions that hold an episode, each with what its file
 * contains (resolution, matched custom formats, audio languages).
 */
const EpisodeVersions = ({ versions }: { versions?: EpisodeVersion[] }) => {
  const intl = useIntl();
  if (!versions?.length) {
    return null;
  }
  return (
    <div className="space-y-1" data-testid="episode-versions">
      {versions.map((version) => (
        <div
          key={`episode-version-${version.key}`}
          className="flex flex-wrap items-center gap-x-2 text-sm"
        >
          <span className="font-semibold text-gray-200">
            {version.label ?? intl.formatMessage(messages.standard)}
          </span>
          <SummaryChecks summary={version.summary} align="start" />
        </div>
      ))}
    </div>
  );
};

export default EpisodeVersions;
