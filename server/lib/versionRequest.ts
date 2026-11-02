import type { RadarrSettings, SonarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { isVersionDestination } from '@server/lib/versions';

// VSeerr: one check for the server a request goes to, used when a request is
// created and when it is edited. A version is a server with a version name;
// a version request takes its 4K setting from that server, and a standard
// request may only go to a server with its own 4K setting.

export class VersionTargetError extends Error {}

type TargetServer = Pick<RadarrSettings | SonarrSettings, 'id'> &
  Partial<
    Pick<RadarrSettings | SonarrSettings, 'is4k' | 'buttonLabel' | 'animeOnly'>
  >;

export interface RequestTarget {
  /** The 4K setting the request gets. */
  is4k: boolean;
  /** The chosen server, when the request names one that exists. */
  server?: TargetServer;
}

export const resolveTarget = (
  {
    mediaType,
    serverId,
    is4k,
    isServiceRequest,
  }: {
    mediaType: 'movie' | 'tv';
    serverId?: number | null;
    is4k: boolean;
    isServiceRequest: boolean;
  },
  settings: {
    radarr: TargetServer[];
    sonarr: TargetServer[];
  } = getSettings()
): RequestTarget => {
  const servers = mediaType === 'movie' ? settings.radarr : settings.sonarr;
  const server =
    serverId == null ? undefined : servers.find((s) => s.id === serverId);

  if (isServiceRequest) {
    if (!server) {
      throw new VersionTargetError(
        'Service-specific requests must target a configured server.'
      );
    }
    if (!server.buttonLabel?.trim()) {
      throw new VersionTargetError(
        'This server is not a version. Make a standard request instead.'
      );
    }
    return { is4k: !!server.is4k, server };
  }

  if (server && !!server.is4k !== is4k) {
    throw new VersionTargetError(
      is4k
        ? 'A 4K request needs a 4K server.'
        : 'A request that is not 4K cannot go to a 4K server.'
    );
  }
  if (isVersionDestination(mediaType, serverId, is4k, settings)) {
    throw new VersionTargetError(
      'This server is a version. Request it as that version instead.'
    );
  }
  return { is4k, server };
};

/** The key a user's grant for this version server is stored under. */
export const versionGrantKey = (
  mediaType: 'movie' | 'tv',
  serverId: number
): string => `${mediaType === 'movie' ? 'radarr' : 'sonarr'}:${serverId}`;
