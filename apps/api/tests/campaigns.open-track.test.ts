/**
 * Integration tests: POST /campaigns/:id/recipients/:recipientId/open (F4).
 *
 * Per spec-schedule-send.md DoD §6 + service.trackOpen JSDoc:
 *   - 204 always on the success path (silent no-op on idempotent /
 *     non-sent / foreign-tenancy).
 *   - Stamps `opened_at` ONLY when the row is currently 'sent' AND
 *     opened_at IS NULL.
 *   - Repeated calls do not move opened_at forward.
 *   - Foreign-tenancy calls silently no-op (NO existence leak via 404).
 *   - 400 VALIDATION_ERROR on a non-UUID path param (zod
 *     openTrackParamsSchema rejects before Postgres can throw an
 *     invalid_text_representation error).
 *
 * The endpoint cannot be probed from the response (it always 204s on the
 * success path); we assert via direct DB queries on the CR row's `openedAt`.
 */
import request from 'supertest';

import { Campaign } from '../src/db/models/Campaign';
import { CampaignRecipient } from '../src/db/models/CampaignRecipient';
import { runSendWorkerForTests } from '../src/campaigns/worker';

import { createUserA, createUserB } from './helpers/auth';
import { buildTestApp, closeDb, truncate } from './helpers/server';

/**
 * Helper: set up a campaign with a known mix of CR statuses so each test
 * can pick the row it wants to open-track.
 *
 * Returns the campaign id + the CR rows ordered by id ASC. Each test
 * directly mutates a CR row's status/sentAt to the desired pre-state
 * (NOT via the send worker — keeps the test deterministic without depending
 * on Math.random's distribution).
 */
