/**
 * @app/shared — shared TypeScript types and DTOs across @app/api and @app/web.
 *
 * F2 (auth) populates the auth surface. Campaign / Recipient DTOs land in F3.
 *
 * IMPORTANT — type-only file:
 *   - Do NOT import `zod` here. Zod schemas live in `apps/api/src/schemas/`
 *     because the api owns request validation; the web app consumes the
 *     inferred shapes through these pure interfaces. See ADR-010.
 *   - This keeps @app/shared free of any runtime, so it works under both ESM
 *     (web, Vite) and CJS (api, ts-jest) without extra build/transpile.
 */

/* ────────────────────────────── Auth ────────────────────────────── */

/**
 * User as returned by /auth/register and embedded in /auth/login response.
 * Note: NO `password_hash`, NO `updated_at` — those are server-side concerns.
 * `created_at` is ISO 8601 — Sequelize / Express JSON serializes Date this way.
 */
export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

/** POST /auth/register body. */
export interface RegisterRequest {
  email: string;
  name: string;
  password: string;
}

/** POST /auth/login body. */
export interface LoginRequest {
  email: string;
  password: string;
}

/** POST /auth/login response (200). */
export interface AuthResponse {
  token: string;
  user: User;
}

/* ───────────────────────── Error envelope ───────────────────────── */

/**
 * Uniform error response shape from the API. Codes are SCREAMING_SNAKE
 * strings; clients pattern-match on `error.code`, NEVER on `error.message`.
 *
 * Examples (F2):
 *   { error: { code: 'VALIDATION_ERROR', message: '...', details: [...] } }
 *   { error: { code: 'EMAIL_TAKEN', message: 'Email already in use' } }
 *   { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }
 *   { error: { code: 'TOKEN_EXPIRED', message: 'Token expired' } }
 */
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
