import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type Media from '@server/entity/Media';
import type { ServiceCommonServer } from '@server/interfaces/api/serviceInterfaces';
import type { PublicRequestOption } from '@server/lib/requestOptions';
import {
  optionsForTitle,
  otherVersionHasTitle,
  standardOptionServer,
} from '@server/lib/requestOptions';
import type { VersionCoverageResult } from '@server/lib/versionCoverage';
import {
  getLabelledServices,
  getMediaServiceStatus,
} from './serviceRequestStatus';

// The versions a user can pick from when requesting a title. The standard
// version (no server id) is the regular Seerr request. Users without the
// Manage Requests permission request one version of each title: once they
// have a request in one version, the others are closed to them. A declined
// request does not count. The server enforces the same rule.

/** `standard`, or `radarr:<id>` / `sonarr:<id>`. */
export type VersionKey = string;

export const STANDARD_VERSION: VersionKey = 'standard';

export interface VersionChoice {
  key: VersionKey;
  /** Undefined for the standard version. */
  serverId?: number;
  /** The version name; undefined for the standard version. */
  label?: string;
  status: MediaStatus;
  requestable: boolean;
  /** The user already requested another version of this title. */
  otherVersionHeld: boolean;
  /** Extra choices the admin attached to this version. */
  options: PublicRequestOption[];
  /**
   * Another version has the title (available or downloading), so options
   * marked "only if no other version has the title" do not apply.
   */
  otherVersionHasTitle: boolean;
  /** Movie: another version's file covers this one (its name, or null for standard). */
  coveredBy?: string | null;
  /** Movie: another version was just requested and may cover this one. */
  requestedVia?: string | null;
}

export const versionKey = (
  mediaType: 'movie' | 'tv',
  serverId?: number
): VersionKey =>
  serverId == null
    ? STANDARD_VERSION
    : `${mediaType === 'movie' ? 'radarr' : 'sonarr'}:${serverId}`;

/** The versions of a title the user has non-4K, not declined requests in. */
export const heldVersions = (
  media: Pick<Media, 'requests'> | undefined,
  userId: number | undefined,
  mediaType: 'movie' | 'tv'
): Set<VersionKey> =>
  new Set(
    (media?.requests ?? [])
      .filter(
        (request) =>
          userId != null &&
          request.requestedBy?.id === userId &&
          !request.is4k &&
          request.status !== MediaRequestStatus.DECLINED
      )
      .map((request) =>
        versionKey(
          mediaType,
          request.isServiceRequest ? request.serverId : undefined
        )
      )
  );

/** Whether the user requested a version of the title other than this one. */
export const holdsOtherVersion = (
  media: Pick<Media, 'requests'> | undefined,
  userId: number | undefined,
  mediaType: 'movie' | 'tv',
  serverId?: number
): boolean => {
  const held = heldVersions(media, userId, mediaType);
  return held.size > 0 && !held.has(versionKey(mediaType, serverId));
};

/** Whether a title in this status can still be requested in a version. */
const isOpenStatus = (mediaType: 'movie' | 'tv', status: MediaStatus) =>
  mediaType === 'movie'
    ? status === MediaStatus.UNKNOWN || status === MediaStatus.DELETED
    : status !== MediaStatus.AVAILABLE && status !== MediaStatus.BLOCKLISTED;

