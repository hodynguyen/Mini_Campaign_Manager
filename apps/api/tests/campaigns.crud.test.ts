/**
 * Integration tests: campaigns CRUD happy paths.
 *
 * Coverage:
 *   1. POST /campaigns (no recipients)         -> 201 + Campaign DTO shape.
 *   2. POST /campaigns (mixed-case duplicates) -> 201 + dedup to one Recipient
 *      row + one CampaignRecipient per unique email (CITEXT + JS-side dedupe).
 *   3. GET /campaigns                          -> paginated, sorted by
 *      updated_at DESC, meta has correct shape.
 *   4. GET /campaigns/:id                      -> 200 with stats + recipients.
 *   5. POST /campaigns (validation failures)   -> 400 VALIDATION_ERROR.
 *
 * Tenancy + state-machine + stats math live in their own files.
 */
import request from 'supertest';

import { Campaign } from '../src/db/models/Campaign';
import { CampaignRecipient } from '../src/db/models/CampaignRecipient';
import { Recipient } from '../src/db/models/Recipient';

import { createUserA } from './helpers/auth';
import { buildTestApp, closeDb, truncate } from './helpers/server';

describe('campaigns CRUD', () => {
  beforeEach(async () => {
    await truncate();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('POST /campaigns', () => {
    it('returns 201 + a Campaign DTO with status=draft and scheduled_at=null when no recipients are supplied', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const res = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({
          name: 'Spring Promo',
          subject: 'Save 20% this spring',
          body: 'Plain-text body content for the promo email.',
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        name: 'Spring Promo',
        subject: 'Save 20% this spring',
        body: 'Plain-text body content for the promo email.',
        status: 'draft',
        scheduled_at: null,
        created_by: a.userId,
        created_at: expect.any(String),
        updated_at: expect.any(String),
      });
      // ISO-8601 timestamp shape (matches `toISOString()` from the service).
      expect(new Date(res.body.created_at).toString()).not.toBe('Invalid Date');
      expect(new Date(res.body.updated_at).toString()).not.toBe('Invalid Date');

      // DB-level: exactly one campaign row, no CR rows yet.
      const campaignCount = await Campaign.count();
      expect(campaignCount).toBe(1);
      const crCount = await CampaignRecipient.count();
      expect(crCount).toBe(0);
    });

    it('dedupes recipient_emails by case (CITEXT) and creates one Recipient + one CampaignRecipient per unique email', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const res = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({
          name: 'Welcome blast',
          subject: 'Welcome!',
          body: 'Greetings.',
          // Three entries that should collapse to TWO unique recipients
          // (alice@x.com and bob@x.com — case ignored).
          recipient_emails: ['Alice@x.com', 'bob@x.com', 'alice@X.com'],
        });

      expect(res.status).toBe(201);
      const campaignId = res.body.id as string;

      // Two distinct Recipient rows in the DB.
      const recipientCount = await Recipient.count();
      expect(recipientCount).toBe(2);

      const recipients = await Recipient.findAll({ order: [['email', 'ASC']] });
      // Emails were lowercased by the service before findOrCreate.
      expect(recipients.map((r) => r.email)).toEqual(['alice@x.com', 'bob@x.com']);

      // Two CampaignRecipient rows, both pending, both pointing at our campaign.
      const crRows = await CampaignRecipient.findAll({ where: { campaignId } });
      expect(crRows).toHaveLength(2);
      expect(crRows.every((cr) => cr.status === 'pending')).toBe(true);
      expect(crRows.every((cr) => cr.campaignId === campaignId)).toBe(true);
    });

    it('returns 400 VALIDATION_ERROR for malformed payloads', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      // describe.each-style: same auth + assertion shape for several inputs.
      const cases: Array<[string, Record<string, unknown>]> = [
        ['empty name', { name: '', subject: 'S', body: 'B' }],
        ['missing subject', { name: 'N', body: 'B' }],
        ['name longer than 120 chars', { name: 'x'.repeat(121), subject: 'S', body: 'B' }],
        ['body empty', { name: 'N', subject: 'S', body: '' }],
        [
          'recipient_emails contains a non-email',
          {
            name: 'N',
            subject: 'S',
            body: 'B',
            recipient_emails: ['not-an-email', 'ok@example.com'],
          },
        ],
        ['unknown key (status injected)', { name: 'N', subject: 'S', body: 'B', status: 'sent' }],
      ];

      for (const [, payload] of cases) {
        const res = await request(app)
          .post('/campaigns')
          .set('Authorization', `Bearer ${a.token}`)
          .send(payload);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(Array.isArray(res.body.error.details)).toBe(true);
        expect(res.body.error.details.length).toBeGreaterThan(0);
      }

      // Nothing should have persisted on any of those failures.
      const campaignCount = await Campaign.count();
      expect(campaignCount).toBe(0);
    });
  });

  describe('GET /campaigns', () => {
    it('returns a paginated list sorted by updated_at DESC with the correct meta shape', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      // Create 3 campaigns. The newest insert ends up first under
      // ORDER BY updated_at DESC — Sequelize default value is now() for both
      // created_at and updated_at, monotonic by insert order at >=1ms apart.
      // We add a tiny delay between requests so the timestamps differ
      // reliably even on fast machines.
      const names: string[] = [];
      for (const n of ['Alpha', 'Bravo', 'Charlie']) {
        const r = await request(app)
          .post('/campaigns')
          .set('Authorization', `Bearer ${a.token}`)
          .send({ name: n, subject: 'S', body: 'B' });
        expect(r.status).toBe(201);
        names.push(n);
        // 5ms is enough; Postgres timestamptz has microsecond precision.
        await new Promise((ok) => setTimeout(ok, 5));
      }

      const res = await request(app)
        .get('/campaigns')
        .set('Authorization', `Bearer ${a.token}`);

      expect(res.status).toBe(200);
      expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 3 });
      expect(res.body.data).toHaveLength(3);
      // Newest first: insertion order REVERSED.
      expect(res.body.data.map((c: { name: string }) => c.name)).toEqual([
        'Charlie',
        'Bravo',
        'Alpha',
      ]);
      // Spot-check shape on the first entry.
      expect(res.body.data[0]).toMatchObject({
        id: expect.any(String),
        name: 'Charlie',
        status: 'draft',
        scheduled_at: null,
        created_by: a.userId,
      });
    });
  });

  describe('GET /campaigns/:id', () => {
    it('returns the campaign + zero-stats + empty recipients for a fresh draft with no attached recipients', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const created = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'Solo', subject: 'S', body: 'B' });
      expect(created.status).toBe(201);

      const res = await request(app)
        .get(`/campaigns/${created.body.id}`)
        .set('Authorization', `Bearer ${a.token}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: created.body.id,
        name: 'Solo',
        subject: 'S',
        body: 'B',
        status: 'draft',
        scheduled_at: null,
        created_by: a.userId,
      });
      // Stats: zero counts + zero rates (NOT NaN — zero-on-zero guard).
      expect(res.body.stats).toEqual({
        total: 0,
        sent: 0,
        failed: 0,
        opened: 0,
        send_rate: 0,
        open_rate: 0,
      });
      expect(res.body.recipients).toEqual([]);
    });

    it('returns the campaign + recipients list (with pending statuses) when recipients were attached at create-time', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const created = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({
          name: 'WithRecipients',
          subject: 'S',
          body: 'B',
          recipient_emails: ['foo@example.com', 'bar@example.com'],
        });
      expect(created.status).toBe(201);

      const res = await request(app)
        .get(`/campaigns/${created.body.id}`)
        .set('Authorization', `Bearer ${a.token}`);

      expect(res.status).toBe(200);
      expect(res.body.recipients).toHaveLength(2);
      // All freshly attached recipients are pending; sent_at/opened_at null.
      for (const r of res.body.recipients) {
        expect(r).toMatchObject({
          recipient_id: expect.any(String),
          email: expect.any(String),
          name: expect.any(String),
          status: 'pending',
          sent_at: null,
          opened_at: null,
        });
      }
      // Stats with no sends: total=2 from the seed, sent=0, both rates 0.
      expect(res.body.stats).toMatchObject({ total: 2, sent: 0, failed: 0, opened: 0 });
    });
  });
});
