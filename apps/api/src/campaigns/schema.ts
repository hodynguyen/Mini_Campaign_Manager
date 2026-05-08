/**
 * Zod schemas for the /campaigns/* surface.
 *
 * Schemas live HERE (in apps/api), NOT in @app/shared — see ADR-009. Pure TS
 * types in @app/shared mirror these schemas via the request/response interfaces
 * (`CreateCampaignRequest`, `UpdateCampaignRequest`, etc.).
 *
 * `.strict()` is applied where rejecting unknown keys is a security or
 * correctness invariant — most importantly on PATCH, where it prevents
 * `status`, `scheduled_at`, and `created_by` from sneaking through (those
 * fields transition only via dedicated F4 endpoints or are tenancy-locked).
 *
 * SCAFFOLD-ONLY: schemas are authored; backend wires them into the controller
 * via `schema.parse(req.body)` / `schema.parse(req.query)`. Validation errors
 * are caught by `errors/handler.ts` and mapped to 400 VALIDATION_ERROR.
 */
import { z } from 'zod';

/**
 * Body limits:
 *   - name:     1-120 chars (TEXT in DB; product copy says "campaign title")
 *   - subject:  1-200 chars (matches typical email subject-line max)
 *   - body:     1-10000 chars (sane upper bound for plain-text email body)
 *   - recipient_emails: 0-1000 entries (single transaction sanity cap)
 *
 * `.trim()` runs BEFORE the length check so " name " becomes "name" first.
 * Empty-after-trim is rejected by `.min(1)`.
 */
const NAME_MIN = 1;
const NAME_MAX = 120;
const SUBJECT_MIN = 1;
const SUBJECT_MAX = 200;
const BODY_MIN = 1;
const BODY_MAX = 10_000;
const RECIPIENT_EMAILS_MAX = 1000;

/**
 * POST /campaigns body.
 *
 * `.strict()` rejects unknown keys → 400 VALIDATION_ERROR. Prevents callers
 * from passing `status: 'sent'` or `created_by: '<other-user-id>'` and having
 * Sequelize silently accept it.
 */
export const createCampaignSchema = z
  .object({
    name: z.string().trim().min(NAME_MIN).max(NAME_MAX),
    subject: z.string().trim().min(SUBJECT_MIN).max(SUBJECT_MAX),
    body: z.string().min(BODY_MIN).max(BODY_MAX),
    // Optional. When provided, attach existing-or-upserted Recipients to the
    // new campaign as CampaignRecipient rows with status='pending'. Empty
    // array is allowed — caller may choose to add recipients later.
    recipient_emails: z
      .array(z.string().email())
      .max(RECIPIENT_EMAILS_MAX)
      .optional(),
  })
  .strict();

/**
 * PATCH /campaigns/:id body.
 *
 * Only `name`, `subject`, `body` are editable. `.strict()` enforces that
 * `status`, `scheduled_at`, `created_by`, and any other key are rejected with
 * 400 VALIDATION_ERROR. Status only changes via dedicated F4 endpoints
 * (`POST /:id/schedule`, `POST /:id/send`).
 *
 * `.partial()` makes every key optional — caller may PATCH any subset.
 * Empty body `{}` is allowed (no-op update).
 */
export const updateCampaignSchema = z
  .object({
    name: z.string().trim().min(NAME_MIN).max(NAME_MAX),
    subject: z.string().trim().min(SUBJECT_MIN).max(SUBJECT_MAX),
    body: z.string().min(BODY_MIN).max(BODY_MAX),
  })
  .partial()
  .strict();

/**
 * Allowed campaign status values. Used by listQuerySchema's `status` filter.
 * Must match the Postgres `campaign_status` ENUM exactly.
 */
const campaignStatusSchema = z.enum(['draft', 'scheduled', 'sending', 'sent']);

/**
 * GET /campaigns query string.
 *
 * Defaults: page=1, limit=20. Limit capped at 100 (DOS guard).
 * `coerce.number()` turns the inbound string ("1") into a JS number.
 * `.int().positive()` ensures negative/decimal/NaN inputs are rejected.
 *
 * `status` is optional; when omitted, no filter is applied.
 */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: campaignStatusSchema.optional(),
});

// Type exports — `z.infer` produces API-internal types. Web-facing types come
// from `@app/shared`; these are for controller/service signatures only.
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type ListCampaignsQuery = z.infer<typeof listQuerySchema>;
