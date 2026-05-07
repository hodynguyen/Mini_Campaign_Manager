/**
 * Migration runner (umzug-direct, NOT sequelize-cli).
 *
 * Why umzug-direct (see ADR-008):
 *   - sequelize-cli + TypeScript + our CommonJS api workspace requires either
 *     `sequelize-cli-typescript` (community fork, low maintenance) or a babel
 *     register hook. Both add fragility we cannot iterate on without running
 *     code, which is exactly the pain F1's BUILD agents flagged.
 *   - umzug is what sequelize-cli wraps internally. Calling it directly with
 *     `tsx` lets us write `.ts` migration files that are loaded as-is by the
 *     TS runtime — no compile, no separate config interpreter, zero ceremony.
 *
 * Usage (added to apps/api/package.json by BUILD):
 *   yarn workspace @app/api migrate         -> run pending migrations
 *   yarn workspace @app/api migrate:undo    -> revert the last migration
 *   yarn workspace @app/api migrate:status  -> list executed/pending
 *
 * Migration file shape (BUILD writes these — the FIRST one is 0001-create-users.ts):
 *   import type { QueryInterface } from 'sequelize';
 *   export async function up({ context }: { context: QueryInterface }) { ... }
 *   export async function down({ context }: { context: QueryInterface }) { ... }
 *
 * F2 SCAFFOLD-ONLY:
 *   - This file wires the runner. NO migration file content is created here —
 *     BUILD authors `migrations/0001-create-users.ts` per spec §"Data model".
 *   - Tests call `runMigrations()` once in global setup; the helper is
 *     exported below so `tests/helpers/server.ts` can import it directly.
 */
import path from 'path';

import type { QueryInterface } from 'sequelize';
import { SequelizeStorage, Umzug } from 'umzug';

import { sequelize } from './sequelize';

/**
 * Build the umzug instance. Migrations live in `apps/api/migrations/*.ts`,
 * loaded via `tsx` (dev/test) or compiled `.js` (production via `tsc`).
 *
 * The glob below picks up BOTH `.ts` and `.js` so a built artifact can run
 * the same migrations the dev runtime did. The cli (this file invoked
 * directly via `tsx`) only ever sees `.ts`.
 */
export function buildUmzug(): Umzug<QueryInterface> {
  return new Umzug({
    migrations: {
      // `path.resolve` against this file's directory keeps cwd-independent.
      // From `src/db/migrate.ts` we go up 2 to `apps/api/`, then into `migrations/`.
      glob: path.resolve(__dirname, '../../migrations/*.{ts,js}'),
      // Pass the QueryInterface as `context` to up/down — standard umzug pattern.
      resolve: ({ name, path: filepath, context }) => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(filepath as string) as {
          up: (args: { context: typeof context }) => Promise<void>;
          down: (args: { context: typeof context }) => Promise<void>;
        };
        return {
          name,
          up: async () => mod.up({ context }),
          down: async () => mod.down({ context }),
        };
      },
    },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: console,
  });
}

/** Convenience wrapper — used by tests' global setup to migrate the test DB. */
export async function runMigrations(): Promise<void> {
  const umzug = buildUmzug();
  await umzug.up();
}

/** Convenience wrapper — used by tests/teardown if they ever need it. */
export async function revertAllMigrations(): Promise<void> {
  const umzug = buildUmzug();
  await umzug.down({ to: 0 });
}

/**
 * CLI entry point. Invoked via `tsx src/db/migrate.ts <command>`.
 * BUILD wires package.json scripts to this file — see top-of-file usage.
 */
async function main(): Promise<void> {
  const umzug = buildUmzug();
  const cmd = process.argv[2] ?? 'up';

  switch (cmd) {
    case 'up':
      await umzug.up();
      break;
    case 'down':
    case 'undo':
      await umzug.down(); // reverts the most recent migration only
      break;
    case 'status': {
      const executed = await umzug.executed();
      const pending = await umzug.pending();
      // eslint-disable-next-line no-console
      console.log('Executed:', executed.map((m) => m.name));
      // eslint-disable-next-line no-console
      console.log('Pending: ', pending.map((m) => m.name));
      break;
    }
    default:
      // eslint-disable-next-line no-console
      console.error(`Unknown migrate command: ${cmd}. Use: up | down | status`);
      process.exit(2);
  }

  await sequelize.close();
}

// Only auto-run when invoked as a script (not when imported by tests).
if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[migrate] failed:', err);
    process.exit(1);
  });
}
