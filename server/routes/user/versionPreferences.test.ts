import assert from 'node:assert/strict';
import path from 'node:path';
import { before, describe, it } from 'node:test';

import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import { checkUser, isAuthenticated } from '@server/middleware/auth';
import authRoutes from '@server/routes/auth';
import userRoutes from '@server/routes/user';
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
    session({ secret: 'test-secret', resave: false, saveUninitialized: false })
  );
  app.use(
    OpenApiValidator.middleware({
      apiSpec: path.join(__dirname, '../../../seerr-api.yml'),
      validateRequests: true,
    })
  );
  app.use(checkUser);
  app.use('/api/v1/auth', authRoutes);
  // Mounted like the server does: usersettings.ts and user/index.ts import
  // each other, so loading usersettings first would break the cycle.
  app.use('/api/v1/user', isAuthenticated(), userRoutes);
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

const idOf = async (email: string) =>
  (await getRepository(User).findOneOrFail({ where: { email } })).id;

describe('/user/:id/settings/versions', () => {
  it('saves preferences with the account, so every device sees them', async () => {
    const demo = await loginAs('demo@seerr.dev');
    const id = await idOf('demo@seerr.dev');

    const saved = await demo.post(`/api/v1/user/${id}/settings/versions`).send({
      preferences: {
        'default-version-movie': 'radarr:2',
        'option-movie-radarr:2': 'english-until-dubbed',
      },
    });
    assert.strictEqual(saved.status, 200);

    // A second session stands in for another device.
    const other = await loginAs('demo@seerr.dev');
    const res = await other.get(`/api/v1/user/${id}/settings/versions`);
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.preferences, {
      'default-version-movie': 'radarr:2',
      'option-movie-radarr:2': 'english-until-dubbed',
    });
  });

  it('updates and removes preferences', async () => {
    const demo = await loginAs('demo@seerr.dev');
    const id = await idOf('demo@seerr.dev');
    const url = `/api/v1/user/${id}/settings/versions`;
    await demo.post(url).send({
      preferences: {
        'default-version-tv': 'sonarr:1',
        'option-tv-sonarr:1': 'a',
      },
    });

    const res = await demo.post(url).send({
      preferences: {
        'default-version-tv': 'standard',
        'option-tv-sonarr:1': null,
      },
    });

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.preferences, {
      'default-version-tv': 'standard',
    });
  });

  it('rejects unknown names and malformed values without saving', async () => {
    const demo = await loginAs('demo@seerr.dev');
    const id = await idOf('demo@seerr.dev');
    const url = `/api/v1/user/${id}/settings/versions`;

    for (const preferences of [
      { theme: 'dark' },
      { 'default-version-movie': 'radarr:x' },
      { 'option-movie-radarr:2': 'Not An Id' },
      { 'default-version-movie': 'radarr:2', 'option-movie-lidarr:1': 'a' },
    ]) {
      const res = await demo.post(url).send({ preferences });
      assert.strictEqual(res.status, 400, JSON.stringify(preferences));
    }
    const res = await demo.get(url);
    assert.deepStrictEqual(res.body.preferences, {});
  });

  it('keeps other users out', async () => {
    const demo = await loginAs('demo@seerr.dev');
    const adminId = await idOf('admin@seerr.dev');

    const read = await demo.get(`/api/v1/user/${adminId}/settings/versions`);
    const write = await demo
      .post(`/api/v1/user/${adminId}/settings/versions`)
      .send({ preferences: { 'default-version-movie': 'standard' } });

    assert.strictEqual(read.status, 403);
    assert.strictEqual(write.status, 403);
  });

  it('lets an admin read another user', async () => {
    const demo = await loginAs('demo@seerr.dev');
    const demoId = await idOf('demo@seerr.dev');
    await demo
      .post(`/api/v1/user/${demoId}/settings/versions`)
      .send({ preferences: { 'default-version-movie': 'standard' } });

    const admin = await loginAs('admin@seerr.dev');
    const res = await admin.get(`/api/v1/user/${demoId}/settings/versions`);

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.preferences, {
      'default-version-movie': 'standard',
    });
  });
});
