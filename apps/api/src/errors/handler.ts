/**
 * Global Express error handler.
 *
 * Mapping table (locked in spec-auth.md §6 + ADR for error shape):
 *   ZodError                       -> 400  VALIDATION_ERROR  + field-level details
 *   AppError (and subclasses)      -> err.status with err.code/err.message/err.details
 *   sequelize.UniqueConstraintError-> 409  UNIQUE_CONSTRAINT (overridable per-route)
 *   JsonWebTokenError              -> 401  INVALID_TOKEN
 *   TokenExpiredError              -> 401  TOKEN_EXPIRED
 *   anything else                  -> 500  INTERNAL with a generic message
 *                                          (NEVER leak err.message or stack)
 *
 * Response shape is uniform — matches `ApiError` in @app/shared:
 *   { error: { code: string, message: string, details?: unknown } }
 *
 * F2 SCAFFOLD-ONLY:
 *   - Function signature + dispatch shape are locked here.
 *   - BUILD fills in body details (pulling Zod field errors into `details`,
 *     mapping the unique-constraint message to a friendlier `EMAIL_TAKEN`
 *     when surfaced by /auth/register, etc.).
 *   - Mount LAST in `app.ts` (after all routes, after the 404 handler if any).
 *
 * IMPORTANT: Express recognizes error-handling middleware by ARITY (4 args).
 * Do not change the parameter list — keep `_next` unused but present.
 */
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { UniqueConstraintError } from 'sequelize';

import { AppError } from './AppError';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  // 1) Zod validation errors -> 400 with structured field issues.
  //    BUILD: shape `details` as Array<{ path: (string|number)[]; message: string }>
  //    via `err.issues.map(...)` — keep paths machine-readable for the frontend.
  if (err instanceof ZodError) {
    const body: ErrorBody = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues, // BUILD: trim to { path, message } if `issues` exposes too much.
      },
    };
    res.status(400).json(body);
    return;
  }

  // 2) Domain errors (and all AppError subclasses) — they carry their own status.
  if (err instanceof AppError) {
    const body: ErrorBody = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    };
    res.status(err.status).json(body);
    return;
  }

  // 3) Sequelize unique-constraint -> 409. Default code; specific routes that
  //    want a friendlier code (e.g. EMAIL_TAKEN) should catch the error in the
  //    service layer and rethrow as a `ConflictError({ code: 'EMAIL_TAKEN' })`.
  if (err instanceof UniqueConstraintError) {
    const body: ErrorBody = {
      error: {
        code: 'UNIQUE_CONSTRAINT',
        message: 'Resource already exists',
      },
    };
    res.status(409).json(body);
    return;
  }

  // 4) JWT errors from jsonwebtoken -> 401. Distinguish expired vs invalid so
  //    clients can decide whether to prompt re-login vs. refresh.
  if (err instanceof TokenExpiredError) {
    res.status(401).json({
      error: { code: 'TOKEN_EXPIRED', message: 'Token expired' },
    });
    return;
  }
  if (err instanceof JsonWebTokenError) {
    res.status(401).json({
      error: { code: 'INVALID_TOKEN', message: 'Invalid token' },
    });
    return;
  }

  // 5) Fallback: log internally, return a generic 500. NEVER include err.message
  //    or stack in the response — could leak SQL, file paths, secrets.
  // eslint-disable-next-line no-console
  console.error('[unhandled error]', err);
  res.status(500).json({
    error: { code: 'INTERNAL', message: 'Internal Server Error' },
  });
}
