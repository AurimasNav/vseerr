import defineMessages from '@app/utils/defineMessages';
import type { DefiningMatch } from '@server/lib/versionCoverage';
import { useIntl } from 'react-intl';
import Select from 'react-select';

const messages = defineMessages('components.Settings.DefiningFormatsEditor', {
  definingFormats: 'Defining Formats',
  definingFormatsHelp:
    "Custom formats that make a file count as this version. When another version's file has them, this version shows as available through it and only request managers can request it.",
  select: 'Select custom formats',
  testFirst: 'Test connection to load custom formats',
  noOptions: 'No custom formats',
  matchAll: 'A file needs all of them',
  matchAny: 'A file needs any one of them',
  noVersionName: 'Set a version name to use defining formats.',
  standardHint:
    'Also used when this is the standard server: another version can then cover the standard version.',
  suggestion: "Suggested from the default profile's minimum score: {formats}",
  useSuggestion: 'Use',
});

interface OptionType {
  value: string;
  label: string;
}

interface DefiningFormatsEditorProps {
  value: string[];
  match: DefiningMatch;
  onChange: (value: string[]) => void;
  onMatchChange: (match: DefiningMatch) => void;
  /** Custom format names of the instance, from the connection test. */
  customFormats?: string[];
  /** Suggested from the default profile, from the connection test. */
  suggestion?: { formats: string[]; match: DefiningMatch };
  isValidated: boolean;
  hasVersionName: boolean;
  is4k: boolean;
}

/** VSeerr: edits a server's defining formats (Settings → Services). */
const DefiningFormatsEditor = ({
  value,
  match,
  onChange,
  onMatchChange,
  customFormats = [],
  suggestion,
  isValidated,
  hasVersionName,
  is4k,
}: DefiningFormatsEditorProps) => {
  const intl = useIntl();
  if (is4k) {
    return null;
  }
  const suggested =
    suggestion &&
    suggestion.formats.length > 0 &&
    (suggestion.formats.join('\n') !== value.join('\n') ||
      (suggestion.formats.length > 1 && suggestion.match !== match))
      ? suggestion
      : undefined;
  const options = [...new Set([...customFormats, ...value])].map((name) => ({
    value: name,
    label: name,
  }));

  return (
    <div className="form-row">
      <label htmlFor="definingFormats" className="text-label">
        {intl.formatMessage(messages.definingFormats)}
        <span className="label-tip">
          {intl.formatMessage(messages.definingFormatsHelp)}
        </span>
        {!hasVersionName && (
          <span className="label-tip">
            {intl.formatMessage(messages.standardHint)}
          </span>
        )}
      </label>
      <div className="form-input-area">
        <Select<OptionType, true>
          inputId="definingFormats"
          options={options}
          isMulti
          isDisabled={!isValidated && value.length === 0}
          placeholder={intl.formatMessage(
            isValidated ? messages.select : messages.testFirst
          )}
          className="react-select-container"
          classNamePrefix="react-select"
          value={value.map((name) => ({ value: name, label: name }))}
          onChange={(selected) =>
            onChange(selected.map((option) => option.value))
          }
          noOptionsMessage={() => intl.formatMessage(messages.noOptions)}
        />
        {suggested && (
          <div className="mt-2 flex items-center gap-2 text-sm text-gray-400">
            <span>
              {intl.formatMessage(messages.suggestion, {
                formats: suggested.formats.join(
                  suggested.match === 'any' ? ' / ' : ' + '
                ),
              })}
            </span>
            <button
              type="button"
              className="text-indigo-400 underline hover:text-indigo-300"
              onClick={() => {
                onChange(suggested.formats);
                onMatchChange(suggested.match);
              }}
            >
              {intl.formatMessage(messages.useSuggestion)}
            </button>
          </div>
        )}
        {value.length > 1 && (
          <div className="mt-2 flex flex-col gap-1 text-sm text-gray-300">
            {(['all', 'any'] as const).map((mode) => (
              <label key={mode} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="definingMatch"
                  className="h-4 w-4 border-gray-500 bg-gray-800 text-indigo-600 focus:ring-indigo-500"
                  checked={match === mode}
                  onChange={() => onMatchChange(mode)}
                />
                {intl.formatMessage(
                  mode === 'all' ? messages.matchAll : messages.matchAny
                )}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DefiningFormatsEditor;