async function seedCampaignWithRecipients(
  app: ReturnType<typeof buildTestApp>,
  token: string,
  emails: string[],
): Promise<{ campaignId: string; crRows: CampaignRecipient[] }> {
  const created = await request(app)
    .post('/campaigns')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'OpenTrackFixture', subject: 'S', body: 'B', recipient_emails: emails });
  if (created.status !== 201) {
    throw new Error(`seed failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const campaignId = created.body.id as string;
  const crRows = await CampaignRecipient.findAll({
    where: { campaignId },
    order: [['id', 'ASC']],
  });
  return { campaignId, crRows };
}

describe('POST /campaigns/:id/recipients/:recipientId/open', () => {
  beforeEach(async () => {
    await truncate();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('happy path', () => {
    it("returns 204 and stamps opened_at on a 'sent' recipient", async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const { campaignId, crRows } = await seedCampaignWithRecipients(app, a.token, [
        'open1@example.com',
      ]);
      const cr = crRows[0]!;

      // Pre-state: force the row to 'sent' so the trackOpen SQL's
      // `cr.status='sent'` guard matches. (Direct DB write, not via worker —
      // determinism > realism for this assertion.)
      const sentAt = new Date();
      await cr.update({ status: 'sent', sentAt });

      // Pre-assertion: opened_at currently null.
      const before = await CampaignRecipient.findByPk(cr.id);
      expect(before?.openedAt).toBeNull();

      const res = await request(app)
        .post(`/campaigns/${campaignId}/recipients/${cr.recipientId}/open`)
        .set('Authorization', `Bearer ${a.token}`);

      // 204 No Content (no body).
      expect(res.status).toBe(204);
      expect(res.body).toEqual({});

      // opened_at stamped.
      const after = await CampaignRecipient.findByPk(cr.id);
      expect(after?.openedAt).not.toBeNull();
      expect(after?.openedAt).toBeInstanceOf(Date);
    });
  });

  describe('idempotent — second call does not move opened_at forward', () => {
    it('returns 204 on both calls, opened_at unchanged on the second', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const { campaignId, crRows } = await seedCampaignWithRecipients(app, a.token, [
        'open2@example.com',
      ]);
      const cr = crRows[0]!;
      await cr.update({ status: 'sent', sentAt: new Date() });

      // First call: opened_at gets stamped.
      const first = await request(app)
        .post(`/campaigns/${campaignId}/recipients/${cr.recipientId}/open`)
        .set('Authorization', `Bearer ${a.token}`);
      expect(first.status).toBe(204);

      const afterFirst = await CampaignRecipient.findByPk(cr.id);
      const firstOpenedAt = afterFirst?.openedAt;
      expect(firstOpenedAt).toBeInstanceOf(Date);

      // Wait a few ms so a (hypothetical) re-stamp would have a measurable
      // delta. Postgres timestamptz has microsecond precision so even 5ms
      // would be observable.
      await new Promise((ok) => setTimeout(ok, 10));

      // Second call: still 204, but opened_at must NOT advance because the
      // SQL's `opened_at IS NULL` guard rejects an already-opened row.
      const second = await request(app)
        .post(`/campaigns/${campaignId}/recipients/${cr.recipientId}/open`)
        .set('Authorization', `Bearer ${a.token}`);
      expect(second.status).toBe(204);

      const afterSecond = await CampaignRecipient.findByPk(cr.id);
      // toISOString comparison — Date objects compare by reference otherwise.
      expect(afterSecond?.openedAt?.toISOString()).toBe(firstOpenedAt?.toISOString());
    });
  });

  describe('non-sent rows silently no-op (status must be sent)', () => {
    it("returns 204 and DOES NOT stamp opened_at for a 'pending' recipient", async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const { campaignId, crRows } = await seedCampaignWithRecipients(app, a.token, [
        'open3@example.com',
      ]);
      const cr = crRows[0]!;
      // Pre-state: pending (the seed default — left as-is).
      expect(cr.status).toBe('pending');

      const res = await request(app)
        .post(`/campaigns/${campaignId}/recipients/${cr.recipientId}/open`)
        .set('Authorization', `Bearer ${a.token}`);
      // The endpoint is silent — caller cannot probe whether the row exists
      // or whether its state matches. Always 204.
      expect(res.status).toBe(204);

      // opened_at must remain null because the row is not 'sent'.
      const after = await CampaignRecipient.findByPk(cr.id);
      expect(after?.openedAt).toBeNull();
      expect(after?.status).toBe('pending');
    });

    it("returns 204 and DOES NOT stamp opened_at for a 'failed' recipient", async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const { campaignId, crRows } = await seedCampaignWithRecipients(app, a.token, [
        'open4@example.com',
      ]);
      const cr = crRows[0]!;
      await cr.update({ status: 'failed', sentAt: new Date() });

      const res = await request(app)
        .post(`/campaigns/${campaignId}/recipients/${cr.recipientId}/open`)
        .set('Authorization', `Bearer ${a.token}`);
      expect(res.status).toBe(204);

      // opened_at remains null even though sent_at is set — opens only count
      // for successfully-sent rows per business-rules.md "open_rate" semantics.
      const after = await CampaignRecipient.findByPk(cr.id);
      expect(after?.openedAt).toBeNull();
      expect(after?.status).toBe('failed');
    });
  });

  describe('tenancy — silently no-op on a foreign-user call (NOT 404)', () => {
    it("returns 204 when User B opens User A's recipient, but the row state is unchanged", async () => {
      const app = buildTestApp();
      const a = await createUserA(app);
      const b = await createUserB(app);

      const { campaignId, crRows } = await seedCampaignWithRecipients(app, a.token, [
        'a-only@example.com',
      ]);
      const cr = crRows[0]!;
      await cr.update({ status: 'sent', sentAt: new Date() });
      // Pre-state: opened_at null.
      expect(cr.openedAt).toBeNull();

      // User B calls track-open on User A's campaign+recipient. The SQL's
      // `c.created_by = :userId` JOIN clause means affectedRows=0. The
      // endpoint is silent — caller cannot tell from the response whether
      // the row exists. Per the JSDoc on service.trackOpen, foreign-user
      // calls return 204 (NOT 404) to avoid leaking existence.
      const res = await request(app)
        .post(`/campaigns/${campaignId}/recipients/${cr.recipientId}/open`)
        .set('Authorization', `Bearer ${b.token}`);

      expect(res.status).toBe(204);

      // Critically: the row state must be unchanged (opened_at still null).
      const after = await CampaignRecipient.findByPk(cr.id);
      expect(after?.openedAt).toBeNull();
      expect(after?.status).toBe('sent');

      // Sanity: User A's own call still works (proves the row IS open-trackable;
      // B's call was rejected by the tenancy join, not because the row is
      // un-open-trackable in some other way).
      const aRes = await request(app)
        .post(`/campaigns/${campaignId}/recipients/${cr.recipientId}/open`)
        .set('Authorization', `Bearer ${a.token}`);
      expect(aRes.status).toBe(204);
      const afterA = await CampaignRecipient.findByPk(cr.id);
      expect(afterA?.openedAt).not.toBeNull();
    });
  });

  describe('validation — non-UUID path params return 400', () => {
    it('returns 400 VALIDATION_ERROR when :recipientId is not a UUID', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const { campaignId, crRows } = await seedCampaignWithRecipients(app, a.token, [
        'badparam@example.com',
      ]);
      const cr = crRows[0]!;
      await cr.update({ status: 'sent', sentAt: new Date() });

      // Non-UUID :recipientId — openTrackParamsSchema's z.string().uuid()
      // rejects with VALIDATION_ERROR before Postgres can throw an
      // invalid_text_representation error.
      const res = await request(app)
        .post(`/campaigns/${campaignId}/recipients/not-a-uuid/open`)
        .set('Authorization', `Bearer ${a.token}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      // Row state remains untouched.
      const after = await CampaignRecipient.findByPk(cr.id);
      expect(after?.openedAt).toBeNull();
    });
  });

  describe('integration — opens after a real send produce a non-zero open_rate', () => {
    it("opens a 'sent' recipient after the worker processes the campaign and stats reflect opened=1", async () => {
      // Sanity check that the open-track endpoint composes with the send
      // worker. Use a single recipient + force its CR to 'sent' BEFORE
      // calling the worker so the test is independent of Math.random's
      // outcome distribution.
      const app = buildTestApp();
      const a = await createUserA(app);

      const created = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({
          name: 'OpenAfterSend',
          subject: 'S',
          body: 'B',
          recipient_emails: ['e2e@example.com'],
        });
      expect(created.status).toBe(201);
      const id = created.body.id as string;

      const sendRes = await request(app)
        .post(`/campaigns/${id}/send`)
        .set('Authorization', `Bearer ${a.token}`);
      expect(sendRes.status).toBe(202);
      await runSendWorkerForTests(id);

      // Find a CR row that ended up 'sent'. With one recipient + default
      // 0.8 rate the failure probability is 0.2 — to keep the test
      // deterministic, force it to 'sent' if the worker happened to flip it
      // to 'failed'.
      const cr = await CampaignRecipient.findOne({ where: { campaignId: id } });
      expect(cr).not.toBeNull();
      if (cr!.status !== 'sent') {
        await cr!.update({ status: 'sent' });
      }

      const trackRes = await request(app)
        .post(`/campaigns/${id}/recipients/${cr!.recipientId}/open`)
        .set('Authorization', `Bearer ${a.token}`);
      expect(trackRes.status).toBe(204);

      // Stats: opened=1, sent>=1, open_rate>0.
      const detail = await request(app)
        .get(`/campaigns/${id}`)
        .set('Authorization', `Bearer ${a.token}`);
      expect(detail.status).toBe(200);
      const fresh = await Campaign.findByPk(id);
      expect(fresh?.status).toBe('sent');
      expect(detail.body.stats.opened).toBe(1);
      expect(detail.body.stats.sent).toBeGreaterThanOrEqual(1);
      expect(detail.body.stats.open_rate).toBeGreaterThan(0);
    });
  });
});
