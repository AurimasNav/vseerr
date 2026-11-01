import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
import { standardOptionServer } from '@server/lib/requestOptions';
import type { DVRSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

// VSeerr: the version name shown in request notifications, e.g. the event
// "Movie Request Automatically Approved in German". Once a server has
// versions, a standard request is named too: "in Standard", plus its quality
// profile when that is not the server's default, e.g.
// "in Standard (Anime dub-only)". Setups without versions keep Seerr's
// wording.

interface VersionRequest {
  type: MediaType;
  isServiceRequest?: boolean;
  serverId?: number | null;
  is4k?: boolean;
  profileId?: number | null;
}

type LabelServer = Pick<DVRSettings, 'id' | 'name' | 'buttonLabel'> &
  Partial<Pick<DVRSettings, 'is4k' | 'isDefault' | 'activeProfileId'>>;

/** The version name of a request, or undefined for the standard version. */
export const versionLabelFrom = (
  request: VersionRequest,
  servers: Pick<DVRSettings, 'id' | 'name' | 'buttonLabel'>[]
): string | undefined => {
  if (!request.isServiceRequest || request.serverId == null) {
    return undefined;
  }
  const server = servers.find((s) => s.id === request.serverId);
  const label = server?.buttonLabel?.trim() || server?.name?.trim();
  return label || undefined;
};

const serversFor = (type: MediaType): DVRSettings[] => {
  const settings = getSettings();
  return type === MediaType.MOVIE ? settings.radarr : settings.sonarr;
};

export const requestVersionLabel = (
  request: VersionRequest
): string | undefined => versionLabelFrom(request, serversFor(request.type));

const hasVersions = (servers: LabelServer[]) =>
  servers.some((s) => s.buttonLabel?.trim());

/** The standard server a request went to and whether its profile is custom. */
const standardTarget = <T extends LabelServer>(
  request: VersionRequest,
  servers: T[]
) => {
  const server = standardOptionServer<T>(
    servers,
    !!request.is4k,
    request.serverId
  );
  const customProfile =
    !!server &&
    !!request.profileId &&
    request.profileId !== server.activeProfileId;
  return { server, customProfile };
};

/**
 * The label of a standard request: "Standard", plus the profile name when
 * the request uses a profile other than the server's default. Undefined for
 * version requests and when no server has a version name.
 */
export const standardLabelFrom = (
  request: VersionRequest,
  servers: LabelServer[],
  profileName?: string
): string | undefined => {
  if (request.isServiceRequest || !hasVersions(servers)) {
    return undefined;
  }
  const { customProfile } = standardTarget(request, servers);
  const name = profileName?.trim();
  return customProfile && name ? `Standard (${name})` : 'Standard';
};

const profileNameOf = async (
  server: DVRSettings,
  type: MediaType,
  profileId: number
): Promise<string | undefined> => {
  try {
    const url = RadarrAPI.buildUrl(server, '/api/v3');
    const api =
      type === MediaType.MOVIE
        ? new RadarrAPI({ url, apiKey: server.apiKey })
        : new SonarrAPI({ url, apiKey: server.apiKey });
    const profiles = await api.getProfiles();
    return profiles.find((p) => p.id === profileId)?.name;
  } catch (e) {
    logger.debug('Could not read the profile name for a notification', {
      label: 'Notifications',
      errorMessage: e.message,
    });
    return undefined;
  }
};

/**
 * The name shown after "in" in a request notification: the version of a
 * version request, "Standard" (with a non-default profile) for a standard
 * request, or undefined when the server has no versions.
 */
export const requestNotificationLabel = async (
  request: VersionRequest
): Promise<string | undefined> => {
  const servers = serversFor(request.type);
  if (request.isServiceRequest) {
    return versionLabelFrom(request, servers);
  }
  if (!hasVersions(servers)) {
    return undefined;
  }
  const { server, customProfile } = standardTarget(request, servers);
  const profileName =
    server && customProfile && request.profileId
      ? await profileNameOf(server, request.type, request.profileId)
      : undefined;
  return standardLabelFrom(request, servers, profileName);
};

/** Appends " in <version>" to a notification event. */
export const withVersion = (event: string, label?: string): string =>
  label ? `${event} in ${label}` : event;
