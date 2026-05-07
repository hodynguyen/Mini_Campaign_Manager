/**
 * Per-worker test bootstrap.
 *
 * Wired via jest config `setupFiles` so it runs in EVERY worker BEFORE any
 * test file imports anything. Loading `.env.test` here is critical because
 * `apps/api/src/config/env.ts` validates env-vars at import time and exits
 * the process on missing values. If we let dotenv run from inside a test
 * file, `env.ts` would already have observed an empty `process.env`.
 *
 * This file does NOT touch the DB or run migrations — that happens once,
 * globally, in `setup-global.ts`.
 */
import path from 'path';

import dotenv from 'dotenv';

// `.env.test` lives at apps/api/.env.test; this file is at apps/api/tests/helpers/setup-env.ts
// so we go up two directories to reach the workspace root.
dotenv.config({ path: path.resolve(__dirname, '../../.env.test') });

// Belt-and-braces: jest already sets NODE_ENV=test, but a stray test runner
// (e.g. running this file directly) could leave it unset.
process.env['NODE_ENV'] = 'test';
