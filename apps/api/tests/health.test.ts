/**
 * Smoke test: GET /health returns { ok: true }.
 *
 * Imports createApp() (NOT index.ts) so we never bind a real port.
 * This is the only test in F1 — F2 will add auth + domain coverage.
 */
import request from 'supertest';

import { createApp } from '../src/app';

describe('GET /health', () => {
  it('returns 200 with { ok: true }', async () => {
    const app = createApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
