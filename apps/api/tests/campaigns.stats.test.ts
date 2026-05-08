/**
 * Integration tests: campaign stats math.
 *
 * Per business-rules.md "stats computation":
 *   - total      = COUNT(*)
 *   - sent       = COUNT WHERE status='sent'
 *   - failed     = COUNT WHERE status='failed'
 *   - opened     = COUNT WHERE opened_at IS NOT NULL
 *   - send_rate  = sent / total      (0 when total=0)
 *   - open_rate  = opened / sent     (0 when sent=0)  ** denominator is sent **
 *
 * Coverage:
 *   - Empty campaign (no CR rows)               -> all zeros, no NaN.
 *   - 5 CRs (3 sent, 1 failed, 1 pending; 2 of -> total=5, sent=3, failed=1,
 *     the 3 sent rows have opened_at)              opened=2, send_rate=0.6,
 *                                                  open_rate=2/3.
 *
 * Stats are produced by a single raw-SQL aggregate (`STATS_SQL` in
 * src/campaigns/stats.ts). We assert through the public endpoint
 * `GET /campaigns/:id` so the test is end-to-end.
 *
 * Float precision: send_rate=0.6 may serialize as `0.6` or `0.6000000000001`
 * depending on the Postgres driver's number conversion. We use `toBeCloseTo`
 * with 4 decimals to avoid platform-dependent flakes.
 */
import request from 'supertest';

import { CampaignRecipient } from '../src/db/models/CampaignRecipient';

import { createUserA } from './helpers/auth';
import { buildTestApp, closeDb, truncate } from './helpers/server';

describe('campaigns stats', () => {
  beforeEach(async () => {
    await truncate();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('returns all-zero stats (no NaN) for a campaign with no recipients', async () => {
    const app = buildTestApp();
    const a = await createUserA(app);

    const created = await request(app)
      .post('/campaigns')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'Empty', subject: 'S', body: 'B' });
    expect(created.status).toBe(201);

    const res = await request(app)
      .get(`/campaigns/${created.body.id}`)
      .set('Authorization', `Bearer ${a.token}`);

    expect(res.status).toBe(200);
    expect(res.body.stats).toEqual({
      total: 0,
      sent: 0,
      failed: 0,
      opened: 0,
      send_rate: 0,
      open_rate: 0,
    });
  });

  it('aggregates counts correctly for mixed sent/failed/pending CR rows with opens', async () => {
    const app = buildTestApp();
    const a = await createUserA(app);

    // Create the campaign with 5 recipients, all initially pending.
    const created = await request(app)
      .post('/campaigns')
      .set('Authorization', `Bearer ${a.token}`)
      .send({
        name: 'StatsFixture',
        subject: 'S',
        body: 'B',
        recipient_emails: [
          'r1@example.com',
          'r2@example.com',
          'r3@example.com',
          'r4@example.com',
          'r5@example.com',
        ],
      });
    expect(created.status).toBe(201);
    const campaignId = created.body.id as string;

    // Pull the CR rows in a stable order so we can mutate exactly which ones
    // become sent / failed / opened. ORDER BY id ASC matches the service's
    // detail-route ordering.
    const crRows = await CampaignRecipient.findAll({
      where: { campaignId },
      order: [['id', 'ASC']],
    });
    expect(crRows).toHaveLength(5);

    // 3 sent, 1 failed, 1 pending. Two of the three sent rows are also opened.
    const now = new Date();
    await crRows[0]!.update({ status: 'sent', sentAt: now, openedAt: now });
    await crRows[1]!.update({ status: 'sent', sentAt: now, openedAt: now });
    await crRows[2]!.update({ status: 'sent', sentAt: now });
    await crRows[3]!.update({ status: 'failed', sentAt: now });
    // crRows[4] stays pending.

    const res = await request(app)
      .get(`/campaigns/${campaignId}`)
      .set('Authorization', `Bearer ${a.token}`);

    expect(res.status).toBe(200);
    const s = res.body.stats as {
      total: number;
      sent: number;
      failed: number;
      opened: number;
      send_rate: number;
      open_rate: number;
    };
    expect(s.total).toBe(5);
    expect(s.sent).toBe(3);
    expect(s.failed).toBe(1);
    expect(s.opened).toBe(2);
    // send_rate = 3/5 = 0.6.
    expect(s.send_rate).toBeCloseTo(0.6, 4);
    // open_rate = opened / sent = 2/3 — denominator is sent, NOT total.
    expect(s.open_rate).toBeCloseTo(2 / 3, 4);
  });

  it('open_rate is zero when sent=0 even if opened_at is non-null on pending rows (defensive guard)', async () => {
    const app = buildTestApp();
    const a = await createUserA(app);

    const created = await request(app)
      .post('/campaigns')
      .set('Authorization', `Bearer ${a.token}`)
      .send({
        name: 'NoSendsYet',
        subject: 'S',
        body: 'B',
        recipient_emails: ['only@example.com'],
      });
    expect(created.status).toBe(201);

    // Stamp opened_at without flipping status — exercises the zero-on-zero
    // guard for open_rate. This is an unusual real-world state but the math
    // must not blow up.
    const cr = await CampaignRecipient.findOne({ where: { campaignId: created.body.id } });
    expect(cr).not.toBeNull();
    await cr!.update({ openedAt: new Date() });

    const res = await request(app)
      .get(`/campaigns/${created.body.id}`)
      .set('Authorization', `Bearer ${a.token}`);

    expect(res.status).toBe(200);
    expect(res.body.stats.sent).toBe(0);
    expect(res.body.stats.opened).toBe(1);
    // sent=0 → open_rate is 0, not Infinity / NaN.
    expect(res.body.stats.open_rate).toBe(0);
    expect(res.body.stats.send_rate).toBe(0);
  });
});
