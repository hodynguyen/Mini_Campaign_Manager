/**
 * Integration tests: campaigns tenancy (404, NOT 403).
 *
 * Per business-rules.md "Tenancy by created_by": accessing another user's
 * campaign returns 404 — don't leak existence. Same code (CAMPAIGN_NOT_FOUND)
 * as a genuine miss so a foreign-user probe is indistinguishable from a
 * non-existent id.
 *
 * Coverage:
 *   - GET    /campaigns/:id  by foreign user -> 404
 *   - PATCH  /campaigns/:id  by foreign user -> 404 (and DB row unchanged)
 *   - DELETE /campaigns/:id  by foreign user -> 404 (and DB row still exists)
 *   - GET    /campaigns      list scoped to caller (User A sees A's only)
 *   - 401 paths              when no Authorization header
 */
import request from 'supertest';

import { Campaign } from '../src/db/models/Campaign';

import { createUserA, createUserB } from './helpers/auth';
import { buildTestApp, closeDb, truncate } from './helpers/server';

describe('campaigns tenancy', () => {
  beforeEach(async () => {
    await truncate();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('foreign-user access returns 404 (not 403, not 200)', () => {
    it("GET /campaigns/:id on another user's campaign returns 404 CAMPAIGN_NOT_FOUND", async () => {
      const app = buildTestApp();
      const a = await createUserA(app);
      const b = await createUserB(app);

      const aCampaign = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'A-only', subject: 'S', body: 'B' });
      expect(aCampaign.status).toBe(201);

      const res = await request(app)
        .get(`/campaigns/${aCampaign.body.id}`)
        .set('Authorization', `Bearer ${b.token}`);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: { code: 'CAMPAIGN_NOT_FOUND', message: 'Campaign not found' },
      });
    });

    it("PATCH /campaigns/:id on another user's campaign returns 404 and does NOT mutate the row", async () => {
      const app = buildTestApp();
      const a = await createUserA(app);
      const b = await createUserB(app);

      const aCampaign = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'Original A name', subject: 'S', body: 'B' });
      expect(aCampaign.status).toBe(201);

      const res = await request(app)
        .patch(`/campaigns/${aCampaign.body.id}`)
        .set('Authorization', `Bearer ${b.token}`)
        .send({ name: 'B is hijacking this' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CAMPAIGN_NOT_FOUND');

      // DB row must be untouched.
      const fresh = await Campaign.findByPk(aCampaign.body.id);
      expect(fresh).not.toBeNull();
      expect(fresh?.name).toBe('Original A name');
    });

    it("DELETE /campaigns/:id on another user's campaign returns 404 and does NOT delete the row", async () => {
      const app = buildTestApp();
      const a = await createUserA(app);
      const b = await createUserB(app);

      const aCampaign = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'KeepMe', subject: 'S', body: 'B' });
      expect(aCampaign.status).toBe(201);

      const res = await request(app)
        .delete(`/campaigns/${aCampaign.body.id}`)
        .set('Authorization', `Bearer ${b.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CAMPAIGN_NOT_FOUND');

      // DB row still exists.
      const stillThere = await Campaign.findByPk(aCampaign.body.id);
      expect(stillThere).not.toBeNull();
    });
  });

  describe('GET /campaigns scopes the list to the caller', () => {
    it("returns only the caller's campaigns — User A sees A's, User B sees B's, never each other's", async () => {
      const app = buildTestApp();
      const a = await createUserA(app);
      const b = await createUserB(app);

      // A creates 2.
      for (const n of ['A1', 'A2']) {
        const r = await request(app)
          .post('/campaigns')
          .set('Authorization', `Bearer ${a.token}`)
          .send({ name: n, subject: 'S', body: 'B' });
        expect(r.status).toBe(201);
      }
      // B creates 1.
      const bCreate = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${b.token}`)
        .send({ name: 'B1', subject: 'S', body: 'B' });
      expect(bCreate.status).toBe(201);

      // A's listing.
      const aList = await request(app).get('/campaigns').set('Authorization', `Bearer ${a.token}`);
      expect(aList.status).toBe(200);
      expect(aList.body.meta.total).toBe(2);
      expect(aList.body.data.map((c: { name: string }) => c.name).sort()).toEqual(['A1', 'A2']);
      // Critically: B's campaign must not show up in A's list.
      expect(aList.body.data.find((c: { name: string }) => c.name === 'B1')).toBeUndefined();

      // B's listing.
      const bList = await request(app).get('/campaigns').set('Authorization', `Bearer ${b.token}`);
      expect(bList.status).toBe(200);
      expect(bList.body.meta.total).toBe(1);
      expect(bList.body.data.map((c: { name: string }) => c.name)).toEqual(['B1']);
    });
  });

  describe('unauthenticated requests are rejected before tenancy logic runs', () => {
    it.each([
      ['GET', '/campaigns'],
      ['POST', '/campaigns'],
      ['GET', '/campaigns/00000000-0000-4000-8000-000000000001'],
      ['PATCH', '/campaigns/00000000-0000-4000-8000-000000000001'],
      ['DELETE', '/campaigns/00000000-0000-4000-8000-000000000001'],
    ] as const)('returns 401 UNAUTHORIZED on %s %s without Authorization header', async (method, path) => {
      const app = buildTestApp();
      // Cast through unknown — supertest types method calls per verb; a tiny
      // dynamic dispatch is the cleanest way to share the assertion.
      const agent = request(app);
      const send = method === 'GET'
        ? agent.get(path)
        : method === 'POST'
          ? agent.post(path).send({})
          : method === 'PATCH'
            ? agent.patch(path).send({})
            : agent.delete(path);

      const res = await send;
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });
});
