import {
  InvalidPreferenceError,
  getVersionPreferences,
  updateVersionPreferences,
} from '@server/lib/versionPreferences';
import { isOwnProfileOrAdmin } from '@server/utils/profileMiddleware';
import { Router } from 'express';

// VSeerr: /api/v1/user/:id/settings/versions — the user's request dialog
// preferences (default version, ticked request option per version).
const versionPreferenceRoutes = Router({ mergeParams: true });

versionPreferenceRoutes.get<{ id: string }>(
  '/',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      return res.status(200).json({
        preferences: await getVersionPreferences(Number(req.params.id)),
      });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

versionPreferenceRoutes.post<
  { id: string },
  unknown,
  { preferences?: Record<string, unknown> }
>('/', isOwnProfileOrAdmin(), async (req, res, next) => {
  const changes = req.body?.preferences;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return next({ status: 400, message: 'preferences must be an object.' });
  }
  try {
    return res.status(200).json({
      preferences: await updateVersionPreferences(
        Number(req.params.id),
        changes
      ),
    });
  } catch (e) {
    if (e instanceof InvalidPreferenceError) {
      return next({ status: 400, message: e.message });
    }
    next({ status: 500, message: e.message });
  }
});

export default versionPreferenceRoutes;
