/**
 * @app/shared — shared TypeScript types and DTOs across @app/api and @app/web.
 *
 * F2 (auth) populated the auth surface. F3 adds Campaign / Recipient DTOs.
 *
 * IMPORTANT — type-only file:
 *   - Do NOT import `zod` here. Zod schemas live in `apps/api/src/{campaigns,recipients,schemas}`
 *     because the api owns request validation; the web app consumes the
 *     inferred shapes through these pure interfaces. See ADR-009.
 *   - This keeps @app/shared free of any runtime, so it works under both ESM
 *     (web, Vite) and CJS (api, ts-jest) without extra build/transpile.
 */

/* ────────────────────────────── Auth ────────────────────────────── */

/**
 * User as returned by /auth/register and embedded in /auth/login response.
 * Note: NO `password_hash`, NO `updated_at` — those are server-side concerns.
 * `created_at` is ISO 8601 — Sequelize / Express JSON serializes Date this way.
 */
export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

/** POST /auth/register body. */
export interface RegisterRequest {
  email: string;
  name: string;
  password: string;
}

/** POST /auth/login body. */
export interface LoginRequest {
  email: string;
  password: string;
}

/** POST /auth/login response (200). */
export interface AuthResponse {
  token: string;
  user: User;
}

/* ──────────────────────────── Campaigns ─────────────────────────── */

/**
 * Campaign status enum — must match Postgres `campaign_status` and the
 * Sequelize `Campaign.status` ENUM column exactly.
 *   draft     — created, editable, deletable.
 *   scheduled — `scheduled_at` set; F4 worker will pick up at that time.
 *   sending   — F4 send job in progress.
 *   sent      — terminal; once here, no transitions allowed.
 */
export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent';

/**
 * Per-recipient send state. Set by the F4 sender (random ~80/20 sent/failed).
 *   pending — created with the campaign; not yet attempted.
 *   sent    — recipient was processed successfully.
 *   failed  — recipient was processed but the simulated send failed.
 */
export type CampaignRecipientStatus = 'pending' | 'sent' | 'failed';

/**
 * Campaign as serialized over the wire. ISO 8601 strings for date columns
 * (Sequelize / Express JSON.stringify produces this for `Date`).
 *
 * `scheduled_at` is null until F4 sets it via `POST /campaigns/:id/schedule`.
 */
export interface Campaign {
  id: string;
  name: string;
  subject: string;
  body: string;
  status: CampaignStatus;
  scheduled_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/**
 * Recipient row (global lookup; no `created_by` per ADR-012).
 * `email` is stored CITEXT but exposed as a normal string here.
 */
export interface Recipient {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

/**
 * One recipient row inside `CampaignDetail.recipients[]` — flattens the
 * recipient identity (email/name) with the per-recipient send state from
 * `campaign_recipients`. The two are joined for the wire shape so the UI
 * doesn't have to merge them.
 */
export interface CampaignRecipientRow {
  recipient_id: string;
  email: string;
  name: string;
  status: CampaignRecipientStatus;
  sent_at: string | null;
  opened_at: string | null;
}

/**
 * Aggregated stats for a single campaign — produced by `computeCampaignStats`
 * (see `apps/api/src/campaigns/stats.ts`) in one SQL round-trip, no N+1.
 *
 * Rates are in [0, 1]. By contract:
 *   - `send_rate` = sent / total      (0 when total = 0)
 *   - `open_rate` = opened / sent     (0 when sent  = 0)
 * Denominator for `open_rate` is `sent`, NOT `total`. Defensive against
 * NaN: callers must zero-on-zero, never return Infinity / NaN.
 */
export interface CampaignStats {
  total: number;
  sent: number;
  failed: number;
  opened: number;
  open_rate: number;
  send_rate: number;
}

/**
 * `GET /campaigns/:id` response shape. Extends `Campaign` with nested stats
 * + recipient list. Single endpoint avoids a 1+N round-trip from the UI.
 */
export interface CampaignDetail extends Campaign {
  stats: CampaignStats;
  recipients: CampaignRecipientRow[];
}

/** `POST /campaigns` request body. */
export interface CreateCampaignRequest {
  name: string;
  subject: string;
  body: string;
  /** Optional: if provided, recipients are upserted by email and attached. */
  recipient_emails?: string[];
}

/**
 * `PATCH /campaigns/:id` request body. Only these three fields are editable;
 * `status`, `scheduled_at`, `created_by` are tenancy/state-machine locked
 * and rejected by the zod `.strict()` schema with 400 VALIDATION_ERROR.
 */
export interface UpdateCampaignRequest {
  name?: string;
  subject?: string;
  body?: string;
}

/**
 * Generic paginated list envelope. Used by `GET /campaigns` and
 * `GET /recipients`. Offset-based (page/limit) — matches the brief's
 * "pagination or infinite scroll" requirement; cursor pagination is overkill
 * for the assignment.
 */
export interface PaginatedList<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
  };
}

/* ───────────────────────── Error envelope ───────────────────────── */

/**
 * Uniform error response shape from the API. Codes are SCREAMING_SNAKE
 * strings; clients pattern-match on `error.code`, NEVER on `error.message`.
 *
 * Examples (F2):
 *   { error: { code: 'VALIDATION_ERROR', message: '...', details: [...] } }
 *   { error: { code: 'EMAIL_TAKEN', message: 'Email already in use' } }
 *   { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } }
 *   { error: { code: 'TOKEN_EXPIRED', message: 'Token expired' } }
 */
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
