/**
 * Test helpers: build an Express app, manage the shared Sequelize singleton,
 * truncate tables between tests.
 *
 * Why a helper module:
 *   - `createApp()` from src/app.ts is stateless — calling it per test gives
 *     a fresh app instance without re-bootstrapping the DB pool.
 *   - The Sequelize singleton (and the User model registered against it) is
 *     imported here once. Tests get a stable handle for direct DB assertions
 *     (e.g. "after register, the row exists with a bcrypt hash").
 *
 * Truncate strategy:
 *   `truncate()` clears `users` between tests so they stay isolated. CASCADE
 *   is used so future migrations adding FK-referencing tables (campaigns,
 *   recipients) are wiped without re-ordering this helper.
 */
import type { Express } from 'express';

import { createApp } from '../../src/app';
import { sequelize } from '../../src/db/sequelize';
// Side-effect imports: register every model on the shared sequelize instance
// AND wire up associations. Without these, `User.findByPk(...)` in tests
// would fail with "User has not been defined", and any `include: [...]` would
// fail with "X is not associated to Y". Order doesn't matter — `associations`
// imports the models internally.
import '../../src/db/models/User';
import '../../src/db/models/Campaign';
import '../../src/db/models/Recipient';
import '../../src/db/models/CampaignRecipient';
import '../../src/db/associations';

export { sequelize };

/** Build a fresh Express app for the current test. Cheap — no listen(). */
export function buildTestApp(): Express {
  return createApp();
}

/**
 * Truncate every test-managed table. Called from each test file's `afterEach`
 * (and explicitly in `beforeEach` of the few tests that need a known empty
 * state before they run).
 *
 * Strategy: list every test-managed table in ONE `TRUNCATE ... CASCADE`
 * statement. Postgres handles the FK ordering internally, so we don't have
 * to worry about deleting child rows before parents.
 *
 * Tables (as of F3):
 *   - campaign_recipients  (FK -> campaigns, recipients)
 *   - campaigns            (FK -> users)
 *   - recipients           (no FK; tenant-shared)
 *   - users                (root)
 *
 * RESTART IDENTITY: resets sequence counters so id columns start over (a
 * non-issue for UUID PKs but cheap and future-proof).
 * CASCADE: drops dependents transparently. Future migrations adding new
 * FK-referencing tables can extend this list as needed.
 */
export async function truncate(): Promise<void> {
  await sequelize.query(
    'TRUNCATE TABLE "campaign_recipients", "campaigns", "recipients", "users" RESTART IDENTITY CASCADE',
  );
}

/** Close the connection pool. Call from the last `afterAll` per test file. */
export async function closeDb(): Promise<void> {
  await sequelize.close();
}
