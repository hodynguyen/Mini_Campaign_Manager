/**
 * Env loader for @app/api.
 *
 * Loads .env via dotenv, then validates with zod. Fails fast on missing/invalid
 * config so we never boot a process in a broken state. Re-used pattern across
 * F2/F3 — add new vars to the schema here, not ad-hoc throughout the codebase.
 *
 * F2 additions:
 *   - JWT_SECRET             — HS256 signing key. Min 32 chars in production
 *                              (and any non-test/dev env). Loose in dev/test
 *                              so devs aren't forced to invent a long secret.
 *   - JWT_EXPIRES_IN         — passed to `jsonwebtoken.sign(..., { expiresIn })`
 *                              (e.g. '24h', '900s'). Default '24h' per ADR-009.
 *   - CORS_ORIGINS           — CSV of allowed origins. Parsed into string[].
 *                              Default 'http://localhost:5173' (Vite dev).
 *   - DATABASE_URL_TEST      — separate DB URL for tests. Required when
 *                              NODE_ENV=test, ignored otherwise. Prevents
 *                              tests from truncating the dev DB.
 */
import 'dotenv/config';
import { z } from 'zod';

const NODE_ENV = z.enum(['development', 'test', 'production']).default('development');

/**
 * `JWT_SECRET` length policy:
 *   - production       -> min 32 chars (HS256 best-practice; entropy >=128 bits roughly)
 *   - development/test -> min 1   char  (any non-empty string; reviewers can use 'change-me')
 *
 * We can't easily branch a zod schema on another field at parse-time, so we
 * apply the strict-32 rule via a `.superRefine` after `NODE_ENV` is parsed.
 */
const BaseEnvSchema = z.object({
  NODE_ENV,
  PORT: z.coerce.number().int().positive().default(4000),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_URL_TEST: z.string().min(1).optional(),

  // JWT
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_EXPIRES_IN: z.string().min(1).default('24h'),

  // CORS — accept CSV string from process.env, transform to string[].
  // Empty/missing value falls through to the default origin (Vite dev port).
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s): string[] =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o.length > 0),
    ),
});

const EnvSchema = BaseEnvSchema.superRefine((cfg, ctx) => {
  // Tighten JWT_SECRET in production (and any non-dev/non-test env).
  if (cfg.NODE_ENV === 'production' && cfg.JWT_SECRET.length < 32) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_SECRET'],
      message: 'JWT_SECRET must be at least 32 characters in production',
    });
  }
  // Tests must use a SEPARATE database — tests truncate tables; we won't risk
  // pointing them at the dev DB by accident.
  if (cfg.NODE_ENV === 'test' && !cfg.DATABASE_URL_TEST) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_URL_TEST'],
      message: 'DATABASE_URL_TEST is required when NODE_ENV=test',
    });
  }
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env: Env = parsed.data;
