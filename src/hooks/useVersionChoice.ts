import { Permission, useUser } from '@app/hooks/useUser';
import type { VersionKey } from '@app/utils/versionChoices';
import {
  clearLegacyPreferences,
  defaultVersionPreference,
  getVersionChoices,
  initialVersionChoice,
  legacyPreferences,
  optionApplies,
  optionPreference,
  preferenceChanges,
} from '@app/utils/versionChoices';
import type Media from '@server/entity/Media';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type { MediaVersionsResponse } from '@server/lib/mediaVersions';
import axios from 'axios';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

interface PreferencesResponse {
  preferences: Record<string, string>;
}

/**
 * State for the version picker in the request dialogs. When the user can
 * request more than one version of a title, they choose one explicitly; a
 * version they marked "use by default" is preselected. The default and the
 * ticked request options are saved with the user's account.
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
  const preferencesUrl =
    enabled && user ? `/api/v1/user/${user.id}/settings/versions` : null;
  const { data: preferenceData, mutate: mutatePreferences } =
    useSWR<PreferencesResponse>(preferencesUrl);
  // Older builds kept these in the browser; move them to the account once.
  useEffect(() => {
    if (!preferencesUrl || !preferenceData || !user) {
      return;
    }
    const legacy = legacyPreferences(user.id);
    const missing = Object.fromEntries(
      Object.entries(legacy).filter(
        ([name]) => !(name in preferenceData.preferences)
      )
    );
    if (Object.keys(legacy).length === 0) {
      return;
    }
    (Object.keys(missing).length > 0
      ? axios.post<PreferencesResponse>(preferencesUrl, {
          preferences: missing,
        })
      : Promise.resolve(null)
    )
      .then((response) => {
        clearLegacyPreferences(user.id);
        if (response) {
          mutatePreferences(response.data, false);
        }
      })
      .catch(() => {
        // Keep them in the browser and try again next time.
      });
  }, [preferencesUrl, preferenceData, user, mutatePreferences]);
  const saved = preferenceData?.preferences ?? {};
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
  const remembered = saved[defaultVersionPreference(mediaType)] ?? null;
  const selected = picked ?? initialVersionChoice(choices, remembered);
  const choice = choices.find((c) => c.key === selected);
  // A single version is still shown when it has options to tick.
  const showPicker =
    choices.length > 1 || (choices[0]?.options.length ?? 0) > 0;
  const useByDefault =
    useByDefaultChoice ?? (!!selected && selected === remembered);
  const rememberedOption = selected
    ? (saved[optionPreference(mediaType, selected)] ?? null)
    : null;
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
    /** Services or preferences are still loading. */
    loading: enabled && (!services || (!!preferencesUrl && !preferenceData)),
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
    /** Its quality profile, shown in the Advanced section. */
    requestOptionProfileId:
      showPicker && option && choice && optionApplies(choice, option)
        ? option.profileId
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
    /** Saves or clears the default and the ticked option after a request. */
    commit: () => {
      if (!showPicker || !selected || !preferencesUrl) {
        return;
      }
      const changes = preferenceChanges({
        mediaType,
        saved,
        selected,
        useByDefault,
        hasOptions: !!choice?.options.length,
        optionId: optionId ?? null,
      });
      if (Object.keys(changes).length === 0) {
        return;
      }
      axios
        .post<PreferencesResponse>(preferencesUrl, { preferences: changes })
        .then((response) => mutatePreferences(response.data, false))
        .catch(() => {
          // The request went through; only the preference was not saved.
        });
    },
  };
};

export default useVersionChoice;
