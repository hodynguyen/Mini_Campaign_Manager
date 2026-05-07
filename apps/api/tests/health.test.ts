/**
 * Smoke test: GET /health returns { ok: true, db: 'up' } when the DB is
 * reachable.
 *
 * F2 extended the health route to ping the database (spec-auth.md §8).
 * Imports `buildTestApp()` (which wraps `createApp()`) so we never bind a
 * real port. The shared Sequelize singleton is opened by the helper module's
 * side-effect import; jest's `globalSetup` already migrated the schema.
 */
import request from 'supertest';

import { buildTestApp, closeDb } from './helpers/server';

describe('GET /health', () => {
  afterAll(async () => {
    await closeDb();
  });

  it('returns 200 with { ok: true, db: "up" } when the DB is reachable', async () => {
    const app = buildTestApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: 'up' });
  });
});
