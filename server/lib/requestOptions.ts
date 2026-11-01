import { ANIME_KEYWORD_ID } from '@server/api/themoviedb/constants';
import { MediaStatus } from '@server/constants/media';

// VSeerr request options: extra choices an admin attaches to a server
// (Settings → Services), shown to requesters as checkboxes under its version
// (the default non-4K server without a version name carries the options of
// the standard version). A ticked option sends the request with the option's
// quality profile. This file is shared by the server and the request dialog,
// so it must stay free of server-only imports.

export interface RequestOptionSetting {
  id: string;
  label: string;
  profileId: number;
  profileName?: string;
  onlyIfNoOtherVersion: boolean;
  /** Only offered for anime (TMDB keyword "anime"). */
  animeOnly?: boolean;
}

/**
 * What requesters see: the profile id (so the Advanced section can show the
 * profile the option requests), not the profile name.
 */
export type PublicRequestOption = Pick<
  RequestOptionSetting,
  'id' | 'label' | 'onlyIfNoOtherVersion' | 'animeOnly'
> &
  Partial<Pick<RequestOptionSetting, 'profileId'>>;

export const MAX_REQUEST_OPTIONS = 10;
const MAX_LABEL_LENGTH = 100;
const ID_PATTERN = /^[a-z0-9-]{1,40}$/;

const slug = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'option';

/**
 * Keeps well-formed options only: a label, a profile id, and an id that is
 * unique within the list (derived from the label when missing).
 */
export const sanitizeRequestOptions = (
  value: unknown
): RequestOptionSetting[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const options: RequestOptionSetting[] = [];
  for (const raw of value) {
    if (options.length >= MAX_REQUEST_OPTIONS) {
      break;
    }
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const item = raw as Record<string, unknown>;
    const label =
      typeof item.label === 'string'
        ? item.label.trim().slice(0, MAX_LABEL_LENGTH)
        : '';
    const profileId = Number(item.profileId);
    if (!label || !Number.isInteger(profileId) || profileId <= 0) {
      continue;
    }
    let id =
      typeof item.id === 'string' && ID_PATTERN.test(item.id)
        ? item.id
        : slug(label);
    for (let n = 2; seen.has(id); n++) {
      id = `${id.replace(/-\d+$/, '')}-${n}`;
    }
    seen.add(id);
    options.push({
      id,
      label,
      profileId,
      ...(typeof item.profileName === 'string' && item.profileName
        ? { profileName: item.profileName.slice(0, MAX_LABEL_LENGTH) }
        : {}),
      onlyIfNoOtherVersion: item.onlyIfNoOtherVersion === true,
      ...(item.animeOnly === true ? { animeOnly: true } : {}),
    });
  }
  return options;
};

export const publicRequestOptions = (
  options: RequestOptionSetting[] | undefined
): PublicRequestOption[] =>
  (options ?? []).map(
    ({ id, label, profileId, onlyIfNoOtherVersion, animeOnly }) => ({
      id,
      label,
      profileId,
      onlyIfNoOtherVersion,
      ...(animeOnly ? { animeOnly: true } : {}),
    })
  );

/** Whether TMDB marks the title as anime (movies list keywords, shows results). */
export const isAnimeTitle = (media: {
  keywords?: { keywords?: { id: number }[]; results?: { id: number }[] };
}): boolean =>
  [
    ...(media.keywords?.keywords ?? []),
    ...(media.keywords?.results ?? []),
  ].some((keyword) => keyword.id === ANIME_KEYWORD_ID);

/** Options a title can use: anime-only options are left out for other titles. */
export const optionsForTitle = <
  T extends Pick<PublicRequestOption, 'animeOnly'>,
>(
  options: T[] | undefined,
  isAnime: boolean
): T[] => (options ?? []).filter((o) => isAnime || !o.animeOnly);

/**
 * The server whose options apply to a standard request: the given server if
 * it is not a version, otherwise the default server without a version name
 * for the same 4K setting.
 */
export const standardOptionServer = <
  T extends {
    id: number;
    is4k?: boolean;
    isDefault?: boolean;
    buttonLabel?: string;
  },
>(
  servers: T[],
  is4k: boolean,
  serverId?: number | null
): T | undefined => {
  const plain = servers.filter(
    (s) => !!s.is4k === is4k && !s.buttonLabel?.trim()
  );
  if (serverId !== undefined && serverId !== null) {
    return plain.find((s) => s.id === serverId);
  }
  return plain.find((s) => s.isDefault) ?? plain[0];
};

const HAS_TITLE = new Set([
  MediaStatus.AVAILABLE,
  MediaStatus.PARTIALLY_AVAILABLE,
  MediaStatus.PROCESSING,
]);

/**
 * Whether a version other than `serverId` has the title: available, partly
 * available or downloading. `serverId` undefined means the standard version.
 * 4K servers and the standard 4K status are not considered.
 */
export const otherVersionHasTitle = ({
  serverId,
  standardStatus,
  serviceStatuses,
  standardServerIds,
  versionServerIds,
}: {
  serverId?: number;
  /** The title's standard (non-4K) status. */
  standardStatus?: MediaStatus;
  serviceStatuses: { serviceId: number; status: MediaStatus }[];
  /** Non-4K servers without a version name (they make up the standard version). */
  standardServerIds: number[];
  /** Non-4K servers with a version name. */
  versionServerIds: number[];
}): boolean => {
  const hasTitle = (status?: MediaStatus) =>
    status !== undefined && HAS_TITLE.has(status);
  if (serverId === undefined) {
    return serviceStatuses.some(
      (s) => versionServerIds.includes(s.serviceId) && hasTitle(s.status)
    );
  }
  const otherVersion = serviceStatuses.some(
    (s) =>
      s.serviceId !== serverId &&
      versionServerIds.includes(s.serviceId) &&
      hasTitle(s.status)
  );
  const standard = standardServerIds.length
    ? serviceStatuses.some(
        (s) => standardServerIds.includes(s.serviceId) && hasTitle(s.status)
      )
    : hasTitle(standardStatus);
  return otherVersion || standard;
};

/**
 * The quality profile for a request with the given option, or undefined to
 * use the server's default profile.
 */
export const requestOptionProfile = (
  option: RequestOptionSetting | undefined,
  otherVersionHas: boolean
): number | undefined =>
  option && !(option.onlyIfNoOtherVersion && otherVersionHas)
    ? option.profileId
    : undefined;
