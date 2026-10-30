import RequestServicesEdit from '@app/components/RequestServicesEdit';
import useToasts from '@app/hooks/useToasts';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Settings.DefaultVersions', {
  title: 'Default Versions',
  description:
    'Versions new users can request. Existing users keep their versions.',
  saved: 'Default versions saved.',
  failed: 'Something went wrong while saving the default versions.',
});

/** Settings → Users section for the versions new users get. */
const DefaultVersions = () => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { data, mutate } = useSWR<{ defaultVersions: string[] }>(
    '/api/v1/settings/versions'
  );
  const [saving, setSaving] = useState(false);

  if (!data) {
    return null;
  }

  const save = async (defaultVersions: string[]) => {
    setSaving(true);
    try {
      const response = await axios.post<{ defaultVersions: string[] }>(
        '/api/v1/settings/versions',
        { defaultVersions }
      );
      await mutate(response.data, { revalidate: false });
      addToast(intl.formatMessage(messages.saved), {
        autoDismiss: true,
        appearance: 'success',
      });
    } catch {
      addToast(intl.formatMessage(messages.failed), {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="section" aria-busy={saving}>
      <RequestServicesEdit
        title={intl.formatMessage(messages.title)}
        description={intl.formatMessage(messages.description)}
        value={data.defaultVersions}
        onChange={(versions) => save(versions)}
      />
      {saving && (
        <p className="mt-2 text-sm text-gray-400">
          {intl.formatMessage(globalMessages.saving)}
        </p>
      )}
    </div>
  );
};

export default DefaultVersions;
