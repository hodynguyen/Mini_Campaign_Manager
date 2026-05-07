/**
 * Migration 0001 — create users.
 *
 * Loaded by `apps/api/src/db/migrate.ts` via umzug. The `context` arg is the
 * Sequelize `QueryInterface`; we use `context.sequelize.query` for raw SQL
 * because we need PG-specific extensions (`citext`, `pgcrypto`) and a typed
 * UUID default that `queryInterface.createTable` would obscure.
 *
 * Schema (matches spec-auth.md §"Data model"):
 *   id            UUID PK, default gen_random_uuid()
 *   email         CITEXT UNIQUE NOT NULL  (case-insensitive)
 *   name          TEXT NOT NULL
 *   password_hash TEXT NOT NULL
 *   created_at    TIMESTAMPTZ NOT NULL default now()
 *   updated_at    TIMESTAMPTZ NOT NULL default now()
 *
 * The unique constraint on `email` already creates an index — no separate
 * CREATE INDEX needed.
 *
 * `down` drops the table only; the `citext` and `pgcrypto` extensions are
 * intentionally left in place. Other migrations (e.g. campaigns/recipients)
 * will need them, and IF NOT EXISTS makes re-creation idempotent.
 */
import type { QueryInterface } from 'sequelize';

type Ctx = { context: QueryInterface };

export const up = async ({ context: q }: Ctx): Promise<void> => {
  await q.sequelize.query('CREATE EXTENSION IF NOT EXISTS citext;');
  await q.sequelize.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  await q.sequelize.query(`
    CREATE TABLE users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         CITEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

export const down = async ({ context: q }: Ctx): Promise<void> => {
  await q.sequelize.query('DROP TABLE IF EXISTS users;');
};
