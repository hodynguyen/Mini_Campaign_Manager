/**
 * Jest globalTeardown — runs ONCE after the entire suite finishes.
 *
 * Closes any Sequelize connection pool that may have been opened by the
 * teardown process (jest spawns a fresh Node process for this hook, so
 * we re-load dotenv and re-import the singleton).
 *
 * This isn't strictly required — the worker processes own their own pools
 * and exit cleanly — but it keeps `--detectOpenHandles` quiet and avoids
 * "process did not exit gracefully" warnings on slow CI runners.
 */
import path from 'path';

import dotenv from 'dotenv';

export default async function globalTeardown(): Promise<void> {
  dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });
  process.env['NODE_ENV'] = 'test';

  /* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/consistent-type-imports */
  const sequelizeMod: typeof import('../../src/db/sequelize') = require('../../src/db/sequelize');
  /* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/consistent-type-imports */
  await sequelizeMod.sequelize.close();
}
