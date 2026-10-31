import { getRepository } from '@server/datasource';
import { UserVersion } from '@server/entity/VSeerrVersions';
import type { MainSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { EntityManager } from 'typeorm';

// A version is a Radarr or Sonarr server with a version name (stored as
// `buttonLabel`). Grants and defaults identify versions as `radarr:<id>` or
// `sonarr:<id>`.
const VERSION_ID = /^(radarr|sonarr):\d+$/;

export type VersionSettings = Pick<MainSettings, 'defaultRequestServices'> & {
  radarr: { id: number; buttonLabel?: string }[];
  sonarr: { id: number; buttonLabel?: string }[];
};

const settingsForVersions = (): VersionSettings => {
  const settings = getSettings();
  return {
    defaultRequestServices: settings.main.defaultRequestServices,
    radarr: settings.radarr,
    sonarr: settings.sonarr,
  };
};

/** Version identifiers that exist in the given settings. */
export const configuredVersions = (settings: VersionSettings): string[] => [
  ...settings.radarr
    .filter((server) => !!server.buttonLabel?.trim())
    .map((server) => `radarr:${server.id}`),
  ...settings.sonarr
    .filter((server) => !!server.buttonLabel?.trim())
    .map((server) => `sonarr:${server.id}`),
];

/** Keeps well-formed identifiers only, without duplicates. */
export const wellFormedVersions = (versions: unknown): string[] =>
  Array.isArray(versions)
    ? [
        ...new Set(
          versions.filter(
            (version): version is string =>
              typeof version === 'string' && VERSION_ID.test(version)
          )
        ),
      ]
    : [];

/** Keeps identifiers of versions that are configured, without duplicates. */
export const sanitizeVersions = (
  versions: unknown,
  settings: VersionSettings
): string[] => {
  const configured = new Set(configuredVersions(settings));
  return wellFormedVersions(versions).filter((version) =>
    configured.has(version)
  );
};

/** The versions new users can request, as set in Settings → Users. */
export const getDefaultVersions = (
  settings: VersionSettings = settingsForVersions()
): string[] => sanitizeVersions(settings.defaultRequestServices, settings);

/** Replaces the versions a user may request. */
export const setUserVersions = async (
  userId: number,
  versions: string[],
  manager?: EntityManager
): Promise<string[]> => {
  const repository = manager
    ? manager.getRepository(UserVersion)
    : getRepository(UserVersion);
  const wanted = wellFormedVersions(versions);

  await repository.delete({ userId });
  if (wanted.length > 0) {
    await repository.insert(
      wanted.map((version) => new UserVersion({ userId, version }))
    );
  }

  return wanted.sort();
};

/**
 * Removes a version from every user and from the defaults. Called when its
 * server is deleted, because server ids are reused by the next server that
 * is added.
 */
export const removeVersionEverywhere = async (
  version: string
): Promise<void> => {
  const result = await getRepository(UserVersion).delete({ version });

  const settings = getSettings();
  const defaults = settings.main.defaultRequestServices ?? [];
  if (defaults.includes(version)) {
    settings.main.defaultRequestServices = defaults.filter(
      (defaultVersion) => defaultVersion !== version
    );
    await settings.save();
  }

  if (result.affected) {
    logger.info(
      `Removed the ${version} version from ${result.affected} user(s)`,
      { label: 'Versions' }
    );
  }
};
