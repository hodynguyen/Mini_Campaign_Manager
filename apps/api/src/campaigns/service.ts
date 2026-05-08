/**
 * Campaigns service — business logic + state-machine guards.
 *
 * Tenancy contract (every function takes `userId: string`):
 *   - userId comes from `req.user.id` (populated by `requireAuth`).
 *   - All queries scope by `created_by = userId`.
 *   - Foreign-user access returns 404 (NotFoundError), NOT 403 — see
 *     business-rules.md "Tenancy by created_by". Don't leak existence.
 *
 * State-machine contract:
 *   - `updateCampaign` and `deleteCampaign` only allowed when status='draft'.
 *   - Otherwise throw `ConflictError({ code: 'CAMPAIGN_NOT_EDITABLE' })` → 409.
 *   - `scheduleCampaign` and `sendCampaign` use ATOMIC `UPDATE ... WHERE
 *     status IN (...)` patterns (see F4 ATOMIC_*_SQL constants below) —
 *     closes the F3 find-then-update race by making the state guard a SQL-
 *     level invariant rather than a JS read-modify-write.
 *
 * Error codes used by this surface (for client pattern-matching):
 *   - CAMPAIGN_NOT_FOUND        → 404
 *   - CAMPAIGN_NOT_EDITABLE     → 409 (PATCH/DELETE on non-draft)
 *   - CAMPAIGN_NOT_SCHEDULABLE  → 409 (POST /:id/schedule on non-draft)
 *   - CAMPAIGN_NOT_SENDABLE     → 409 (POST /:id/send on non-{draft,scheduled})
 *   - SCHEDULED_AT_IN_PAST      → 400 (POST /:id/schedule with past time)
 *   - VALIDATION_ERROR          → 400 (zod, in controller)
 */
import { QueryTypes } from 'sequelize';

import { Campaign } from '../db/models/Campaign';
import { CampaignRecipient } from '../db/models/CampaignRecipient';
import { Recipient } from '../db/models/Recipient';
import { sequelize } from '../db/sequelize';
import { ConflictError, NotFoundError, ValidationError } from '../errors/AppError';

import { computeCampaignStats } from './stats';

import type {
  CreateCampaignInput,
  ListCampaignsQuery,
  ScheduleCampaignInput,
  UpdateCampaignInput,
} from './schema';
import type {
  Campaign as CampaignDTO,
  CampaignDetail,
  CampaignRecipientRow,
  CampaignStatus,
  CampaignRecipientStatus,
  PaginatedList,
} from '@app/shared';

/**
 * Map a Sequelize Campaign instance to the wire DTO.
 *
 * Why explicit: Sequelize's default JSON serialization gives us camelCase
 * attributes (`createdAt`, `scheduledAt`) but `@app/shared.Campaign` is
 * snake_case at the wire (matches Postgres column names + the brief). We
 * explicitly pick the public fields and ISO-format the dates.
 *
 * `as CampaignStatus` cast: Sequelize types the ENUM column as a generic
 * string union from `DataTypes.ENUM(...)`; the runtime value is always one of
 * the four allowed states (DB CHECK + Sequelize validation guarantee it).
 */
