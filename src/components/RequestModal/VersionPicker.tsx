import Badge from '@app/components/Common/Badge';
import { getStatusLabel } from '@app/components/StatusBadge';
import defineMessages from '@app/utils/defineMessages';
import type { VersionChoice, VersionKey } from '@app/utils/versionChoices';
import { MediaStatus } from '@server/constants/media';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.RequestModal.VersionPicker', {
  version: 'Version',
  chooseversionbutton: 'Choose a Version',
  chooseversion: 'Choose the version to request.',
  standard: 'Standard',
  notrequested: 'Not requested',
  otherversionheld: 'You already requested another version of this title.',
  usebydefault: 'Use this version by default',
  usebydefaultdescription:
    'Preselects it next time on this device. You can still change it.',
});

interface VersionPickerProps {
  choices: VersionChoice[];
  selected: VersionKey | null;
  onSelect: (key: VersionKey) => void;
  useByDefault: boolean;
  onUseByDefaultChange: (value: boolean) => void;
  /** Off where the choice covers several titles (collections). */
  showStatus?: boolean;
}

/** Lets the user pick the version of a title to request. */
const VersionPicker = ({
  choices,
  selected,
  onSelect,
  useByDefault,
  onUseByDefaultChange,
  showStatus = true,
}: VersionPickerProps) => {
  const intl = useIntl();

  return (
    <fieldset className="mt-6" data-testid="version-picker">
      <legend className="text-sm font-medium text-gray-100">
        {intl.formatMessage(messages.version)}
      </legend>
      <p className="mt-1 text-sm text-gray-400">
        {intl.formatMessage(messages.chooseversion)}
      </p>
      <div className="mt-3 space-y-2">
        {choices.map((choice) => {
          const id = `version-choice-${choice.key.replace(':', '-')}`;
          const isSelected = selected === choice.key;
          const label = choice.label ?? intl.formatMessage(messages.standard);
          const statusLabel =
            choice.status === MediaStatus.UNKNOWN ||
            choice.status === MediaStatus.DELETED
              ? intl.formatMessage(messages.notrequested)
              : getStatusLabel(intl, choice.status);

          return (
            <label
              key={choice.key}
              htmlFor={id}
              className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${
                isSelected
                  ? 'border-indigo-500 bg-indigo-500/20'
                  : 'border-gray-700 bg-gray-900/40'
              } ${
                choice.requestable
                  ? 'cursor-pointer hover:border-indigo-400'
                  : 'cursor-not-allowed opacity-60'
              }`}
            >
              <span className="flex items-center gap-3">
                <input
                  id={id}
                  type="radio"
                  name="version-choice"
                  className="h-4 w-4 border-gray-500 bg-gray-800 text-indigo-600 focus:ring-indigo-500"
                  checked={isSelected}
                  disabled={!choice.requestable}
                  onChange={() => onSelect(choice.key)}
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-white">
                    {label}
                  </span>
                  {choice.otherVersionHeld && (
                    <span className="text-xs text-gray-400">
                      {intl.formatMessage(messages.otherversionheld)}
                    </span>
                  )}
                </span>
              </span>
              {showStatus && (
                <Badge
                  badgeType={
                    choice.status === MediaStatus.AVAILABLE ||
                    choice.status === MediaStatus.PARTIALLY_AVAILABLE
                      ? 'success'
                      : choice.status === MediaStatus.PENDING
                        ? 'warning'
                        : 'primary'
                  }
                >
                  {statusLabel}
                </Badge>
              )}
            </label>
          );
        })}
      </div>
      <div
        className={`mt-3 flex items-start gap-3 ${
          selected ? '' : 'opacity-60'
        }`}
      >
        <input
          id="version-choice-default"
          type="checkbox"
          className="mt-0.5 h-4 w-4 cursor-pointer rounded border-gray-500 bg-gray-800 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed"
          checked={useByDefault}
          disabled={!selected}
          aria-describedby="version-choice-default-description"
          onChange={(e) => onUseByDefaultChange(e.target.checked)}
        />
        <div className="flex flex-col">
          <label
            htmlFor="version-choice-default"
            className="cursor-pointer text-sm text-gray-100"
          >
            {intl.formatMessage(messages.usebydefault)}
          </label>
          <span
            id="version-choice-default-description"
            className="text-xs text-gray-400"
          >
            {intl.formatMessage(messages.usebydefaultdescription)}
          </span>
        </div>
      </div>
    </fieldset>
  );
};

export { messages as versionPickerMessages };

export default VersionPicker;
