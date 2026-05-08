/**
 * Integration tests: recipients CRUD.
 *
 * Recipients are tenant-shared (ADR-012) — any authenticated user can list /
 * create. Auth is still required (router is behind `requireAuth`).
 *
 * Coverage:
 *   - POST /recipients valid                        -> 201 + DTO.
 *   - POST /recipients duplicate (case-mismatched)  -> 409 RECIPIENT_EMAIL_TAKEN
 *     (NOT generic UNIQUE_CONSTRAINT — service rethrows with the friendlier code).
 *   - GET  /recipients paginated                    -> { data, meta } shape.
 *   - GET  /recipients?search=alice                 -> filters via Op.iLike on
 *                                                       email + name (case-insens).
 *   - 401 path                                       -> no auth header rejected.
 *   - 400 path                                       -> malformed payload rejected.
 */
import request from 'supertest';

import { Recipient } from '../src/db/models/Recipient';

import { createUserA, createUserB } from './helpers/auth';
import { buildTestApp, closeDb, truncate } from './helpers/server';

describe('recipients CRUD', () => {
  beforeEach(async () => {
    await truncate();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('POST /recipients', () => {
    it('returns 201 + a Recipient DTO and persists a row', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const res = await request(app)
        .post('/recipients')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ email: 'pat@example.com', name: 'Pat' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        email: 'pat@example.com',
        name: 'Pat',
        created_at: expect.any(String),
      });
      expect(new Date(res.body.created_at).toString()).not.toBe('Invalid Date');

      // DB-level: exactly one row.
      const count = await Recipient.count();
      expect(count).toBe(1);
    });

    it('lowercases + trims the email before storing', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const res = await request(app)
        .post('/recipients')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ email: '  Mike@Example.COM  ', name: 'Mike' });

      expect(res.status).toBe(201);
      expect(res.body.email).toBe('mike@example.com');
    });

    it('returns 409 RECIPIENT_EMAIL_TAKEN on a duplicate email (case-insensitive via CITEXT)', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const first = await request(app)
        .post('/recipients')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ email: 'alice@example.com', name: 'Alice' });
      expect(first.status).toBe(201);

      // Duplicate in a different case + via a DIFFERENT authenticated user —
      // recipients are tenant-shared so even User B can't insert the same email.
      const b = await createUserB(app);
      const second = await request(app)
        .post('/recipients')
        .set('Authorization', `Bearer ${b.token}`)
        .send({ email: 'Alice@EXAMPLE.com', name: 'Alice Two' });

      expect(second.status).toBe(409);
      expect(second.body).toEqual({
        error: {
          code: 'RECIPIENT_EMAIL_TAKEN',
          message: 'Recipient with this email already exists',
        },
      });

      // Critically: the second insert did NOT create a duplicate row.
      const count = await Recipient.count();
      expect(count).toBe(1);
    });

    it('returns 400 VALIDATION_ERROR on a malformed payload', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      const res = await request(app)
        .post('/recipients')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ email: 'not-an-email', name: '' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(await Recipient.count()).toBe(0);
    });

    it('returns 401 UNAUTHORIZED without an Authorization header', async () => {
      const app = buildTestApp();
      const res = await request(app)
        .post('/recipients')
        .send({ email: 'noauth@example.com', name: 'NoAuth' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /recipients', () => {
    it('returns a paginated list with the correct meta shape', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      // Seed 3 recipients in a known order. We don't assert order beyond the
      // fact that all three appear; sort is `created_at DESC` per service.
      for (const r of [
        { email: 'one@example.com', name: 'One' },
        { email: 'two@example.com', name: 'Two' },
        { email: 'three@example.com', name: 'Three' },
      ]) {
        const insert = await request(app)
          .post('/recipients')
          .set('Authorization', `Bearer ${a.token}`)
          .send(r);
        expect(insert.status).toBe(201);
      }

      const res = await request(app)
        .get('/recipients')
        .set('Authorization', `Bearer ${a.token}`);

      expect(res.status).toBe(200);
      // limit defaults to 50 per the recipients schema (NOT 20 like campaigns).
      expect(res.body.meta).toEqual({ page: 1, limit: 50, total: 3 });
      expect(res.body.data).toHaveLength(3);
      // Spot-check shape on every entry.
      for (const r of res.body.data) {
        expect(r).toMatchObject({
          id: expect.any(String),
          email: expect.any(String),
          name: expect.any(String),
          created_at: expect.any(String),
        });
      }
    });

    it('?search= filters by email OR name via case-insensitive iLike', async () => {
      const app = buildTestApp();
      const a = await createUserA(app);

      for (const r of [
        { email: 'alice@example.com', name: 'Alice Smith' },
        { email: 'bob@example.com', name: 'Bob Jones' },
        { email: 'charlie@example.com', name: 'Charlie Brown' },
        // This one matches via NAME, not email — proves the OR branch.
        { email: 'dave@example.com', name: 'Dave Alicea' },
      ]) {
        await request(app)
          .post('/recipients')
          .set('Authorization', `Bearer ${a.token}`)
          .send(r);
      }

      // Search for "alice" — case-insensitive, matches both
      // "alice@example.com" (email) and "Dave Alicea" (name substring).
      const res = await request(app)
        .get('/recipients?search=alice')
        .set('Authorization', `Bearer ${a.token}`);

      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(2);
      const emails = res.body.data.map((r: { email: string }) => r.email).sort();
      expect(emails).toEqual(['alice@example.com', 'dave@example.com']);
    });

    it('returns 401 UNAUTHORIZED without an Authorization header', async () => {
      const app = buildTestApp();
      const res = await request(app).get('/recipients');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });
});
