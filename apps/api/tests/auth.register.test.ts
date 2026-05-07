/**
 * Integration tests: POST /auth/register.
 *
 * Coverage (per spec-auth.md §9 + log-auth.md backend hand-off):
 *   1. Happy path:  201 + correct DTO shape; DB row exists with bcrypt hash.
 *   2. Duplicate email (case-mismatch tests CITEXT path): second insert -> 409
 *      EMAIL_TAKEN.
 *   3. Validation:  short password / missing name / malformed email -> 400
 *      VALIDATION_ERROR with `details`.
 *
 * Runs against the real Postgres test DB via `tests/helpers/server.ts`.
 * Each test starts from an empty `users` table; the `beforeEach` truncate
 * keeps tests order-independent.
 */
import request from 'supertest';

import { User } from '../src/db/models/User';

import { buildTestApp, closeDb, truncate } from './helpers/server';

describe('POST /auth/register', () => {
  beforeEach(async () => {
    await truncate();
  });

  afterAll(async () => {
    await closeDb();
  });

  describe('happy path', () => {
    it('returns 201 + a User DTO and persists a row with a bcrypt hash', async () => {
      const app = buildTestApp();

      const res = await request(app).post('/auth/register').send({
        email: 'alice@example.com',
        name: 'Alice',
        password: 'correct-horse-battery-staple',
      });

      // Response shape: matches @app/shared `User` exactly — id, email, name,
      // created_at — and MUST NOT leak password_hash / password / updated_at.
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        email: 'alice@example.com',
        name: 'Alice',
        created_at: expect.any(String),
      });
      // ISO-8601 sanity check (matches `toISOString()` from controller).
      expect(new Date(res.body.created_at).toString()).not.toBe('Invalid Date');
      expect(res.body).not.toHaveProperty('password_hash');
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('password');

      // DB-level verification: row exists with a bcrypt-cost-10 hash.
      // Use `withPassword` scope because the default scope hides the column.
      const dbUser = await User.scope('withPassword').findByPk(res.body.id);
      expect(dbUser).not.toBeNull();
      expect(dbUser?.email).toBe('alice@example.com');
      expect(dbUser?.passwordHash).toMatch(/^\$2[aby]\$10\$/); // bcrypt cost 10
      expect(dbUser?.passwordHash).not.toBe('correct-horse-battery-staple');
    });

    it('lowercases + trims the email before storing it', async () => {
      const app = buildTestApp();

      const res = await request(app).post('/auth/register').send({
        email: '  Bob@Example.COM  ',
        name: 'Bob',
        password: 'a-strong-password-1',
      });

      expect(res.status).toBe(201);
      expect(res.body.email).toBe('bob@example.com');
    });
  });

  describe('duplicate email', () => {
    it('returns 409 EMAIL_TAKEN on a second registration with the same email (case-insensitive via CITEXT)', async () => {
      const app = buildTestApp();

      const first = await request(app).post('/auth/register').send({
        email: 'alice@example.com',
        name: 'Alice',
        password: 'correct-horse-battery-staple',
      });
      expect(first.status).toBe(201);

      // Different case + extra whitespace exercises both the zod
      // trim/lowercase normalization AND the CITEXT-backed unique index.
      const second = await request(app).post('/auth/register').send({
        email: 'Alice@EXAMPLE.com',
        name: 'Alice Two',
        password: 'a-different-password',
      });

      expect(second.status).toBe(409);
      expect(second.body).toEqual({
        error: {
          code: 'EMAIL_TAKEN',
          message: 'Email already in use',
        },
      });

      // And critically: the second registration did NOT create a duplicate row.
      const count = await User.count();
      expect(count).toBe(1);
    });
  });

  describe('validation errors', () => {
    // describe.each table — one row per invalid-input scenario. Each row is
    // expected to produce 400 VALIDATION_ERROR with non-empty `details`.
    const cases: Array<[string, Record<string, unknown>]> = [
      [
        'password shorter than 8 chars',
        { email: 'short@example.com', name: 'Short', password: 'short' },
      ],
      [
        'password longer than 72 chars (bcrypt ceiling)',
        {
          email: 'long@example.com',
          name: 'Long',
          password: 'x'.repeat(73),
        },
      ],
      [
        'missing name',
        { email: 'noname@example.com', password: 'a-strong-password-1' },
      ],
      [
        'name empty after trim',
        { email: 'noname2@example.com', name: '   ', password: 'a-strong-password-1' },
      ],
      [
        'malformed email',
        { email: 'not-an-email', name: 'Bad Email', password: 'a-strong-password-1' },
      ],
      [
        'missing email',
        { name: 'No Email', password: 'a-strong-password-1' },
      ],
      [
        'missing password',
        { email: 'nopass@example.com', name: 'No Password' },
      ],
    ];

    it.each(cases)('rejects %s with 400 VALIDATION_ERROR + details', async (_label, payload) => {
      const app = buildTestApp();
      const res = await request(app).post('/auth/register').send(payload);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Request validation failed');
      // Zod's issues array is non-empty for any of these inputs.
      expect(Array.isArray(res.body.error.details)).toBe(true);
      expect(res.body.error.details.length).toBeGreaterThan(0);

      // No row should have been inserted on a validation failure.
      const count = await User.count();
      expect(count).toBe(0);
    });
  });
});