export const getVersionChoices = ({
  mediaType,
  media,
  services,
  isAnime = false,
  userId,
  grants,
  isManager,
  standardRequestable,
  coverage = [],
}: {
  mediaType: 'movie' | 'tv';
  media?: Pick<Media, 'status' | 'requests' | 'serviceStatuses'>;
  services?: ServiceCommonServer[];
  isAnime?: boolean;
  userId?: number;
  /** The user's versions (`radarr:<id>` / `sonarr:<id>`). */
  grants: string[];
  /** Users with Manage Requests may request every version, any number. */
  isManager: boolean;
  /** Overrides the status check for the standard version. */
  standardRequestable?: boolean;
  /** Coverage per version from `/api/v1/media/:id/versions`. */
  coverage?: VersionCoverageResult[];
}): VersionChoice[] => {
  const held = heldVersions(media, userId, mediaType);
  const closedByOtherVersion = (key: VersionKey) =>
    !isManager && held.size > 0 && !held.has(key);
  const blocklisted = media?.status === MediaStatus.BLOCKLISTED;
  // Coverage closes a version to users without Manage Requests (movies; for
  // shows it applies per season in the season list).
  const coverageOf = (key: VersionKey) => {
    const result = coverage.find((c) => c.key === key);
    if (mediaType !== 'movie' || !result) {
      return {};
    }
    return {
      ...(result.coveredBy
        ? { coveredBy: result.coveredBy.label ?? null }
        : {}),
      ...(result.requestedVia
        ? { requestedVia: result.requestedVia.label ?? null }
        : {}),
    };
  };
  const closedByCoverage = (key: VersionKey) => {
    const c = coverageOf(key);
    return !isManager && ('coveredBy' in c || 'requestedVia' in c);
  };

  const standardStatus = media?.status ?? MediaStatus.UNKNOWN;
  const standardServers = (services ?? []).filter((s) => !s.is4k);
  const hasTitleElsewhere = (serverId?: number) =>
    otherVersionHasTitle({
      serverId,
      standardStatus,
      serviceStatuses: media?.serviceStatuses ?? [],
      standardServerIds: standardServers
        .filter((s) => !s.buttonLabel?.trim())
        .map((s) => s.id),
      versionServerIds: standardServers
        .filter((s) => !!s.buttonLabel?.trim())
        .map((s) => s.id),
    });
  const choices: VersionChoice[] = [
    {
      key: STANDARD_VERSION,
      status: standardStatus,
      requestable:
        !blocklisted &&
        (standardRequestable ?? isOpenStatus(mediaType, standardStatus)) &&
        !closedByOtherVersion(STANDARD_VERSION) &&
        !closedByCoverage(STANDARD_VERSION),
      otherVersionHeld: closedByOtherVersion(STANDARD_VERSION),
      options: optionsForTitle(
        standardOptionServer(services ?? [], false)?.requestOptions,
        isAnime
      ),
      otherVersionHasTitle: hasTitleElsewhere(undefined),
      ...coverageOf(STANDARD_VERSION),
    },
  ];

  for (const service of getLabelledServices(services)) {
    if (service.animeOnly && !isAnime) {
      continue;
    }
    const key = versionKey(mediaType, service.id);
    if (!isManager && !grants.includes(key)) {
      continue;
    }
    const { status } = getMediaServiceStatus(media as Media, service.id);
    choices.push({
      key,
      serverId: service.id,
      label: service.buttonLabel,
      status,
      requestable:
        !blocklisted &&
        isOpenStatus(mediaType, status) &&
        !closedByOtherVersion(key) &&
        !closedByCoverage(key),
      otherVersionHeld: closedByOtherVersion(key),
      options: optionsForTitle(service.requestOptions, isAnime),
      otherVersionHasTitle: hasTitleElsewhere(service.id),
      ...coverageOf(key),
    });
  }

  return choices;
};

const storageKey = (userId: number, mediaType: 'movie' | 'tv') =>
  `vseerr-version-choice-${userId}-${mediaType}`;

/** The version the user chose to use by default on this device. */
export const getRememberedVersion = (
  userId: number | undefined,
  mediaType: 'movie' | 'tv'
): VersionKey | null => {
  if (userId == null || typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(storageKey(userId, mediaType));
  } catch {
    return null;
  }
};

export const setRememberedVersion = (
  userId: number | undefined,
  mediaType: 'movie' | 'tv',
  key: VersionKey | null
): void => {
  if (userId == null || typeof window === 'undefined') {
    return;
  }
  try {
    if (key) {
      window.localStorage.setItem(storageKey(userId, mediaType), key);
    } else {
      window.localStorage.removeItem(storageKey(userId, mediaType));
    }
  } catch {
    // Storage can be unavailable (private mode); the choice is not kept.
  }
};

/**
 * The choice to preselect: the remembered one if it can be requested, or the
 * only requestable one. Otherwise none, so the user chooses explicitly.
 */
export const initialVersionChoice = (
  choices: VersionChoice[],
  remembered: VersionKey | null
): VersionKey | null => {
  const requestable = choices.filter((choice) => choice.requestable);
  if (remembered && requestable.some((choice) => choice.key === remembered)) {
    return remembered;
  }
  return requestable.length === 1 ? requestable[0].key : null;
};

/**
 * Whether an option takes effect: options marked "only if no other version
 * has the title" are skipped once another version has it. The server
 * applies the same rule.
 */
export const optionApplies = (
  choice: Pick<VersionChoice, 'otherVersionHasTitle'>,
  option: Pick<PublicRequestOption, 'onlyIfNoOtherVersion'>
): boolean => !(option.onlyIfNoOtherVersion && choice.otherVersionHasTitle);

const optionStorageKey = (
  userId: number,
  mediaType: 'movie' | 'tv',
  key: VersionKey
) => `vseerr-version-option-${userId}-${mediaType}-${key}`;

/** The option the user last ticked for this version on this device. */
export const getRememberedOption = (
  userId: number | undefined,
  mediaType: 'movie' | 'tv',
  key: VersionKey | null
): string | null => {
  if (userId == null || !key || typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(
      optionStorageKey(userId, mediaType, key)
    );
  } catch {
    return null;
  }
};

export const setRememberedOption = (
  userId: number | undefined,
  mediaType: 'movie' | 'tv',
  key: VersionKey | null,
  optionId: string | null
): void => {
  if (userId == null || !key || typeof window === 'undefined') {
    return;
  }
  try {
    if (optionId) {
      window.localStorage.setItem(
        optionStorageKey(userId, mediaType, key),
        optionId
      );
    } else {
      window.localStorage.removeItem(optionStorageKey(userId, mediaType, key));
    }
  } catch {
    // Storage can be unavailable (private mode); the choice is not kept.
  }
};
