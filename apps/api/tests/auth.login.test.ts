/**
 * Integration tests: POST /auth/login.
 *
 * Coverage:
 *   - Happy path: register + login -> 200 { token, user }; token verifies
 *     against env.JWT_SECRET and decodes to { sub, email, iat, exp }.
 *   - Wrong password: 401 INVALID_CREDENTIALS.
 *   - No such email: 401 INVALID_CREDENTIALS — same code as wrong password
 *     (enumeration prevention per business-rules.md).
 *
 * Real DB; the `beforeEach` truncate keeps tests independent.
 */
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { env } from '../src/config/env';

import { buildTestApp, closeDb, truncate } from './helpers/server';

interface AuthJwtPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await truncate();
  });

  afterAll(async () => {
    await closeDb();
  });

  it('returns 200 with a valid JWT and user DTO on correct credentials', async () => {
    const app = buildTestApp();

    // Seed: register the account we'll log in as.
    const reg = await request(app).post('/auth/register').send({
      email: 'carol@example.com',
      name: 'Carol',
      password: 'super-secret-pwd-1',
    });
    expect(reg.status).toBe(201);

    const res = await request(app).post('/auth/login').send({
      email: 'carol@example.com',
      password: 'super-secret-pwd-1',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      token: expect.any(String),
      user: {
        id: reg.body.id,
        email: 'carol@example.com',
        name: 'Carol',
        created_at: expect.any(String),
      },
    });
    // `password_hash` must NEVER appear on the wire.
    expect(res.body.user).not.toHaveProperty('password_hash');
    expect(res.body.user).not.toHaveProperty('passwordHash');

    // Token verifies against the configured secret AND has the expected
    // payload shape (ADR-011: { sub: userId, email, iat, exp }).
    const decoded = jwt.verify(res.body.token, env.JWT_SECRET) as AuthJwtPayload;
    expect(decoded.sub).toBe(reg.body.id);
    expect(decoded.email).toBe('carol@example.com');
    expect(typeof decoded.iat).toBe('number');
    expect(typeof decoded.exp).toBe('number');
    // Token life should be in the future and longer than `iat`.
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
  });

  it('accepts a case-mismatched email at login (CITEXT match)', async () => {
    const app = buildTestApp();
    await request(app).post('/auth/register').send({
      email: 'dave@example.com',
      name: 'Dave',
      password: 'super-secret-pwd-1',
    });

    const res = await request(app).post('/auth/login').send({
      email: 'DAVE@example.com',
      password: 'super-secret-pwd-1',
    });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('dave@example.com');
  });

  it('returns 401 INVALID_CREDENTIALS on wrong password (correct email)', async () => {
    const app = buildTestApp();
    await request(app).post('/auth/register').send({
      email: 'eve@example.com',
      name: 'Eve',
      password: 'real-password',
    });

    const res = await request(app).post('/auth/login').send({
      email: 'eve@example.com',
      password: 'wrong-password',
    });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      },
    });
  });

  it('returns 401 INVALID_CREDENTIALS for an unknown email (same code as wrong-password)', async () => {
    const app = buildTestApp();
    // No registration here — the email simply does not exist.

    const res = await request(app).post('/auth/login').send({
      email: 'ghost@example.com',
      password: 'whatever',
    });

    // The error code MUST be identical to the wrong-password case so a client
    // (or attacker) cannot distinguish "no such user" from "bad password" —
    // login enumeration defense per business-rules.md.
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      },
    });
  });

  it('returns 400 VALIDATION_ERROR on a malformed login payload', async () => {
    const app = buildTestApp();
    const res = await request(app).post('/auth/login').send({
      email: 'not-an-email',
      password: '',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
