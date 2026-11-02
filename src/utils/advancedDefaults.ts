/**
 * What the Advanced section of a request dialog starts from. `null` means
 * "use the server's default", as for a request saved without one.
 */
export interface RequestDefaults {
  server?: number | null;
  profile?: number | null;
  folder?: string | null;
  tags?: number[] | null;
  language?: number | null;
  ignoreQuota?: boolean | null;
}

/**
 * VSeerr: what the Advanced section of a request dialog starts from.
 *
 * - Editing a request keeps what it was made with (folder, profile, language
 *   and tags), on the version's server when it is a version request. Values
 *   the request was saved without stay null, so the server's default shows.
 * - A new version request starts from its server's defaults. `null` tells
 *   AdvancedRequester to use the server's default profile, language and
 *   tags; leaving them out would send no profile and no tags.
 * - A new standard request has nothing fixed, as in Seerr.
 */
export const advancedDefaults = ({
  serverId,
  editRequest,
}: {
  serverId?: number;
  editRequest?: {
    rootFolder?: string | null;
    profileId?: number | null;
    serverId?: number | null;
    languageProfileId?: number | null;
    tags?: number[] | null;
  };
}): RequestDefaults | undefined => {
  if (editRequest) {
    return {
      folder: editRequest.rootFolder,
      profile: editRequest.profileId,
      server: serverId ?? editRequest.serverId,
      language: editRequest.languageProfileId,
      tags: editRequest.tags,
    };
  }
  if (serverId != null) {
    return { server: serverId, profile: null, language: null, tags: null };
  }
  return undefined;
};
