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
 *
 * Error codes used by this surface (for client pattern-matching):
 *   - CAMPAIGN_NOT_FOUND      → 404
 *   - CAMPAIGN_NOT_EDITABLE   → 409 (PATCH/DELETE on non-draft)
 *   - VALIDATION_ERROR        → 400 (zod, in controller)
 */
import { Campaign } from '../db/models/Campaign';
import { CampaignRecipient } from '../db/models/CampaignRecipient';
import { Recipient } from '../db/models/Recipient';
import { sequelize } from '../db/sequelize';
import { ConflictError, NotFoundError } from '../errors/AppError';

import { computeCampaignStats } from './stats';

import type {
  CreateCampaignInput,
  ListCampaignsQuery,
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
