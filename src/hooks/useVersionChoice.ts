import { Permission, useUser } from '@app/hooks/useUser';
import type { VersionKey } from '@app/utils/versionChoices';
import {
  getRememberedOption,
  getRememberedVersion,
  getVersionChoices,
  initialVersionChoice,
  optionApplies,
  setRememberedOption,
  setRememberedVersion,
} from '@app/utils/versionChoices';
import type Media from '@server/entity/Media';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type { MediaVersionsResponse } from '@server/lib/mediaVersions';
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
  media?: Pick<Media, 'id' | 'status' | 'requests' | 'serviceStatuses'>;
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
  // Coverage between versions; only titles Seerr already tracks have it.
  const { data: mediaVersions } = useSWR<MediaVersionsResponse>(
    enabled && media?.id ? `/api/v1/media/${media.id}/versions` : null
  );
  const [picked, setPicked] = useState<VersionKey | null>(null);
  const [useByDefaultChoice, setUseByDefaultChoice] = useState<boolean | null>(
    null
  );
  /** Ticked option per version; undefined = not touched (use the remembered one). */
  const [pickedOptions, setPickedOptions] = useState<
    Record<VersionKey, string | null>
  >({});

  const choices = enabled
    ? getVersionChoices({
        mediaType,
        media,
        services,
        isAnime,
        userId: user?.id,
        grants: user?.requestServices ?? [],
        isManager: hasPermission(Permission.MANAGE_REQUESTS),
        coverage: mediaVersions?.versions.map((v) => v.coverage),
      })
    : [];
  const remembered = getRememberedVersion(user?.id, mediaType);
  const selected = picked ?? initialVersionChoice(choices, remembered);
  const choice = choices.find((c) => c.key === selected);
  // A single version is still shown when it has options to tick.
  const showPicker =
    choices.length > 1 || (choices[0]?.options.length ?? 0) > 0;
  const useByDefault =
    useByDefaultChoice ?? (!!selected && selected === remembered);
  const rememberedOption = getRememberedOption(user?.id, mediaType, selected);
  const optionId =
    selected && selected in pickedOptions
      ? pickedOptions[selected]
      : choice?.options.some((o) => o.id === rememberedOption)
        ? rememberedOption
        : null;
  const option = choice?.options.find((o) => o.id === optionId);

  return {
    /** Coverage per version (shows use it per season). */
    coverage: mediaVersions?.versions.map((v) => v.coverage) ?? [],
    /** Services are still loading, so the choices are not known yet. */
    loading: enabled && !services,
    showPicker,
    /** The chosen version's server; undefined for the standard version. */
    serverId: showPicker ? choice?.serverId : undefined,
    /** The picker is shown and no requestable version is chosen. */
    missing: showPicker && !choice?.requestable,
    /** The ticked request option of the chosen version, if any. */
    requestOption:
      showPicker && option && choice && optionApplies(choice, option)
        ? option.id
        : undefined,
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
      optionId: optionId ?? null,
      onOptionChange: (id: string | null) => {
        if (selected) {
          setPickedOptions((current) => ({ ...current, [selected]: id }));
        }
      },
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
      if (choice?.options.length) {
        setRememberedOption(user?.id, mediaType, selected, optionId ?? null);
      }
    },
  };
};

export default useVersionChoice;
