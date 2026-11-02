import { getRepository } from '@server/datasource';
import { UserPreference } from '@server/entity/VSeerrVersions';

// VSeerr: request dialog preferences per user, saved with the account so
// they follow the user to every device and browser:
//   default-version-<movie|tv>              the version to preselect
//   option-<movie|tv>-<version key>         the request option to tick
// A version key is `standard`, `radarr:<id>` or `sonarr:<id>`.

const VERSION_KEY = '(standard|radarr:\\d{1,9}|sonarr:\\d{1,9})';
const DEFAULT_VERSION = new RegExp(`^default-version-(movie|tv)$`);
const OPTION = new RegExp(`^option-(movie|tv)-${VERSION_KEY}$`);
const VERSION_VALUE = new RegExp(`^${VERSION_KEY}$`);
const OPTION_VALUE = /^[a-z0-9-]{1,40}$/;
/** Plenty for every version of both media types; bounds what one user stores. */
export const MAX_PREFERENCES = 100;

export type VersionPreferences = Record<string, string>;

/** Whether `value` is a valid value for the preference `name`. */
export const isValidPreference = (name: string, value: unknown): boolean =>
  typeof value === 'string' &&
  ((DEFAULT_VERSION.test(name) && VERSION_VALUE.test(value)) ||
    (OPTION.test(name) && OPTION_VALUE.test(value)));

export const isPreferenceName = (name: string): boolean =>
  DEFAULT_VERSION.test(name) || OPTION.test(name);

export const getVersionPreferences = async (
  userId: number
): Promise<VersionPreferences> => {
  const rows = await getRepository(UserPreference).find({
    where: { userId },
    order: { name: 'ASC' },
  });
  return Object.fromEntries(rows.map((row) => [row.name, row.value]));
};

export class InvalidPreferenceError extends Error {}

/**
 * Applies changes: a string sets a preference, null removes it. Throws
 * InvalidPreferenceError for an unknown name or a malformed value, before
 * anything is saved.
 */
export const updateVersionPreferences = async (
  userId: number,
  changes: Record<string, unknown>
): Promise<VersionPreferences> => {
  const entries = Object.entries(changes);
  for (const [name, value] of entries) {
    if (
      value === null ? !isPreferenceName(name) : !isValidPreference(name, value)
    ) {
      throw new InvalidPreferenceError(
        `Invalid preference: ${name.slice(0, 80)}`
      );
    }
  }

  const repository = getRepository(UserPreference);
  const current = await getVersionPreferences(userId);
  const added = entries.filter(
    ([name, value]) => value !== null && !(name in current)
  ).length;
  if (Object.keys(current).length + added > MAX_PREFERENCES) {
    throw new InvalidPreferenceError('Too many preferences.');
  }

  for (const [name, value] of entries) {
    if (value === null) {
      await repository.delete({ userId, name });
    } else if (name in current) {
      await repository.update({ userId, name }, { value: value as string });
    } else {
      await repository.insert({ userId, name, value: value as string });
    }
  }
  return getVersionPreferences(userId);
};
