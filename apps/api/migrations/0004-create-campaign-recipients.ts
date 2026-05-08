/**
 * Migration 0004 — create campaign_recipients (join table).
 *
 * Many-to-many between campaigns and recipients, with per-recipient send
 * state (`status`, `sent_at`, `opened_at`).
 *
 * Schema (matches spec-campaigns-crud.md §"Data model"):
 *   id            UUID PK, default gen_random_uuid()
 *   campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE
 *   recipient_id  UUID NOT NULL REFERENCES recipients(id) ON DELETE RESTRICT
 *   status        campaign_recipient_status ENUM NOT NULL DEFAULT 'pending'
 *   sent_at       TIMESTAMPTZ (nullable; stamped by F4 sender)
 *   opened_at     TIMESTAMPTZ (nullable; stamped by F4 seed/demo script)
 *   UNIQUE (campaign_id, recipient_id)  -- one row per recipient per campaign
 *
 * FK behavior:
 *   - campaign_id ON DELETE CASCADE: deleting a draft campaign removes its
 *     CR rows automatically (so DELETE /campaigns/:id doesn't need explicit
 *     dependent cleanup).
 *   - recipient_id ON DELETE RESTRICT: don't let a recipient be deleted if
 *     it's been used by a campaign — preserves audit trail.
 *
 * Indexes (rationale documented in architecture.md §"F3 Campaigns CRUD"):
 *   - The UNIQUE (campaign_id, recipient_id) constraint already creates an
 *     index covering (campaign_id, recipient_id) — but Postgres requires the
 *     leading column for index usage, so a separate (campaign_id) single-col
 *     index ALSO helps the stats aggregate `WHERE campaign_id = ...`.
 *   - Actually, the composite index leading with campaign_id IS usable for
 *     campaign_id-only filters. We still create the single-col index because
 *     it's slimmer and Postgres's planner may prefer it for the count-heavy
 *     stats query. Both are cheap on the data sizes we expect.
 *
 * `down` drops the table FIRST then the ENUM type.
 */
import type { QueryInterface } from 'sequelize';

type Ctx = { context: QueryInterface };

export const up = async ({ context: q }: Ctx): Promise<void> => {
  await q.sequelize.query(
    `CREATE TYPE campaign_recipient_status AS ENUM ('pending','sent','failed');`,
  );
  await q.sequelize.query(`
    CREATE TABLE campaign_recipients (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      recipient_id  UUID NOT NULL REFERENCES recipients(id) ON DELETE RESTRICT,
      status        campaign_recipient_status NOT NULL DEFAULT 'pending',
      sent_at       TIMESTAMPTZ,
      opened_at     TIMESTAMPTZ,
      UNIQUE (campaign_id, recipient_id)
    );
  `);
  await q.sequelize.query(`
    CREATE INDEX idx_cr_campaign_id ON campaign_recipients(campaign_id);
  `);
};

export const down = async ({ context: q }: Ctx): Promise<void> => {
  await q.sequelize.query('DROP TABLE IF EXISTS campaign_recipients;');
  await q.sequelize.query('DROP TYPE IF EXISTS campaign_recipient_status;');
};
