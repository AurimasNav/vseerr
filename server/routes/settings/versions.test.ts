import assert from 'node:assert/strict';
import path from 'node:path';
import { before, beforeEach, describe, it } from 'node:test';

import { Permission } from '@server/lib/permissions';
import type { RadarrSettings, SonarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import versionSettingsRoutes from '@server/routes/settings/versions';
import { setupTestDb } from '@server/test/db';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import express from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import session from 'express-session';
import request from 'supertest';

// Runs behind the same OpenAPI request validator as the server, so a route
// missing from seerr-api.yml fails here instead of answering 404 in production.
let app: Express;

function createApp() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use(
    OpenApiValidator.middleware({
      apiSpec: path.join(__dirname, '../../../seerr-api.yml'),
      validateRequests: true,
    })
  );
  app.use(checkUser);
  app.use('/api/v1/auth', authRoutes);
  app.use(
    '/api/v1/settings/versions',
    isAuthenticated(Permission.ADMIN),
    versionSettingsRoutes
  );
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

before(() => {
  app = createApp();
});

beforeEach(() => {
  const settings = getSettings();
  // Only servers with a version name are versions.
  settings.radarr = [
    { id: 0 },
    { id: 1, buttonLabel: 'German' },
  ] as RadarrSettings[];
  settings.sonarr = [{ id: 0, buttonLabel: 'German' }] as SonarrSettings[];
  settings.main.defaultRequestServices = [];
});

setupTestDb();

async function loginAs(email: string) {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;

  try {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/v1/auth/local')
      .send({ email, password: 'test1234' });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

describe('/settings/versions', () => {
  it('returns the default versions', async () => {
    getSettings().main.defaultRequestServices = ['radarr:1'];
    const admin = await loginAs('admin@seerr.dev');

    const res = await admin.get('/api/v1/settings/versions');

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { defaultVersions: ['radarr:1'] });
  });

  it('saves the default versions and drops unknown ones', async () => {
    const admin = await loginAs('admin@seerr.dev');

    const res = await admin.post('/api/v1/settings/versions').send({
      defaultVersions: ['radarr:1', 'sonarr:0', 'radarr:0', 'radarr:9'],
    });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      defaultVersions: ['radarr:1', 'sonarr:0'],
    });
    assert.deepStrictEqual(getSettings().main.defaultRequestServices, [
      'radarr:1',
      'sonarr:0',
    ]);
  });

  it('rejects a body without a list', async () => {
    const admin = await loginAs('admin@seerr.dev');

    const res = await admin
      .post('/api/v1/settings/versions')
      .send({ defaultVersions: 'radarr:1' });

    assert.strictEqual(res.status, 400);
  });

  it('is limited to admins', async () => {
    const user = await loginAs('demo@seerr.dev');

    const res = await user.get('/api/v1/settings/versions');

    assert.strictEqual(res.status, 403);
  });
});
