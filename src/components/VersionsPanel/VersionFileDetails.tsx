import Tooltip from '@app/components/Common/Tooltip';
import defineMessages from '@app/utils/defineMessages';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
import type { VersionDetails } from '@server/lib/mediaVersions';
import type { VersionFileSummary } from '@server/lib/versionCoverage';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.VersionsPanel.VersionFileDetails', {
  original: 'original',
  ofFiles: '{count} of {total} episode files',
  coveredby: 'Available through {version}',
  requestedvia: 'Requested in {version}, may cover this',
  standard: 'Standard',
  seasonscovered:
    '{count, plural, one {Season {seasons} is} other {Seasons {seasons} are}} available through another version',
});

const Check = ({
  label,
  files,
  total,
  muted = false,
}: {
  label: string;
  files: number;
  total: number;
  muted?: boolean;
}) => {
  const intl = useIntl();
  const partial = total > 1 && files < total;
  const content = (
    <span
      className={`inline-flex items-center gap-1 ${
        muted ? 'text-gray-400' : 'text-gray-200'
      }`}
    >
      <CheckCircleIcon
        className={`h-3.5 w-3.5 flex-shrink-0 ${
          partial ? 'text-yellow-500' : 'text-green-500'
        }`}
      />
      {label}
      {partial && (
        <span className="text-gray-500">
          {files}/{total}
        </span>
      )}
    </span>
  );
  return partial ? (
    <Tooltip
      content={intl.formatMessage(messages.ofFiles, { count: files, total })}
    >
      {content}
    </Tooltip>
  ) : (
    content
  );
};

const SummaryChecks = ({ summary }: { summary: VersionFileSummary }) => {
  const intl = useIntl();
  return (
    <div
      className="mt-1 flex flex-wrap justify-end gap-x-2 gap-y-0.5 text-xs font-normal"
      data-testid="version-file-checks"
    >
      {summary.resolutions.map((resolution) => (
        <Check
          key={`res-${resolution}`}
          label={resolution}
          files={summary.files}
          total={summary.files}
        />
      ))}
      {summary.formats.map((format) => (
        <Check
          key={`cf-${format.name}`}
          label={format.name}
          files={format.files}
          total={summary.files}
        />
      ))}
      {summary.languages.map((language) => (
        <Check
          key={`lang-${language.name}`}
          label={
            language.original
              ? `${language.name} (${intl.formatMessage(messages.original)})`
              : language.name
          }
          files={language.files}
          total={summary.files}
          muted
        />
      ))}
    </div>
  );
};

/**
 * VSeerr: what a version's files contain (resolution, matched custom
 * formats, audio languages), and whether another version covers it.
 */
const VersionFileDetails = ({ details }: { details?: VersionDetails }) => {
  const intl = useIntl();
  if (!details) {
    return null;
  }
  const { coverage, summary } = details;
  const name = (ref?: { label?: string }) =>
    ref?.label ?? intl.formatMessage(messages.standard);
  const coveredSeasons = Object.entries(coverage.seasons ?? {})
    .filter(([, state]) => state.coveredBy)
    .map(([season]) => season);

  return (
    <>
      {summary && <SummaryChecks summary={summary} />}
      {coverage.coveredBy && (
        <div className="mt-1 text-right text-xs font-normal text-green-400">
          {intl.formatMessage(messages.coveredby, {
            version: name(coverage.coveredBy),
          })}
        </div>
      )}
      {!coverage.coveredBy && coverage.requestedVia && (
        <div className="mt-1 text-right text-xs font-normal text-gray-400">
          {intl.formatMessage(messages.requestedvia, {
            version: name(coverage.requestedVia),
          })}
        </div>
      )}
      {coveredSeasons.length > 0 && (
        <div className="mt-1 text-right text-xs font-normal text-green-400">
          {intl.formatMessage(messages.seasonscovered, {
            count: coveredSeasons.length,
            seasons: coveredSeasons.join(', '),
          })}
        </div>
      )}
    </>
  );
};

export default VersionFileDetails;
