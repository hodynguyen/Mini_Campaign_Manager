/**
 * Integration tests: campaigns state-machine guards.
 *
 * Per business-rules.md "Edit only in draft" + "Delete only in draft":
 *   - PATCH /campaigns/:id   -> 200 when status='draft', 409 CAMPAIGN_NOT_EDITABLE otherwise.
 *   - DELETE /campaigns/:id  -> 204 when status='draft', 409 otherwise.
 *
 * F3 has no public endpoint to transition status (those land in F4). To
 * exercise non-draft branches, we directly UPDATE the row via the model — the
 * service code path under test is independent of HOW the campaign reached
 * non-draft state.
 *
 * Also exercises the zod `.strict()` security guard on PATCH:
 *   - status / scheduled_at / created_by injection -> 400 VALIDATION_ERROR
 *     (NOT silently accepted by Sequelize, NOT 200).
 */
import request from 'supertest';

import { Campaign } from '../src/db/models/Campaign';

import { createUserA } from './helpers/auth';
import { buildTestApp, closeDb, truncate } from './helpers/server';

describe('campaigns state machine', () => {
  beforeEach(async () => {
    await truncate();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('PATCH happy path', () => {
    it('updates a draft campaign and returns 200 with the new fields', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const created = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'Old', subject: 'OldS', body: 'OldB' });
      expect(created.status).toBe(201);

      const res = await request(app)
        .patch(`/campaigns/${created.body.id}`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'New', subject: 'NewS' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: created.body.id,
        name: 'New',
        subject: 'NewS',
        body: 'OldB', // unchanged — only name + subject in the patch
        status: 'draft',
      });

      // DB confirms the partial write.
      const fresh = await Campaign.findByPk(created.body.id);
      expect(fresh?.name).toBe('New');
      expect(fresh?.subject).toBe('NewS');
      expect(fresh?.body).toBe('OldB');
    });
  });

  describe('PATCH on non-draft -> 409 CAMPAIGN_NOT_EDITABLE', () => {
    it.each([['scheduled'], ['sending'], ['sent']] as const)(
      'rejects PATCH when status=%s and leaves the row unchanged',
      async (status) => {
        const app = buildTestApp();
        const a = await createUserA(app);

        const created = await request(app)
          .post('/campaigns')
          .set('Authorization', `Bearer ${a.token}`)
          .send({ name: 'Original', subject: 'S', body: 'B' });
        expect(created.status).toBe(201);

        // Force the campaign into a non-draft state (no public endpoint in F3).
        await Campaign.update({ status }, { where: { id: created.body.id } });

        const res = await request(app)
          .patch(`/campaigns/${created.body.id}`)
          .set('Authorization', `Bearer ${a.token}`)
          .send({ name: 'Should-Not-Apply' });

        expect(res.status).toBe(409);
        expect(res.body).toEqual({
          error: {
            code: 'CAMPAIGN_NOT_EDITABLE',
            message: 'Campaign can only be edited in draft state',
          },
        });

        // DB row: name unchanged, status still the forced non-draft value.
        const fresh = await Campaign.findByPk(created.body.id);
        expect(fresh?.name).toBe('Original');
        expect(fresh?.status).toBe(status);
      },
    );
  });

  describe('DELETE state-machine + happy path', () => {
    it('returns 204 and removes the row on a draft campaign', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const created = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'ToDelete', subject: 'S', body: 'B' });
      expect(created.status).toBe(201);

      const res = await request(app)
        .delete(`/campaigns/${created.body.id}`)
        .set('Authorization', `Bearer ${a.token}`);

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});

      // DB confirms the delete.
      const fresh = await Campaign.findByPk(created.body.id);
      expect(fresh).toBeNull();
    });

    it('returns 409 CAMPAIGN_NOT_EDITABLE and KEEPS the row when status=sending', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const created = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'Locked', subject: 'S', body: 'B' });
      expect(created.status).toBe(201);
      await Campaign.update({ status: 'sending' }, { where: { id: created.body.id } });

      const res = await request(app)
        .delete(`/campaigns/${created.body.id}`)
        .set('Authorization', `Bearer ${a.token}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CAMPAIGN_NOT_EDITABLE');

      // Row still exists.
      const fresh = await Campaign.findByPk(created.body.id);
      expect(fresh).not.toBeNull();
      expect(fresh?.status).toBe('sending');
    });
  });

  describe('PATCH .strict() security guard', () => {
    // These are the load-bearing protections: even on a draft campaign, the
    // schema must reject status / scheduled_at / created_by injection.
    it.each<[string, Record<string, unknown>]>([
      ['status', { status: 'sent' }],
      ['scheduled_at', { scheduled_at: '2099-01-01T00:00:00.000Z' }],
      ['created_by', { created_by: '00000000-0000-4000-8000-deadbeefdead' }],
    ])('rejects PATCH with %s (unknown key) -> 400 VALIDATION_ERROR even on a draft', async (_label, patch) => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const created = await request(app)
        .post('/campaigns')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ name: 'Guarded', subject: 'S', body: 'B' });
      expect(created.status).toBe(201);

      const res = await request(app)
        .patch(`/campaigns/${created.body.id}`)
        .set('Authorization', `Bearer ${a.token}`)
        .send(patch);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      // The campaign must NOT have been mutated by the rejected request.
      const fresh = await Campaign.findByPk(created.body.id);
      expect(fresh?.status).toBe('draft');
      expect(fresh?.createdBy).toBe(a.userId);
      expect(fresh?.scheduledAt).toBeNull();
    });
  });
});