function toCampaignDTO(c: Campaign): CampaignDTO {
  return {
    id: c.id,
    name: c.name,
    subject: c.subject,
    body: c.body,
    status: c.status as CampaignStatus,
    scheduled_at: c.scheduledAt ? c.scheduledAt.toISOString() : null,
    created_by: c.createdBy,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

/**
 * GET /campaigns — list campaigns owned by `userId`, paginated.
 *
 * Filter: WHERE created_by = :userId AND (status = :status if provided)
 * Sort:   ORDER BY updated_at DESC  (matches list page UX — recent first)
 * Page:   LIMIT :limit OFFSET (:page - 1) * :limit
 *
 * Implementation: `findAndCountAll` issues SELECT + COUNT(*) in two queries
 * but Sequelize batches them into one round-trip. Index
 * `(created_by, updated_at DESC)` from migration 0002 covers both filter +
 * sort.
 */
export async function listCampaigns(
  userId: string,
  query: ListCampaignsQuery,
): Promise<PaginatedList<CampaignDTO>> {
  const { page, limit, status } = query;
  const offset = (page - 1) * limit;

  const { rows, count } = await Campaign.findAndCountAll({
    where: {
      createdBy: userId,
      ...(status ? { status } : {}),
    },
    order: [['updated_at', 'DESC']],
    limit,
    offset,
  });

  return {
    data: rows.map(toCampaignDTO),
    meta: { page, limit, total: count },
  };
}

/**
 * POST /campaigns — create a draft campaign + optionally attach recipients.
 *
 * Atomicity:
 *   Whole flow runs inside one Sequelize-managed transaction. If recipient
 *   upsert or CR insert fails, the campaign row rolls back too — no orphan
 *   campaigns from a partial failure.
 *
 * Recipient upsert strategy (per business-rules.md "Recipient identity by
 * email"):
 *   - Dedupe `recipient_emails` after lowercasing (zod `.email()` already
 *     ran format validation; CITEXT in Postgres also handles case but we
 *     normalize in JS for stable lookup keys + log readability).
 *   - For each unique email, `findOrCreate({ where: { email }, defaults: {...} })`
 *     looks up by the unique index; on miss, inserts with the email-prefix as
 *     the default name (better than blank — caller can edit later via a
 *     /recipients PATCH endpoint when one exists).
 *   - Build CR rows (status='pending', one per resolved recipient) and
 *     `bulkCreate` in a single INSERT. UNIQUE (campaign_id, recipient_id) on
 *     the join table prevents duplicates if the same recipient appears twice
 *     after dedupe (defense-in-depth — shouldn't happen given dedupe).
 */
export async function createCampaign(
  userId: string,
  input: CreateCampaignInput,
): Promise<CampaignDTO> {
  const campaign = await sequelize.transaction(async (t) => {
    const created = await Campaign.create(
      {
        name: input.name,
        subject: input.subject,
        body: input.body,
        createdBy: userId,
        status: 'draft',
      },
      { transaction: t },
    );

    const emails = input.recipient_emails ?? [];
    if (emails.length > 0) {
      // Dedupe + normalize. Sort is incidental but helps deterministic logs.
      const uniqueEmails = Array.from(
        new Set(emails.map((e) => e.toLowerCase().trim())),
      );

      // Resolve each email to a Recipient row (existing or newly created).
      // Sequential await to keep transaction context tidy; recipient_emails
      // is capped at 1000 by the zod schema so we won't pay a meaningful
      // round-trip cost for typical inputs.
      const recipientIds: string[] = [];
      for (const email of uniqueEmails) {
        const [recipient] = await Recipient.findOrCreate({
          where: { email },
          defaults: {
            email,
            // Email prefix as fallback display name. Better than empty
            // string and obvious to the caller (and editable later).
            name: email.split('@')[0] || email,
          },
          transaction: t,
        });
        recipientIds.push(recipient.id);
      }

      // Insert CR rows in one round-trip. ignoreDuplicates guards against the
      // (impossible-after-dedupe) UNIQUE (campaign_id, recipient_id) violation.
      const crRows = recipientIds.map((recipientId) => ({
        campaignId: created.id,
        recipientId,
        status: 'pending' as CampaignRecipientStatus,
      }));
      await CampaignRecipient.bulkCreate(crRows, {
        transaction: t,
        ignoreDuplicates: true,
      });
    }

    return created;
  });

  return toCampaignDTO(campaign);
}

/**
 * GET /campaigns/:id — campaign + nested stats + recipients list.
 *
 * Steps:
 *   1. Tenancy-scoped find by (id, created_by). Foreign campaign → 404.
 *   2. Stats: single SQL aggregate via `computeCampaignStats(id)`.
 *   3. Recipients: join `campaign_recipients` ↔ `recipients` and flatten to
 *      `CampaignRecipientRow` shape (recipient_id, email, name, status,
 *      sent_at, opened_at). Eager-include via the `'recipient'` association
 *      alias defined in `db/associations.ts`.
 *
 * Steps 2 + 3 run in parallel (`Promise.all`) — they don't depend on each
 * other, both filter by `campaign_id = id`.
 */
export async function getCampaignDetail(
  userId: string,
  id: string,
): Promise<CampaignDetail> {
  const campaign = await Campaign.findOne({
    where: { id, createdBy: userId },
  });
  if (!campaign) {
    throw new NotFoundError({
      code: 'CAMPAIGN_NOT_FOUND',
      message: 'Campaign not found',
    });
  }

  const [stats, crRows] = await Promise.all([
    computeCampaignStats(id),
    CampaignRecipient.findAll({
      where: { campaignId: id },
      include: [{ model: Recipient, as: 'recipient', required: true }],
      // Stable order makes the wire shape deterministic (helps the UI
      // render diffs cleanly between polls).
      order: [['id', 'ASC']],
    }),
  ]);

  const recipients: CampaignRecipientRow[] = crRows.map((cr) => {
    // `cr.get('recipient')` returns the eager-loaded Recipient row. Use
    // the typed accessor instead of casting cr to `any`.
    const recipient = cr.get('recipient') as Recipient | undefined;
    return {
      recipient_id: cr.recipientId,
      email: recipient?.email ?? '',
      name: recipient?.name ?? '',
      status: cr.status,
      sent_at: cr.sentAt ? cr.sentAt.toISOString() : null,
      opened_at: cr.openedAt ? cr.openedAt.toISOString() : null,
    };
  });

  return {
    ...toCampaignDTO(campaign),
    stats,
    recipients,
  };
}

/**
 * PATCH /campaigns/:id — update editable fields ONLY when status='draft'.
 *
 * Steps:
 *   1. Find by (id, created_by=userId). 404 if missing (tenancy by 404).
 *   2. If campaign.status !== 'draft' → 409 CAMPAIGN_NOT_EDITABLE.
 *   3. `campaign.update(patch)` — only `name`/`subject`/`body` keys allowed
 *      by the zod `.strict()` schema (rejected at controller boundary).
 *   4. Return updated DTO.
 *
 * Empty patch `{}` is a successful no-op; `update()` still bumps `updated_at`
 * via Sequelize default (which is fine — list ordering naturally surfaces
 * recently-touched campaigns).
 */
export async function updateCampaign(
  userId: string,
  id: string,
  patch: UpdateCampaignInput,
): Promise<CampaignDTO> {
  const campaign = await Campaign.findOne({
    where: { id, createdBy: userId },
  });
  if (!campaign) {
    throw new NotFoundError({
      code: 'CAMPAIGN_NOT_FOUND',
      message: 'Campaign not found',
    });
  }
  if (campaign.status !== 'draft') {
    throw new ConflictError({
      code: 'CAMPAIGN_NOT_EDITABLE',
      message: 'Campaign can only be edited in draft state',
    });
  }

  // Build a "set" with only the keys the caller actually provided. Under
  // `exactOptionalPropertyTypes: true`, Sequelize's `update()` rejects keys
  // whose value is `undefined`. Strip them by re-constructing the object.
  // This also makes the eventual SQL UPDATE smaller (only changed columns).
  const updates: Partial<{ name: string; subject: string; body: string }> = {};
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.subject !== undefined) updates.subject = patch.subject;
  if (patch.body !== undefined) updates.body = patch.body;

  await campaign.update(updates);
  return toCampaignDTO(campaign);
}

/**
 * DELETE /campaigns/:id — only when status='draft'.
 *
 * Steps:
 *   1. Find by (id, created_by=userId). 404 if missing.
 *   2. If status !== 'draft' → 409 CAMPAIGN_NOT_EDITABLE.
 *   3. `campaign.destroy()`. The FK ON DELETE CASCADE on
 *      campaign_recipients.campaign_id (migration 0004) cleans up join rows
 *      automatically — DO NOT manually delete CR rows first.
 */
export async function deleteCampaign(userId: string, id: string): Promise<void> {
  const campaign = await Campaign.findOne({
    where: { id, createdBy: userId },
  });
  if (!campaign) {
    throw new NotFoundError({
      code: 'CAMPAIGN_NOT_FOUND',
      message: 'Campaign not found',
    });
  }
  if (campaign.status !== 'draft') {
    throw new ConflictError({
      code: 'CAMPAIGN_NOT_EDITABLE',
      message: 'Campaign can only be deleted in draft state',
    });
  }
  await campaign.destroy();
}

/* ─────────────────────────── F4 transitions ─────────────────────────── */

/**
 * Atomic UPDATE SQL for `POST /campaigns/:id/schedule`.
 *
 * The `status='draft'` clause IN THE WHERE makes the state guard a SQL-level
 * invariant. There is no read-modify-write window where another transition
 * could slip in between a SELECT and an UPDATE (closes the F3 carry-forward
 * MEDIUM "find-then-update race", documented in tech-debt.md and decisions.md
 * ADR-002 → accepted).
 *
 * Bind params:
 *   :id        UUID of the campaign.
 *   :userId    Tenancy filter (created_by).
 *   :scheduledAt Date (passed via Sequelize replacements; pg adapter
 *               formats Date → timestamptz).
 *
 * Postgres returns "rowCount" via the second tuple element from
 * `sequelize.query(sql, { type: QueryTypes.UPDATE })`. Sequelize 6 typing
 * for that tuple is `[unknown, number]`. The service treats `affectedRows
 * === 1` as success; any other value (0 or, defensively, >1) routes to a
 * follow-up SELECT to distinguish:
 *   - row exists for THIS user but status is wrong → 409 CAMPAIGN_NOT_SCHEDULABLE
 *   - row does NOT exist for this user (foreign or genuinely missing) → 404
 */
export const ATOMIC_SCHEDULE_SQL = `
  UPDATE campaigns
     SET status       = 'scheduled',
         scheduled_at = :scheduledAt,
         updated_at   = NOW()
   WHERE id         = :id
     AND created_by = :userId
     AND status     = 'draft';
`;

/**
 * Atomic UPDATE SQL for `POST /campaigns/:id/send`.
 *
 * Allowed source states per business-rules.md: {draft, scheduled}.
 * The `status IN ('draft','scheduled')` clause is the load-bearing state
 * guard at the SQL level.
 *
 * Same affectedRows-and-fallback-SELECT pattern as ATOMIC_SCHEDULE_SQL.
 * On the success path the SQL flips status to 'sending' and the controller
 * kicks the worker via setImmediate AFTER res.status(202).json(...).
 */
export const ATOMIC_SEND_SQL = `
  UPDATE campaigns
     SET status     = 'sending',
         updated_at = NOW()
   WHERE id         = :id
     AND created_by = :userId
     AND status     IN ('draft', 'scheduled');
`;

/**
 * Atomic UPDATE SQL for `POST /campaigns/:id/recipients/:recipientId/open`.
 *
 * Idempotent: only stamps `opened_at` when it's currently NULL AND the row's
 * `status = 'sent'`. Repeated calls (or calls on pending/failed rows) are
 * silent no-ops — affectedRows = 0 with no error. The endpoint always
 * returns 204 regardless of affectedRows so the caller cannot probe whether
 * a recipient has opened.
 *
 * Tenancy is enforced via the `INNER JOIN campaigns ... WHERE created_by =
 * :userId` clause — a foreign user's open call against a real cr id finds
 * zero rows to update (NOT a row-level error) and silently no-ops, which is
 * indistinguishable from "already opened" or "wrong status". No existence
 * leak.
 *
 * Bind params:
 *   :campaignId   UUID of the campaign.
 *   :recipientId  UUID of the recipient.
 *   :userId       Tenancy filter (campaigns.created_by).
 */
export const ATOMIC_OPEN_TRACK_SQL = `
  UPDATE campaign_recipients cr
     SET opened_at = NOW()
    FROM campaigns c
   WHERE cr.campaign_id  = c.id
     AND c.id            = :campaignId
     AND c.created_by    = :userId
     AND cr.recipient_id = :recipientId
     AND cr.status       = 'sent'
     AND cr.opened_at    IS NULL;
`;

/**
 * POST /campaigns/:id/schedule — flip draft → scheduled atomically.
 *
 * Steps:
 *   1. Server-clock check: parse `scheduled_at` (ISO already validated by
 *      zod). If `<= Date.now()` (server clock), throw ValidationError with
 *      code `SCHEDULED_AT_IN_PAST` (400). zod can't enforce future-time
 *      because it has no clock.
 *   2. Run ATOMIC_SCHEDULE_SQL with bind { id, userId, scheduledAt: Date }
 *      via `sequelize.query(SQL, { type: QueryTypes.UPDATE, replacements })`.
 *      Returns `[unknown, affectedRows]`.
 *   3. If affectedRows === 1: re-fetch the row via
 *      `Campaign.findOne({ where: { id, createdBy: userId } })` and return
 *      `toCampaignDTO`. (Postgres `UPDATE ... RETURNING` is an alternative
 *      but Sequelize's typing for the RETURNING tuple is awkward; a
 *      follow-up SELECT is simpler and still tenancy-safe.)
 *   4. If affectedRows === 0: distinguish 404 vs 409 via a follow-up SELECT.
 *      `Campaign.findOne({ where: { id, createdBy: userId } })`:
 *        - missing → throw NotFoundError({ code: 'CAMPAIGN_NOT_FOUND' }).
 *        - present → throw ConflictError({ code: 'CAMPAIGN_NOT_SCHEDULABLE',
 *                                         message: 'Campaign can only be scheduled from draft' }).
 *
 * Failure modes:
 *   - SCHEDULED_AT_IN_PAST    → 400 (server-clock guard).
 *   - CAMPAIGN_NOT_FOUND      → 404 (id miss / foreign user / wrong tenant).
 *   - CAMPAIGN_NOT_SCHEDULABLE → 409 (campaign exists but status != 'draft').
 *
 * @param userId      Authenticated user id (from `req.user.id`).
 * @param id          Campaign id (UUID; validated upstream by route or
 *                    falls through to NOT_FOUND if non-UUID).
 * @param input       `{ scheduled_at: string }` already zod-validated to ISO.
 * @returns           Updated `Campaign` DTO with status='scheduled'.
 */
export async function scheduleCampaign(
  userId: string,
  id: string,
  input: ScheduleCampaignInput,
): Promise<CampaignDTO> {
  // 1. Server-clock future-time check. zod validated the literal ISO format
  // upstream; the future-time invariant lives here because zod has no clock.
  const scheduledAt = new Date(input.scheduled_at);
  if (scheduledAt.getTime() <= Date.now()) {
    throw new ValidationError({
      code: 'SCHEDULED_AT_IN_PAST',
      message: 'scheduled_at must be in the future',
    });
  }

  // 2. Atomic UPDATE — `WHERE status='draft'` is the load-bearing state guard.
  // Sequelize 6 returns `[unknown, number]` for a QueryTypes.UPDATE;
  // destructure the affected-row count from the second slot.
  const [, affectedRows] = await sequelize.query(ATOMIC_SCHEDULE_SQL, {
    replacements: { id, userId, scheduledAt },
    type: QueryTypes.UPDATE,
  });

  if (affectedRows === 1) {
    // Re-fetch via the tenancy-scoped finder. Non-null by construction (the
    // UPDATE just succeeded for this same id+userId).
    const campaign = await Campaign.findOne({ where: { id, createdBy: userId } });
    return toCampaignDTO(campaign!);
  }

  // 3. affectedRows === 0 → distinguish 404 vs 409 via a follow-up SELECT.
  // The follow-up SELECT is tenancy-scoped (same created_by filter) so it
  // never leaks the existence of a foreign campaign.
  const existing = await Campaign.findOne({ where: { id, createdBy: userId } });
  if (!existing) {
    throw new NotFoundError({
      code: 'CAMPAIGN_NOT_FOUND',
      message: 'Campaign not found',
    });
  }
  throw new ConflictError({
    code: 'CAMPAIGN_NOT_SCHEDULABLE',
    message: 'Campaign can only be scheduled from draft',
  });
}

/**
 * POST /campaigns/:id/send — flip {draft|scheduled} → sending atomically.
 *
 * Returns IMMEDIATELY with `{ id, status: 'sending' }` (HTTP 202). The
 * worker is kicked from the **controller** via:
 *
 *   const result = await sendCampaign(userId, id);
 *   res.status(202).json(result);
 *   setImmediate(() => {
 *     runSendWorker(id).catch((err) => console.error('[send-worker]', err));
 *   });
 *
 * (The setImmediate lives in the CONTROLLER, not here. Keeping the service
 * pure means a test that imports the service can await `runSendWorker(id)`
 * directly via the awaitable test variant — see worker.ts.)
 *
 * Steps:
 *   1. Run ATOMIC_SEND_SQL with bind { id, userId } via
 *      `sequelize.query(SQL, { type: QueryTypes.UPDATE, replacements })`.
 *   2. If affectedRows === 1: return `{ id, status: 'sending' }` synchronously.
 *   3. If affectedRows === 0: distinguish 404 vs 409 via a follow-up SELECT.
 *      `Campaign.findOne({ where: { id, createdBy: userId } })`:
 *        - missing → throw NotFoundError({ code: 'CAMPAIGN_NOT_FOUND' }).
 *        - present → throw ConflictError({ code: 'CAMPAIGN_NOT_SENDABLE',
 *                                         message: 'Campaign can only be sent from draft or scheduled' }).
 *
 * Failure modes:
 *   - CAMPAIGN_NOT_FOUND     → 404.
 *   - CAMPAIGN_NOT_SENDABLE  → 409.
 *
 * @returns `{ id, status: 'sending' }` — the DTO mirrors
 *          `SendCampaignResponse` from `@app/shared`.
 */
export async function sendCampaign(
  userId: string,
  id: string,
): Promise<{ id: string; status: 'sending' }> {
  // Atomic UPDATE — `WHERE status IN ('draft','scheduled')` is the load-
  // bearing state guard. The worker is kicked from the CONTROLLER via
  // setImmediate AFTER res.json(202) — keeping the service pure means tests
  // can await `runSendWorkerForTests(id)` directly for deterministic
  // sequencing.
  const [, affectedRows] = await sequelize.query(ATOMIC_SEND_SQL, {
    replacements: { id, userId },
    type: QueryTypes.UPDATE,
  });

  if (affectedRows === 1) {
    return { id, status: 'sending' };
  }

  // 404 vs 409 via tenancy-scoped follow-up SELECT (no existence leak).
  const existing = await Campaign.findOne({ where: { id, createdBy: userId } });
  if (!existing) {
    throw new NotFoundError({
      code: 'CAMPAIGN_NOT_FOUND',
      message: 'Campaign not found',
    });
  }
  throw new ConflictError({
    code: 'CAMPAIGN_NOT_SENDABLE',
    message: 'Campaign can only be sent from draft or scheduled',
  });
}

/**
 * POST /campaigns/:id/recipients/:recipientId/open — stamp `opened_at`.
 *
 * Idempotent + silent — the endpoint ALWAYS returns 204, regardless of
 * affectedRows. This is intentional:
 *   - "Already opened" → no-op (opened_at remains the original timestamp).
 *   - "Recipient is pending/failed" → no-op (opens only count after sent).
 *   - "Foreign user / wrong campaign / unknown recipient" → no-op.
 *
 * The third case is the auth-tenancy guard. Returning 404 there would let a
 * caller probe whether a campaign/recipient pair exists. The atomic SQL
 * embeds the `created_by = :userId` filter, so a foreign call simply
 * affects 0 rows, indistinguishable from "already opened". No information
 * leak.
 *
 * Steps:
 *   1. Run ATOMIC_OPEN_TRACK_SQL with bind { campaignId, recipientId, userId }
 *      via `sequelize.query(SQL, { type: QueryTypes.UPDATE, replacements })`.
 *   2. Discard affectedRows. Return undefined; controller responds 204.
 *
 * Failure modes:
 *   - VALIDATION_ERROR (non-UUID params) → 400 (zod path in controller).
 *   - Any DB error                       → 500 (handled by errorHandler).
 *   - All other "no-op" cases            → 204 with no body.
 */
export async function trackOpen(
  userId: string,
  campaignId: string,
  recipientId: string,
): Promise<void> {
  // Single atomic UPDATE — the SQL embeds the tenancy join (created_by) and
  // the idempotency guards (status='sent' AND opened_at IS NULL). Any
  // mismatch (foreign user, wrong status, already opened) just affects 0
  // rows; the endpoint silently no-ops with 204. Discard affectedRows.
  await sequelize.query(ATOMIC_OPEN_TRACK_SQL, {
    replacements: { campaignId, recipientId, userId },
    type: QueryTypes.UPDATE,
  });
}
