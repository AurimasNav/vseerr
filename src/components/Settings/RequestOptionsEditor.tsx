import Button from '@app/components/Common/Button';
import defineMessages from '@app/utils/defineMessages';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/solid';
import type { RequestOption } from '@server/lib/settings';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Settings.RequestOptionsEditor', {
  requestOptions: 'Request Options',
  requestOptionsHelp:
    'Extra checkboxes shown under this version when requesting. A ticked option requests with its quality profile. On the default server without a version name they show under Standard.',
  label: 'Label',
  labelPlaceholder: 'English is OK until a dub appears',
  profile: 'Quality Profile',
  selectProfile: 'Select a profile',
  onlyIfNoOtherVersion: 'Only if no other version has the title',
  onlyIfNoOtherVersionHelp:
    'Otherwise the default profile is used, e.g. to avoid a second English copy.',
  addOption: 'Add Option',
  removeOption: 'Remove',
  noVersionName: 'Request options need a version name on 4K servers.',
  animeOnly: 'Anime only',
  animeOnlyHelp: 'Offered only for titles TMDB tags as anime.',
});

interface RequestOptionsEditorProps {
  value: RequestOption[];
  onChange: (value: RequestOption[]) => void;
  profiles: { id: number; name: string }[];
  /** Versions and non-4K servers without a version name can have options. */
  hasVersionName: boolean;
}

/** VSeerr: edits a version's request options (Settings → Services). */
const RequestOptionsEditor = ({
  value,
  onChange,
  profiles,
  hasVersionName,
}: RequestOptionsEditorProps) => {
  const intl = useIntl();
  const update = (index: number, change: Partial<RequestOption>) =>
    onChange(value.map((o, i) => (i === index ? { ...o, ...change } : o)));

  return (
    <div className="form-row">
      <span className="group-label sm:mt-2">
        {intl.formatMessage(messages.requestOptions)}
        <span className="label-tip">
          {intl.formatMessage(
            hasVersionName
              ? messages.requestOptionsHelp
              : messages.noVersionName
          )}
        </span>
      </span>
      <div className="form-input-area space-y-3" data-testid="request-options">
        {value.map((option, index) => (
          <div
            key={option.id || index}
            className="space-y-2 rounded-md border border-gray-700 p-3"
          >
            <input
              type="text"
              aria-label={intl.formatMessage(messages.label)}
              placeholder={intl.formatMessage(messages.labelPlaceholder)}
              value={option.label}
              disabled={!hasVersionName}
              onChange={(e) => update(index, { label: e.target.value })}
            />
            <select
              aria-label={intl.formatMessage(messages.profile)}
              value={option.profileId || ''}
              disabled={!hasVersionName}
              onChange={(e) => {
                const profile = profiles.find(
                  (p) => p.id === Number(e.target.value)
                );
                update(index, {
                  profileId: Number(e.target.value),
                  profileName: profile?.name,
                });
              }}
            >
              <option value="">
                {intl.formatMessage(messages.selectProfile)}
              </option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
              {option.profileId > 0 &&
                !profiles.some((p) => p.id === option.profileId) && (
                  <option value={option.profileId}>
                    {option.profileName ?? option.profileId}
                  </option>
                )}
            </select>
            <div className="flex items-center gap-3">
              <label className="flex items-start gap-2 text-sm text-gray-100">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!!option.animeOnly}
                  disabled={!hasVersionName}
                  onChange={(e) =>
                    update(index, { animeOnly: e.target.checked || undefined })
                  }
                />
                <span className="flex flex-col">
                  {intl.formatMessage(messages.animeOnly)}
                  <span className="text-xs text-gray-400">
                    {intl.formatMessage(messages.animeOnlyHelp)}
                  </span>
                </span>
              </label>
            </div>
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-start gap-2 text-sm text-gray-100">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={option.onlyIfNoOtherVersion}
                  disabled={!hasVersionName}
                  onChange={(e) =>
                    update(index, { onlyIfNoOtherVersion: e.target.checked })
                  }
                />
                <span className="flex flex-col">
                  {intl.formatMessage(messages.onlyIfNoOtherVersion)}
                  <span className="text-xs text-gray-400">
                    {intl.formatMessage(messages.onlyIfNoOtherVersionHelp)}
                  </span>
                </span>
              </label>
              <Button
                buttonType="danger"
                buttonSize="sm"
                type="button"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <TrashIcon />
                <span>{intl.formatMessage(messages.removeOption)}</span>
              </Button>
            </div>
          </div>
        ))}
        <Button
          buttonSize="sm"
          type="button"
          disabled={!hasVersionName}
          onClick={() =>
            onChange([
              ...value,
              {
                id: '',
                label: '',
                profileId: 0,
                onlyIfNoOtherVersion: true,
              },
            ])
          }
        >
          <PlusIcon />
          <span>{intl.formatMessage(messages.addOption)}</span>
        </Button>
      </div>
    </div>
  );
};

export default RequestOptionsEditor;
