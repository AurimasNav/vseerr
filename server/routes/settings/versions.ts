import { getSettings } from '@server/lib/settings';
import { getDefaultVersions, sanitizeVersions } from '@server/lib/versions';
import { Router } from 'express';

// Default versions are saved through their own route because the main
// settings route merges arrays element by element, which would keep
// versions that were removed.
const versionSettingsRoutes = Router();

versionSettingsRoutes.get('/', (_req, res) => {
  return res.status(200).json({ defaultVersions: getDefaultVersions() });
});

versionSettingsRoutes.post<
  never,
  { defaultVersions: string[] },
  { defaultVersions?: unknown }
>('/', async (req, res, next) => {
  if (!Array.isArray(req.body?.defaultVersions)) {
    return next({ status: 400, message: 'defaultVersions must be a list.' });
  }

  const settings = getSettings();
  settings.main.defaultRequestServices = sanitizeVersions(
    req.body.defaultVersions,
    {
      defaultRequestServices: settings.main.defaultRequestServices,
      radarr: settings.radarr,
      sonarr: settings.sonarr,
    }
  );
  await settings.save();

  return res
    .status(200)
    .json({ defaultVersions: settings.main.defaultRequestServices });
});

export default versionSettingsRoutes;
