/**
 * Migration 0002 — create campaigns.
 *
 * Loaded by `apps/api/src/db/migrate.ts` via umzug. Same context shape as
 * 0001-create-users.ts: `{ context: QueryInterface }`. We use raw SQL via
 * `q.sequelize.query` for parity with 0001 — `queryInterface.createTable`
 * obscures the ENUM type creation and the partial-index syntax we need below.
 *
 * Schema (matches spec-campaigns-crud.md §"Data model"):
 *   id            UUID PK, default gen_random_uuid() (pgcrypto from 0001)
 *   name          TEXT NOT NULL
 *   subject       TEXT NOT NULL
 *   body          TEXT NOT NULL
 *   status        campaign_status ENUM NOT NULL DEFAULT 'draft'
 *   scheduled_at  TIMESTAMPTZ (nullable; set in F4)
 *   created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
 *   created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
 *   updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
 *
 * Indexes (rationale documented in architecture.md §"F3 Campaigns CRUD"):
 *   - (created_by, updated_at DESC) — covers `GET /campaigns` tenant-scoped list
 *     sorted by recency.
 *   - (status, scheduled_at) WHERE status='scheduled' — partial index for the
 *     F4 due-soon worker scan; tiny because most campaigns aren't scheduled.
 *
 * `down` drops the table FIRST then the ENUM type (Postgres requires no
 * dependents on the type before DROP TYPE).
 */
import type { QueryInterface } from 'sequelize';

type Ctx = { context: QueryInterface };

export const up = async ({ context: q }: Ctx): Promise<void> => {
  await q.sequelize.query(`CREATE TYPE campaign_status AS ENUM ('draft','scheduled','sending','sent');`);
  await q.sequelize.query(`
    CREATE TABLE campaigns (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name          TEXT NOT NULL,
      subject       TEXT NOT NULL,
      body          TEXT NOT NULL,
      status        campaign_status NOT NULL DEFAULT 'draft',
      scheduled_at  TIMESTAMPTZ,
      created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await q.sequelize.query(`
    CREATE INDEX idx_campaigns_created_by_updated_at
      ON campaigns(created_by, updated_at DESC);
  `);
  await q.sequelize.query(`
    CREATE INDEX idx_campaigns_status_scheduled_at
      ON campaigns(status, scheduled_at)
      WHERE status = 'scheduled';
  `);
};

export const down = async ({ context: q }: Ctx): Promise<void> => {
  await q.sequelize.query('DROP TABLE IF EXISTS campaigns;');
  await q.sequelize.query('DROP TYPE IF EXISTS campaign_status;');
};
