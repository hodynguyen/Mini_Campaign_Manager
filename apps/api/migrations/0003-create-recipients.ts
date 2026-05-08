/**
 * Migration 0003 — create recipients.
 *
 * Recipients are tenant-shared (NO `created_by` column) — see ADR-012 in
 * decisions.md. The brief schema doesn't include `created_by` on recipients,
 * so we treat them as a global lookup (any authenticated user can attach any
 * recipient to their campaign by email).
 *
 * Schema (matches spec-campaigns-crud.md §"Data model"):
 *   id          UUID PK, default gen_random_uuid()
 *   email       CITEXT UNIQUE NOT NULL  (case-insensitive — citext from 0001)
 *   name        TEXT NOT NULL
 *   created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
 *
 * No `updated_at` — recipients are immutable once created in F3 (no PATCH
 * endpoint planned).
 *
 * The UNIQUE constraint on `email` is required for the upsert-by-email pattern
 * in `POST /campaigns` (when `recipient_emails` is provided). The unique
 * constraint already creates an index — no separate CREATE INDEX needed.
 */
import type { QueryInterface } from 'sequelize';

type Ctx = { context: QueryInterface };

export const up = async ({ context: q }: Ctx): Promise<void> => {
  await q.sequelize.query(`
    CREATE TABLE recipients (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email       CITEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

export const down = async ({ context: q }: Ctx): Promise<void> => {
  await q.sequelize.query('DROP TABLE IF EXISTS recipients;');
};
