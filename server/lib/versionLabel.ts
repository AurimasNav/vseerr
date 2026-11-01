import { MediaType } from '@server/constants/media';
import type { DVRSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';

// VSeerr: the version name shown in request notifications, e.g. the event
// "Movie Request Automatically Approved in German". Standard requests and
// servers without a version name keep Seerr's wording.

interface VersionRequest {
  type: MediaType;
  isServiceRequest?: boolean;
  serverId?: number | null;
}

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

export const requestVersionLabel = (
  request: VersionRequest
): string | undefined => {
  const settings = getSettings();
  return versionLabelFrom(
    request,
    request.type === MediaType.MOVIE ? settings.radarr : settings.sonarr
  );
};

/** Appends " in <version>" to a notification event. */
export const withVersion = (event: string, label?: string): string =>
  label ? `${event} in ${label}` : event;
