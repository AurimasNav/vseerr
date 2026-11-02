import RequestServicesEdit from '@app/components/RequestServicesEdit';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Settings.DefaultVersions', {
  title: 'Default Versions',
  description:
    'Versions new users can request. Existing users keep their versions.',
  saved: 'Default versions saved.',
  failed: 'Something went wrong while saving the default versions.',
  rulesTitle: 'Version Requests',
  rulesDescription:
    'Rules for users without the Manage Requests permission. Users with it can always request any version.',
  oneVersionPerTitle: 'One Version per Title',
  oneVersionPerTitleHelp:
    'Each user requests one version of a title. Off: a user can request several versions of the same title.',
  holdHours: 'Hold After a Request (Hours)',
  holdHoursHelp:
    "After a request in one version, other versions that its file may cover can't be requested for this long, or until the file arrives and shows whether it covers them. 0 turns the hold off.",
  rulesSaved: 'Version request rules saved.',
  rulesFailed: 'Something went wrong while saving the version request rules.',
  holdHoursInvalid: 'Enter a number of hours from 0 to 720.',
});

interface VersionSettings {
  defaultVersions: string[];
  holdHours: number;
  oneVersionPerTitle: boolean;
}

/** Settings → Users section for the versions new users get and version request rules. */
const DefaultVersions = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { data, mutate } = useSWR<VersionSettings>('/api/v1/settings/versions');
  const [saving, setSaving] = useState(false);
  const [holdInput, setHoldInput] = useState<string>('');

  useEffect(() => {
    if (data) {
      setHoldInput(String(data.holdHours));
    }
  }, [data]);

  if (!data) {
    return null;
  }

  const save = async (
    change: Partial<VersionSettings>,
    { saved, failed }: { saved: string; failed: string }
  ) => {
    setSaving(true);
    try {
      const response = await axios.post<VersionSettings>(
        '/api/v1/settings/versions',
        change
      );
      await mutate(response.data, { revalidate: false });
      addToast(saved, { autoDismiss: true, appearance: 'success' });
    } catch {
      await mutate();
      addToast(failed, { autoDismiss: true, appearance: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const ruleToasts = {
    saved: intl.formatMessage(messages.rulesSaved),
    failed: intl.formatMessage(messages.rulesFailed),
  };

  const saveHold = () => {
    const hours = Number(holdInput);
    if (
      holdInput.trim() === '' ||
      !Number.isFinite(hours) ||
      hours < 0 ||
      hours > 720
    ) {
      addToast(intl.formatMessage(messages.holdHoursInvalid), {
        autoDismiss: true,
        appearance: 'error',
      });
      setHoldInput(String(data.holdHours));
      return;
    }
    if (hours !== data.holdHours) {
      save({ holdHours: hours }, ruleToasts);
    }
  };

  return (
    <>
      <div className="section" aria-busy={saving}>
        <RequestServicesEdit
          title={intl.formatMessage(messages.title)}
          description={intl.formatMessage(messages.description)}
          value={data.defaultVersions}
          onChange={(versions) =>
            save(
              { defaultVersions: versions },
              {
                saved: intl.formatMessage(messages.saved),
                failed: intl.formatMessage(messages.failed),
              }
            )
          }
        />
        {saving && (
          <p className="mt-2 text-sm text-gray-400">
            {intl.formatMessage(globalMessages.saving)}
          </p>
        )}
      </div>
      <div className="mb-6 mt-10">
        <h3 className="heading">{intl.formatMessage(messages.rulesTitle)}</h3>
        <p className="description">
          {intl.formatMessage(messages.rulesDescription)}
        </p>
      </div>
      <div className="section">
        <div className="form-row">
          <label htmlFor="oneVersionPerTitle" className="checkbox-label">
            {intl.formatMessage(messages.oneVersionPerTitle)}
            <span className="label-tip">
              {intl.formatMessage(messages.oneVersionPerTitleHelp)}
            </span>
          </label>
          <div className="form-input-area">
            <input
              type="checkbox"
              id="oneVersionPerTitle"
              name="oneVersionPerTitle"
              checked={data.oneVersionPerTitle}
              disabled={saving}
              onChange={(e) =>
                save({ oneVersionPerTitle: e.target.checked }, ruleToasts)
              }
            />
          </div>
        </div>
        <div className="form-row">
          <label htmlFor="versionHoldHours" className="text-label">
            {intl.formatMessage(messages.holdHours)}
            <span className="label-tip">
              {intl.formatMessage(messages.holdHoursHelp)}
            </span>
          </label>
          <div className="form-input-area">
            <div className="form-input-field">
              <input
                type="number"
                id="versionHoldHours"
                name="versionHoldHours"
                className="short"
                min={0}
                max={720}
                step={1}
                value={holdInput}
                disabled={saving}
                onChange={(e) => setHoldInput(e.target.value)}
                onBlur={saveHold}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveHold();
                  }
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default DefaultVersions;
