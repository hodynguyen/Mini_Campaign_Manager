/**
 * Integration tests: POST /campaigns/:id/schedule (F4).
 *
 * Per spec-schedule-send.md DoD §1-3 + business-rules.md "scheduled_at must
 * be in the future" + "Tenancy by created_by":
 *   - 200 on draft + future-time, body has status='scheduled' + echoed
 *     scheduled_at, DB row reflects the transition.
 *   - 400 SCHEDULED_AT_IN_PAST on past time. DB row unchanged.
 *   - 409 CAMPAIGN_NOT_SCHEDULABLE on non-draft status. DB row unchanged.
 *   - 404 CAMPAIGN_NOT_FOUND on tenancy miss (User B schedules User A's
 *     campaign). DB row unchanged.
 *   - 400 VALIDATION_ERROR on a non-ISO `scheduled_at`.
 *   - 400 VALIDATION_ERROR on extra keys in the body (zod `.strict()`).
 *
 * The state-machine guard is a SQL-level invariant via ATOMIC_SCHEDULE_SQL
 * (`WHERE status='draft'`). We exercise the error path here; the SQL itself
 * closes the F3 carry-forward race window — no concurrency stress test needed.
 *
 * The follow-up SELECT in the service distinguishes 404 vs 409 without
 * leaking foreign-row existence (a foreign-user request returns 404, a
 * wrong-state same-user request returns 409).
 */
import request from 'supertest';

import { Campaign } from '../src/db/models/Campaign';

import { createUserA, createUserB } from './helpers/auth';
import { buildTestApp, closeDb, truncate } from './helpers/server';

describe('POST /campaigns/:id/schedule', () => {
  beforeEach(async () => {
    await truncate();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('happy path', () => {
    it('returns 200 with status=scheduled + echoed scheduled_at, and the DB row reflects the transition', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const created = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'ToSchedule', subject: 'S', body: 'B' });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      // 1 hour in the future — comfortably > now, well within Postgres
      // timestamptz precision. ISO 8601 UTC ("Z" offset) is what zod accepts.
      const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      const res = await request(app)
        .post(`/campaigns/${id}/schedule`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ scheduled_at: scheduledAt });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id,
        name: 'ToSchedule',
        status: 'scheduled',
        scheduled_at: scheduledAt,
        created_by: a.userId,
      });

      // DB row: status flipped, scheduled_at column matches the input ms.
      const fresh = await Campaign.findByPk(id);
      expect(fresh?.status).toBe('scheduled');
      expect(fresh?.scheduledAt?.toISOString()).toBe(scheduledAt);
    });
  });

  describe('past-time guard', () => {
    it('returns 400 SCHEDULED_AT_IN_PAST when scheduled_at is in the past, and DOES NOT mutate the row', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const created = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'PastTime', subject: 'S', body: 'B' });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      // 1 hour in the past — comfortably <= now even accounting for clock skew.
      const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const res = await request(app)
        .post(`/campaigns/${id}/schedule`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ scheduled_at: past });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SCHEDULED_AT_IN_PAST');

      // Row must still be a draft with no scheduled_at.
      const fresh = await Campaign.findByPk(id);
      expect(fresh?.status).toBe('draft');
      expect(fresh?.scheduledAt).toBeNull();
    });
  });

  describe('wrong-state guard (409 CAMPAIGN_NOT_SCHEDULABLE)', () => {
    it('returns 409 when the campaign is in a non-draft state, and DOES NOT mutate the row', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const created = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'AlreadySent', subject: 'S', body: 'B' });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      // Force-flip to 'sent' via direct DB update (no public endpoint).
      // The atomic UPDATE in the service has `WHERE status='draft'` — so a
      // 'sent' row will be rejected at the SQL level (affectedRows=0), and
      // the follow-up SELECT will distinguish this as 409, not 404.
      await Campaign.update({ status: 'sent' }, { where: { id } });

      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const res = await request(app)
        .post(`/campaigns/${id}/schedule`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ scheduled_at: future });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CAMPAIGN_NOT_SCHEDULABLE');

      // Row must still be 'sent' with no scheduled_at side effect.
      const fresh = await Campaign.findByPk(id);
      expect(fresh?.status).toBe('sent');
      expect(fresh?.scheduledAt).toBeNull();
    });
  });

  describe('tenancy guard (404 CAMPAIGN_NOT_FOUND)', () => {
    it("returns 404 when User B schedules User A's campaign, and DOES NOT mutate the row", async () => {
      const app = buildTestApp();
      const a = await createUserA(app);
      const b = await createUserB(app);

      const aCampaign = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'A-only', subject: 'S', body: 'B' });
      expect(aCampaign.status).toBe(201);
      const id = aCampaign.body.id as string;

      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const res = await request(app)
        .post(`/campaigns/${id}/schedule`)
        .set('Authorization', `Bearer ${b.token}`)
        .send({ scheduled_at: future });

      // 404 (NOT 403) — per business-rules.md, don't leak foreign-row existence.
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CAMPAIGN_NOT_FOUND');

      // Row still belongs to User A as a draft.
      const fresh = await Campaign.findByPk(id);
      expect(fresh?.status).toBe('draft');
      expect(fresh?.scheduledAt).toBeNull();
      expect(fresh?.createdBy).toBe(a.userId);
    });
  });

  describe('validation guards', () => {
    it('returns 400 VALIDATION_ERROR when scheduled_at is not a valid ISO datetime', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const created = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'BadISO', subject: 'S', body: 'B' });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const res = await request(app)
        .post(`/campaigns/${id}/schedule`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ scheduled_at: 'not-a-date' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      // Row remains a draft.
      const fresh = await Campaign.findByPk(id);
      expect(fresh?.status).toBe('draft');
    });

    it('returns 400 VALIDATION_ERROR when the body has unknown keys (.strict())', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const created = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'StrictBody', subject: 'S', body: 'B' });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      const res = await request(app)
        .post(`/campaigns/${id}/schedule`)
        .set('Authorization', `Bearer ${a.token}`)
        // Extra key `extra` — `.strict()` must reject it before the service
        // is called (the load-bearing guard is on the schema, mirroring the
        // PATCH `.strict()` security guard from F3).
        .send({ scheduled_at: future, extra: 'x' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      // Row remains a draft.
      const fresh = await Campaign.findByPk(id);
      expect(fresh?.status).toBe('draft');
      expect(fresh?.scheduledAt).toBeNull();
    });
  });
});
