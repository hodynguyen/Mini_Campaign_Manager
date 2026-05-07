/**
 * Integration tests: requireAuth middleware.
 *
 * The middleware is AUTHORED in F2 but NOT mounted on any production route —
 * F3 (campaigns) will use it. To exercise it now, we build a tiny test-only
 * Express app that mounts a single `GET /protected` route behind requireAuth
 * and assert the four documented outcomes:
 *
 *   - missing Authorization header        -> 401 UNAUTHORIZED
 *   - malformed scheme ("Token abc")      -> 401 UNAUTHORIZED
 *   - signature does not match            -> 401 INVALID_TOKEN
 *   - token expired                       -> 401 TOKEN_EXPIRED
 *   - valid bearer token                  -> 200 with `req.user` populated
 *
 * The expired-token path is exercised by signing with `expiresIn: '-1s'`,
 * which produces a token whose `exp` claim is already in the past — `jwt.verify`
 * raises `TokenExpiredError`, which the global handler maps to 401
 * TOKEN_EXPIRED.
 *
 * The DB is not actually touched by requireAuth, but we still close the
 * sequelize singleton in `afterAll` so jest doesn't warn about open handles.
 */
import express, { type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';

import { requireAuth } from '../src/auth/middleware';
import { env } from '../src/config/env';
import { errorHandler } from '../src/errors/handler';

import { closeDb } from './helpers/server';

/** Minimal Express app: parser -> requireAuth -> echo handler -> errorHandler. */
function buildProtectedApp() {
  const app = express();
  app.use(express.json());
  app.get('/protected', requireAuth, (req: Request, res: Response) => {
    // Echo `req.user` so the happy-path test can assert population.
    res.status(200).json({ ok: true, user: req.user });
  });
  app.use(errorHandler);
  return app;
}

describe('requireAuth middleware', () => {
  afterAll(async () => {
    await closeDb();
  });

  describe('rejection paths', () => {
    it('returns 401 UNAUTHORIZED when the Authorization header is missing', async () => {
      const res = await request(buildProtectedApp()).get('/protected');

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or malformed Authorization header',
        },
      });
    });

    it('returns 401 UNAUTHORIZED on a malformed scheme (e.g. "Token <jwt>")', async () => {
      const tokenPart = jwt.sign({ sub: 'u-1', email: 'x@x.com' }, env.JWT_SECRET);
      const res = await request(buildProtectedApp())
        .get('/protected')
        .set('Authorization', `Token ${tokenPart}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 UNAUTHORIZED on a header with no token after "Bearer"', async () => {
      const res = await request(buildProtectedApp())
        .get('/protected')
        .set('Authorization', 'Bearer ');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 INVALID_TOKEN when the signature is not valid', async () => {
      // Sign with a DIFFERENT secret — verification against env.JWT_SECRET fails.
      const badToken = jwt.sign({ sub: 'u-1', email: 'x@x.com' }, 'a-different-secret-32-chars-aaaaa');
      const res = await request(buildProtectedApp())
        .get('/protected')
        .set('Authorization', `Bearer ${badToken}`);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid token',
        },
      });
    });

    it('returns 401 INVALID_TOKEN on a totally malformed JWT string', async () => {
      const res = await request(buildProtectedApp())
        .get('/protected')
        .set('Authorization', 'Bearer not.a.jwt');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });

    it('returns 401 TOKEN_EXPIRED when the token has already expired', async () => {
      // expiresIn: '-1s' issues a token that is already past its `exp`.
      const expired = jwt.sign({ sub: 'u-1', email: 'x@x.com' }, env.JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: '-1s',
      });
      const res = await request(buildProtectedApp())
        .get('/protected')
        .set('Authorization', `Bearer ${expired}`);

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Token expired',
        },
      });
    });

    it('returns 401 INVALID_TOKEN when the payload claims have the wrong types', async () => {
      // sub as a number triggers the defensive `typeof` check in middleware.ts
      // before `req.user` is populated.
      const weird = jwt.sign({ sub: 123, email: 'x@x.com' }, env.JWT_SECRET);
      const res = await request(buildProtectedApp())
        .get('/protected')
        .set('Authorization', `Bearer ${weird}`);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_TOKEN');
    });
  });

  describe('happy path', () => {
    it('passes through and attaches { id, email } to req.user on a valid token', async () => {
      const userId = '00000000-0000-4000-8000-000000000001';
      const token = jwt.sign(
        { sub: userId, email: 'frank@example.com' },
        env.JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '5m' },
      );

      const res = await request(buildProtectedApp())
        .get('/protected')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        user: { id: userId, email: 'frank@example.com' },
      });
    });
  });
});
