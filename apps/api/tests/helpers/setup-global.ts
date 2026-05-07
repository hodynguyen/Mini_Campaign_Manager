/**
 * Jest globalSetup — runs ONCE before any worker boots.
 *
 * Responsibilities:
 *   1. Load `.env.test` so `env.ts` parses cleanly.
 *   2. Run all umzug migrations against the test database. Migrations are
 *      idempotent (CREATE EXTENSION IF NOT EXISTS, CREATE TABLE only inserts
 *      schema_meta rows when missing), so re-running between local sessions
 *      is fine.
 *   3. Truncate the `users` table. If a previous test run aborted mid-way,
 *      stale rows could break uniqueness assumptions.
 *   4. Close the Sequelize pool we opened so jest's worker-fork doesn't
 *      inherit a half-initialized handle.
 *
 * Note: globalSetup runs in its OWN Node process, separate from the workers.
 * That's why we re-load dotenv here — workers' `setupFiles` doesn't apply.
 */
import path from 'path';

import dotenv from 'dotenv';

export default async function globalSetup(): Promise<void> {
  dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });
  process.env['NODE_ENV'] = 'test';

  // Imported AFTER dotenv so env.ts sees the loaded values. The `.ts` source
  // is loaded directly via ts-jest's transform — same path the workers use.
  // We use require() (not `await import`) so this stays synchronous w.r.t.
  // the dotenv.config call above and the cast targets typeof <module>.
  /* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/consistent-type-imports */
  const migrate: typeof import('../../src/db/migrate') = require('../../src/db/migrate');
  const sequelizeMod: typeof import('../../src/db/sequelize') = require('../../src/db/sequelize');
  /* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/consistent-type-imports */
  const { runMigrations } = migrate;
  const { sequelize } = sequelizeMod;

  await runMigrations();
  // Wipe leftover state from any prior aborted run.
  await sequelize.query('TRUNCATE TABLE "users" RESTART IDENTITY CASCADE');
  await sequelize.close();
}
