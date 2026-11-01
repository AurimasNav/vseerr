import { MediaStatus } from '@server/constants/media';

// VSeerr request options: extra choices an admin attaches to a version
// (Settings → Services), shown to requesters as checkboxes under that
// version. A ticked option sends the request with the option's quality
// profile. This file is shared by the server and the request dialog, so it
// must stay free of server-only imports.

export interface RequestOptionSetting {
  id: string;
  label: string;
  profileId: number;
  profileName?: string;
  onlyIfNoOtherVersion: boolean;
}

/** What requesters see: no profile details. */
export type PublicRequestOption = Pick<
  RequestOptionSetting,
  'id' | 'label' | 'onlyIfNoOtherVersion'
>;

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
    });
  }
  return options;
};

export const publicRequestOptions = (
  options: RequestOptionSetting[] | undefined
): PublicRequestOption[] =>
  (options ?? []).map(({ id, label, onlyIfNoOtherVersion }) => ({
    id,
    label,
    onlyIfNoOtherVersion,
  }));

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
