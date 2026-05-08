/**
 * Integration tests: POST /campaigns/:id/send (F4).
 *
 * Per spec-schedule-send.md DoD §4-5 + business-rules.md "Random outcome per
 * recipient" + "Sending is one-way":
 *   - 202 Accepted with `{ id, status: 'sending' }` immediately on success.
 *   - The worker runs asynchronously and eventually flips status → 'sent',
 *     bucketing each pending CR row into 'sent' or 'failed' per
 *     SEND_SUCCESS_RATE.
 *   - 409 CAMPAIGN_NOT_SENDABLE on non-{draft,scheduled} status.
 *   - 404 CAMPAIGN_NOT_FOUND on tenancy miss.
 *
 * Sequencing strategy:
 *   The controller fires the worker via `setImmediate(() => runSendWorker(id))`
 *   AFTER `res.status(202).json(...)` is committed — the response promise
 *   resolves before the worker has run any DB work.
 *
 *   For deterministic assertions on the eventual state, tests directly
 *   `await runSendWorkerForTests(id)` after the 202. The double-execution
 *   (setImmediate + explicit await) is safe and idempotent:
 *     - the pending-CR query returns 0 rows on the second pass,
 *     - the atomic `sending → sent` UPDATE is a no-op once status='sent'.
 *   See worker.ts JSDoc for full reasoning.
 *
 *   We do NOT poll `GET /:id` with a timeout (flaky under CI load). Awaiting
 *   the test variant directly is the deterministic pattern.
 */
import request from 'supertest';

import { Campaign } from '../src/db/models/Campaign';
import { CampaignRecipient } from '../src/db/models/CampaignRecipient';
import { runSendWorkerForTests } from '../src/campaigns/worker';

import { createUserA, createUserB } from './helpers/auth';
import { buildTestApp, closeDb, truncate } from './helpers/server';

