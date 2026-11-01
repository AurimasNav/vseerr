import { Permission, useUser } from '@app/hooks/useUser';
import type { VersionKey } from '@app/utils/versionChoices';
import {
  getRememberedVersion,
  getVersionChoices,
  initialVersionChoice,
  setRememberedVersion,
} from '@app/utils/versionChoices';
import type Media from '@server/entity/Media';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import { useState } from 'react';
import useSWR from 'swr';

/**
 * State for the version picker in the request dialogs. When the user can
 * request more than one version of a title, they choose one explicitly; a
 * version they marked "use by default" is preselected.
 */
const useVersionChoice = ({
  mediaType,
  media,
  isAnime = false,
  enabled,
  onChange,
}: {
  mediaType: 'movie' | 'tv';
  media?: Pick<Media, 'status' | 'requests' | 'serviceStatuses'>;
  isAnime?: boolean;
  /** Off when editing a request or when the version is already fixed. */
  enabled: boolean;
  /** Called when the user picks another version (to reset overrides). */
  onChange?: () => void;
}) => {
  const { user, hasPermission } = useUser();
  const { data: services } = useSWR<ServiceCommonServer[]>(
    enabled
      ? mediaType === 'movie'
        ? '/api/v1/service/radarr'
        : '/api/v1/service/sonarr'
      : null
  );
  const [picked, setPicked] = useState<VersionKey | null>(null);
  const [useByDefaultChoice, setUseByDefaultChoice] = useState<boolean | null>(
    null
  );

  const choices = enabled
    ? getVersionChoices({
        mediaType,
        media,
        services,
        isAnime,
        userId: user?.id,
        grants: user?.requestServices ?? [],
        isManager: hasPermission(Permission.MANAGE_REQUESTS),
      })
    : [];
  const remembered = getRememberedVersion(user?.id, mediaType);
  const selected = picked ?? initialVersionChoice(choices, remembered);
  const choice = choices.find((c) => c.key === selected);
  const showPicker = choices.length > 1;
  const useByDefault =
    useByDefaultChoice ?? (!!selected && selected === remembered);

  return {
    /** Services are still loading, so the choices are not known yet. */
    loading: enabled && !services,
    showPicker,
    /** The chosen version's server; undefined for the standard version. */
    serverId: showPicker ? choice?.serverId : undefined,
    /** The picker is shown and no requestable version is chosen. */
    missing: showPicker && !choice?.requestable,
    pickerProps: {
      choices,
      selected,
      onSelect: (key: VersionKey) => {
        if (key !== selected) {
          setPicked(key);
          onChange?.();
        }
      },
      useByDefault,
      onUseByDefaultChange: setUseByDefaultChoice,
    },
    /** Stores or clears the default after a successful request. */
    commit: () => {
      if (!showPicker || !selected) {
        return;
      }
      if (useByDefault) {
        setRememberedVersion(user?.id, mediaType, selected);
      } else if (remembered === selected) {
        setRememberedVersion(user?.id, mediaType, null);
      }
    },
  };
};

export default useVersionChoice;
