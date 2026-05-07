/**
 * Sequelize singleton.
 *
 * Single instance per process, constructed from `env.DATABASE_URL`. The
 * `authenticate()` helper here is what `app.ts` (or `index.ts` boot) calls at
 * startup so the API fails fast on a bad DB connection / wrong creds.
 *
 * F2 SCAFFOLD-ONLY:
 *   - The instance is created and exported.
 *   - NO models are registered yet — BUILD will import this file from
 *     `src/db/models/User.ts` and call `User.init(...)` against `sequelize`.
 *   - NO sync() is ever called; schema is owned by migrations
 *     (see `migrations/` and `src/db/migrate.ts`).
 *
 * Why a singleton:
 *   - Sequelize's connection pool is per-instance. One instance per process
 *     keeps the pool sane and avoids surprise "too many connections" in tests.
 *   - Tests import this same singleton (via `tests/helpers/server.ts`) so
 *     migrations run once and truncate cleans the same connection.
 *
 * Logging policy:
 *   - `logging: false` in non-test/dev (we already have morgan for HTTP logs;
 *     SQL chatter pollutes prod logs).
 *   - `logging: console.log` only when DEBUG_SQL=1 (kept simple — no extra env
 *     declared for now; flip via `DEBUG_SQL=1 yarn dev` ad-hoc).
 */
import { Sequelize } from 'sequelize';

import { env } from '../config/env';

/**
 * Pick the right database URL for the current environment.
 *
 * Tests (`NODE_ENV=test`) MUST hit `DATABASE_URL_TEST` so a careless
 * `truncate` never wipes a developer's local dev DB. The env loader marks
 * `DATABASE_URL_TEST` required when NODE_ENV=test, so a missing value here
 * means the loader already exited the process.
 */
const connectionUrl: string =
  env.NODE_ENV === 'test' && env.DATABASE_URL_TEST ? env.DATABASE_URL_TEST : env.DATABASE_URL;

export const sequelize: Sequelize = new Sequelize(connectionUrl, {
  dialect: 'postgres',
  logging: process.env['DEBUG_SQL'] === '1' ? console.log : false,
  define: {
    // Project convention: snake_case columns in DB, camelCase in JS land.
    // Models must opt in by setting `underscored: true` in their init() call;
    // we don't force it globally so individual models can override if needed.
    timestamps: true,
  },
  pool: {
    max: 10,
    min: 0,
    acquire: 30_000,
    idle: 10_000,
  },
});

/**
 * Probe the DB connection. Call once at boot (in `index.ts`) and exit non-zero
 * on failure. Also used by `GET /health` to populate `db: 'up'|'down'`.
 *
 * Returns true on success, false on failure (does NOT throw — callers decide
 * whether failure is fatal).
 */
export async function pingDatabase(): Promise<boolean> {
  try {
    await sequelize.authenticate();
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[db] authenticate() failed:', err);
    return false;
  }
}