describe('POST /campaigns/:id/send', () => {
  beforeEach(async () => {
    await truncate();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('happy path with worker assertion', () => {
    it('returns 202 immediately, then the worker eventually marks the campaign sent + processes all CR rows', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const created = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({
          name: 'SendBlast',
          subject: 'S',
          body: 'B',
          // 5 recipients — enough to exercise the bulk-update path; small
          // enough to assert the entire CR list ends in a terminal state.
          recipient_emails: [
            's1@example.com',
            's2@example.com',
            's3@example.com',
            's4@example.com',
            's5@example.com',
          ],
        });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const sendRes = await request(app)
        .post(`/campaigns/${id}/send`)
        .set('Authorization', `Bearer ${a.token}`);

      // 202 (NOT 200) per spec — async accept.
      expect(sendRes.status).toBe(202);
      expect(sendRes.body).toEqual({ id, status: 'sending' });

      // Drain the worker for deterministic state. Idempotent w.r.t. the
      // setImmediate-fired production worker: the pending-CR query returns 0
      // on the second pass and the atomic flip is a no-op once status='sent'.
      await runSendWorkerForTests(id);

      // Detail: campaign status='sent', all CR rows in a terminal state.
      const detail = await request(app)
        .get(`/campaigns/${id}`)
        .set('Authorization', `Bearer ${a.token}`);
      expect(detail.status).toBe(200);
      expect(detail.body.status).toBe('sent');

      // DB-level: every CR is sent or failed (no pendings remain).
      const crRows = await CampaignRecipient.findAll({ where: { campaignId: id } });
      expect(crRows).toHaveLength(5);
      for (const cr of crRows) {
        expect(['sent', 'failed']).toContain(cr.status);
        // sent_at is stamped on BOTH outcomes per business-rules.md
        // ("attempted at" semantics, not "successfully delivered at").
        expect(cr.sentAt).not.toBeNull();
      }

      // Stats reflect the terminal CR distribution.
      const sentCount = crRows.filter((cr) => cr.status === 'sent').length;
      const failedCount = crRows.filter((cr) => cr.status === 'failed').length;
      expect(sentCount + failedCount).toBe(5);
      expect(detail.body.stats.total).toBe(5);
      expect(detail.body.stats.sent).toBe(sentCount);
      expect(detail.body.stats.failed).toBe(failedCount);
    });
  });

  describe('worker random distribution', () => {
    it('produces a non-trivial mix of sent + failed across 100 recipients at the default 0.8 rate', async () => {
      // With 100 recipients and SEND_SUCCESS_RATE=0.8 (default), the
      // probability of all-sent is 0.8^100 ≈ 2e-10 — well below any flake
      // threshold. The probability of all-failed is 0.2^100 ≈ 1e-70.
      // Loose bounds (>0 each) are deterministic for practical purposes.
      const app = buildTestApp();
      const a = await createUserA(app);

      const emails = Array.from({ length: 100 }, (_, i) => `bulk${i}@example.com`);
      const created = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({
          name: 'BulkBlast',
          subject: 'S',
          body: 'B',
          recipient_emails: emails,
        });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const sendRes = await request(app)
        .post(`/campaigns/${id}/send`)
        .set('Authorization', `Bearer ${a.token}`);
      expect(sendRes.status).toBe(202);

      await runSendWorkerForTests(id);

      const crRows = await CampaignRecipient.findAll({ where: { campaignId: id } });
      const sentCount = crRows.filter((cr) => cr.status === 'sent').length;
      const failedCount = crRows.filter((cr) => cr.status === 'failed').length;

      // Both buckets non-empty with overwhelming probability.
      expect(sentCount).toBeGreaterThan(0);
      expect(failedCount).toBeGreaterThan(0);
      expect(sentCount + failedCount).toBe(100);

      // Campaign reaches 'sent' regardless of distribution.
      const fresh = await Campaign.findByPk(id);
      expect(fresh?.status).toBe('sent');
    });
  });

  describe('immediate 202 response', () => {
    it('returns exactly 202 (not 200) with the SendCampaignResponse body shape', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const created = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'AsyncShape', subject: 'S', body: 'B' });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const res = await request(app)
        .post(`/campaigns/${id}/send`)
        .set('Authorization', `Bearer ${a.token}`);

      // 202 Accepted, NOT 200 OK. The body mirrors `SendCampaignResponse`
      // from `@app/shared`: `{ id, status: 'sending' }` only — no extra fields.
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ id, status: 'sending' });

      // Drain the worker so the test doesn't leave a setImmediate dangling
      // into the next test's connection pool.
      await runSendWorkerForTests(id);
    });
  });

  describe('wrong-state guard (409 CAMPAIGN_NOT_SENDABLE)', () => {
    it('returns 409 when the campaign is already sent, and DOES NOT re-send', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const created = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'Already', subject: 'S', body: 'B' });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      // Force-flip to 'sent' (no public endpoint). Per business-rules.md
      // "Sending is one-way", any subsequent send must 409.
      await Campaign.update({ status: 'sent' }, { where: { id } });

      const res = await request(app)
        .post(`/campaigns/${id}/send`)
        .set('Authorization', `Bearer ${a.token}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CAMPAIGN_NOT_SENDABLE');

      // Row still 'sent' (atomic UPDATE rejected at SQL level).
      const fresh = await Campaign.findByPk(id);
      expect(fresh?.status).toBe('sent');
    });
  });

  describe('tenancy guard (404 CAMPAIGN_NOT_FOUND)', () => {
    it("returns 404 when User B sends User A's campaign, and DOES NOT mutate it", async () => {
      const app = buildTestApp();
      const a = await createUserA(app);
      const b = await createUserB(app);

      const aCampaign = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'A-only-send', subject: 'S', body: 'B' });
      expect(aCampaign.status).toBe(201);
      const id = aCampaign.body.id as string;

      const res = await request(app)
        .post(`/campaigns/${id}/send`)
        .set('Authorization', `Bearer ${b.token}`);

      // 404 (NOT 403) — tenancy miss is indistinguishable from a real miss.
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CAMPAIGN_NOT_FOUND');

      // Row still draft, still owned by A.
      const fresh = await Campaign.findByPk(id);
      expect(fresh?.status).toBe('draft');
      expect(fresh?.createdBy).toBe(a.userId);
    });
  });

  describe('empty-recipients send', () => {
    it("flips status to 'sent' immediately when a campaign has no recipients (worker no-ops on the bulk updates but still flips the campaign)", async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      // No recipient_emails — the worker's `findAll({ status: 'pending' })`
      // returns an empty list, both bulk-update branches skip, and the
      // atomic `sending → sent` flip still runs. End state: status='sent',
      // stats all zero.
      const created = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'NoRecipients', subject: 'S', body: 'B' });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const sendRes = await request(app)
        .post(`/campaigns/${id}/send`)
        .set('Authorization', `Bearer ${a.token}`);
      expect(sendRes.status).toBe(202);

      await runSendWorkerForTests(id);

      const detail = await request(app)
        .get(`/campaigns/${id}`)
        .set('Authorization', `Bearer ${a.token}`);
      expect(detail.status).toBe(200);
      expect(detail.body.status).toBe('sent');
      expect(detail.body.stats).toEqual({
        total: 0,
        sent: 0,
        failed: 0,
        opened: 0,
        send_rate: 0,
        open_rate: 0,
      });
      expect(detail.body.recipients).toEqual([]);
    });
  });
});
