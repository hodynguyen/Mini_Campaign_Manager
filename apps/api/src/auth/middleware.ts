/**
 * `requireAuth` — JWT verification middleware.
 *
 * Protocol:
 *   1. Read `Authorization: Bearer <jwt>`.
 *   2. If header missing/malformed -> 401 UNAUTHORIZED (via UnauthorizedError).
 *   3. `jwt.verify` — on success attach `req.user = { id, email }` and call next().
 *   4. On failure forward the JWT error to next() — the global handler maps:
 *        TokenExpiredError  -> 401 TOKEN_EXPIRED
 *        JsonWebTokenError  -> 401 INVALID_TOKEN
 *
 * F2 NOTE: this middleware is AUTHORED, not MOUNTED. F3 (campaigns/recipients)
 * will apply it to its routers. Tests in F2 exercise it via a tiny test-only
 * Express app that mounts a `GET /protected` route.
 *
 * NEVER log the token or the secret.
 */
import type { NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';

import { env } from '../config/env';
import { UnauthorizedError } from '../errors/AppError';

/** Shape of the JWT payload we sign in service.signToken. */
interface AuthJwtPayload extends JwtPayload {
  sub: string;
  email: string;
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('Authorization') ?? '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    next(
      new UnauthorizedError({
        code: 'UNAUTHORIZED',
        message: 'Missing or malformed Authorization header',
      }),
    );
    return;
  }

  try {
    // Pin algorithms on verify (defense-in-depth against algorithm-confusion).
    // jsonwebtoken@9 already rejects `alg=none` and asymmetric algos when
    // verifying with a string secret, but explicitly listing the allowed
    // algorithm matches OWASP guidance and survives any future jsonwebtoken
    // major where defaults could regress.
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as AuthJwtPayload;
    // Defensive: ensure the claims we depend on are actually strings.
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
      next(
        new UnauthorizedError({
          code: 'INVALID_TOKEN',
          message: 'Invalid token payload',
        }),
      );
      return;
    }
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    // Let JsonWebTokenError / TokenExpiredError bubble — the global handler
    // maps them to 401 with the right code (INVALID_TOKEN / TOKEN_EXPIRED).
    next(err);
  }
}
