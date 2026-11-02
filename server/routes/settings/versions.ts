import { getSettings } from '@server/lib/settings';
import type { VersionRules } from '@server/lib/versions';
import {
  getDefaultVersions,
  getVersionRules,
  MAX_HOLD_HOURS,
  sanitizeVersions,
} from '@server/lib/versions';
import { Router } from 'express';

// Default versions are saved through their own route because the main
// settings route merges arrays element by element, which would keep
// versions that were removed. The version request rules live here too.
const versionSettingsRoutes = Router();

type VersionSettingsResponse = { defaultVersions: string[] } & VersionRules;

const current = (): VersionSettingsResponse => ({
  defaultVersions: getDefaultVersions(),
  ...getVersionRules(),
});

versionSettingsRoutes.get('/', (_req, res) => {
  return res.status(200).json(current());
});

versionSettingsRoutes.post<
  never,
  VersionSettingsResponse,
  {
    defaultVersions?: unknown;
    holdHours?: unknown;
    oneVersionPerTitle?: unknown;
  }
>('/', async (req, res, next) => {
  const body = req.body ?? {};
  if (
    body.defaultVersions === undefined &&
    body.holdHours === undefined &&
    body.oneVersionPerTitle === undefined
  ) {
    return next({ status: 400, message: 'Nothing to save.' });
  }
  if (
    body.defaultVersions !== undefined &&
    !Array.isArray(body.defaultVersions)
  ) {
    return next({ status: 400, message: 'defaultVersions must be a list.' });
  }
  if (
    body.holdHours !== undefined &&
    (typeof body.holdHours !== 'number' ||
      !Number.isFinite(body.holdHours) ||
      body.holdHours < 0 ||
      body.holdHours > MAX_HOLD_HOURS)
  ) {
    return next({
      status: 400,
      message: `holdHours must be a number from 0 to ${MAX_HOLD_HOURS}.`,
    });
  }
  if (
    body.oneVersionPerTitle !== undefined &&
    typeof body.oneVersionPerTitle !== 'boolean'
  ) {
    return next({
      status: 400,
      message: 'oneVersionPerTitle must be true or false.',
    });
  }

  const settings = getSettings();
  if (body.defaultVersions !== undefined) {
    settings.main.defaultRequestServices = sanitizeVersions(
      body.defaultVersions,
      {
        defaultRequestServices: settings.main.defaultRequestServices,
        radarr: settings.radarr,
        sonarr: settings.sonarr,
      }
    );
  }
  if (typeof body.holdHours === 'number') {
    settings.main.versionHoldHours = Math.round(body.holdHours * 10) / 10;
  }
  if (typeof body.oneVersionPerTitle === 'boolean') {
    settings.main.oneVersionPerTitle = body.oneVersionPerTitle;
  }
  await settings.save();

  return res.status(200).json(current());
});

export default versionSettingsRoutes;
