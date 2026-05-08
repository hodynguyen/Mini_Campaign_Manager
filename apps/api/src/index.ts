/**
 * Process entrypoint for @app/api.
 *
 * Boot sequence:
 *   1. Validate env (already done at config/env import time — exits on bad config).
 *   2. Ping the DB. Fail fast (exit 1) if unreachable.
 *   3. Build the Express app and start listening.
 *
 * Tests import `createApp` from `./app` directly — never this file — so they
 * never open a real port and never trigger the DB ping at startup. Tests own
 * their own DB lifecycle (migrations + truncate, see tests/helpers).
 */
import { createApp } from './app';
import { env } from './config/env';
import { pingDatabase } from './db/sequelize';
// Side-effect imports: register every model on the sequelize singleton AND
// wire associations exactly once at process boot. Without these, Sequelize
// wouldn't know about the models at runtime, and any `include: [...]` query
// would fail with "X is not associated to Y".
import './db/models/User';
import './db/models/Campaign';
import './db/models/Recipient';
import './db/models/CampaignRecipient';
import './db/associations';

(async (): Promise<void> => {
  const ok = await pingDatabase();
  if (!ok) {
    // eslint-disable-next-line no-console
    console.error('[api] DB connection failed at boot — exiting.');
    process.exit(1);
  }

  const app = createApp();
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.info(`[api] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });
})();
