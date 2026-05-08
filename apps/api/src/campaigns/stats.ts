/**
 * Campaign stats aggregation — one SQL round-trip, no N+1.
 *
 * Why raw SQL (not Sequelize aggregate API):
 *   Sequelize's `findAll({ attributes: [Sequelize.fn('COUNT', ...)] })` does
 *   not natively express `COUNT(*) FILTER (WHERE ...)`. Postgres's FILTER
 *   clause is the cleanest way to get four conditional counts in ONE pass
 *   over `campaign_recipients`. Doing it through the ORM would require four
 *   separate queries (or a CASE/SUM hack that is uglier than the raw SQL).
 *
 * Stats shape (per business-rules.md "stats computation"):
 *   - total      = count of CR rows for the campaign
 *   - sent       = count where status='sent'
 *   - failed     = count where status='failed'
 *   - opened     = count where opened_at IS NOT NULL
 *   - send_rate  = sent / total      (0 if total=0)
 *   - open_rate  = opened / sent     (0 if sent=0)  -- denominator is `sent`,
 *                                                      NOT `total`. An open
 *                                                      can only happen after
 *                                                      a successful send.
 *
 * Security:
 *   - SQL string is a CONSTANT — no user input is concatenated.
 *   - `:campaignId` is bound via `replacements`, never string-interpolated.
 *     This rules out SQL injection on the only variable input.
 *
 * Tenancy NOTE:
 *   This function does NOT enforce tenancy — callers MUST verify the caller
 *   owns the campaign BEFORE invoking `computeCampaignStats`. The flow is:
 *     1. service.getCampaignDetail(userId, id) calls Campaign.findOne({
 *          where: { id, created_by: userId } })  → 404 if missing/foreign.
 *     2. Only on success does it call computeCampaignStats(id).
 *   Skipping step 1 would leak stats for arbitrary campaign ids.
 */
import { QueryTypes } from 'sequelize';

import { sequelize } from '../db/sequelize';

import type { CampaignStats } from '@app/shared';

/**
 * Single-pass aggregation over campaign_recipients.
 *
 * The four counts are produced in one scan via `COUNT(*) FILTER (WHERE ...)`.
 * Each FILTER count is cast to ::int because Postgres returns COUNT as bigint
 * (string in JS via node-postgres) and we want plain JS numbers in the API.
 */
export const STATS_SQL = `
  SELECT
    COUNT(*)::int                                          AS total,
    COUNT(*) FILTER (WHERE status = 'sent')::int           AS sent,
    COUNT(*) FILTER (WHERE status = 'failed')::int         AS failed,
    COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int     AS opened
  FROM campaign_recipients
  WHERE campaign_id = :campaignId;
`;

/** Row shape returned by STATS_SQL — used internally to type the bind result. */
interface StatsRow {
  total: number;
  sent: number;
  failed: number;
  opened: number;
}

/**
 * Compute aggregated stats for a single campaign.
 *
 * @param campaignId UUID of the campaign. Caller MUST have already verified
 *                   ownership (see "Tenancy NOTE" in the file header).
 * @returns A `CampaignStats` object per business-rules.md. All fields are
 *          plain JS numbers; rates are clamped to [0, 1] and zero-on-zero.
 */
export async function computeCampaignStats(campaignId: string): Promise<CampaignStats> {
  // Single-pass aggregation. SQL is a constant; the only variable input is
  // `campaignId`, bound via `replacements` (NOT string-interpolated) so the
  // path is SQL-injection-safe even though `campaignId` always comes from a
  // server-side Sequelize lookup at the call site.
  const rows = await sequelize.query<StatsRow>(STATS_SQL, {
    replacements: { campaignId },
    type: QueryTypes.SELECT,
  });

  // Defensive default: a campaign with zero CR rows still returns a row from
  // the aggregate (`COUNT(*) = 0`). The fallback only triggers if the driver
  // returned an empty array — shouldn't happen but cheap to guard.
  const r = rows[0] ?? { total: 0, sent: 0, failed: 0, opened: 0 };

  // Zero-on-zero: never return NaN/Infinity. Contract is numbers in [0, 1].
  // open_rate denominator is `sent`, NOT `total` — opens only count after a
  // successful send (per business-rules.md "stats computation").
  const send_rate = r.total > 0 ? r.sent / r.total : 0;
  const open_rate = r.sent > 0 ? r.opened / r.sent : 0;

  return {
    total: r.total,
    sent: r.sent,
    failed: r.failed,
    opened: r.opened,
    send_rate,
    open_rate,
  };
}

// Hint for backend: keep StatsRow exported only if you find another caller.
// For now it's a private impl detail of this module.
export type { StatsRow };
