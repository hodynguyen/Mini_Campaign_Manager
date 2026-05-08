/**
 * Zod schemas for the /recipients/* surface.
 *
 * Recipients are tenant-shared (ADR-012) — schemas don't carry a `created_by`.
 *
 * SCAFFOLD-ONLY: backend wires these into recipient/controller via
 * `schema.parse(req.body)` / `schema.parse(req.query)`.
 */
import { z } from 'zod';

const NAME_MIN = 1;
const NAME_MAX = 120;
const SEARCH_MAX = 200;

/**
 * POST /recipients body.
 *
 * Email is normalized:
 *   - `.toLowerCase()` produces stable lookup keys (CITEXT in DB also handles
 *     this, but normalizing in JS makes the upsert path explicit and lets us
 *     log/debug consistent values).
 *   - `.trim()` strips whitespace before email-format validation.
 *
 * `.strict()` rejects unknown keys (e.g. `created_by` injection attempts).
 */
export const createRecipientSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    name: z.string().trim().min(NAME_MIN).max(NAME_MAX),
  })
  .strict();

/**
 * GET /recipients query string.
 *
 * Defaults: page=1, limit=50 (recipient lists are typically larger than
 * campaigns). Limit capped at 100.
 *
 * `search` is an optional substring filter against `email` or `name`. Backend
 * implements via `WHERE email ILIKE :pattern OR name ILIKE :pattern`. Trim +
 * length cap prevent pathological regex-equivalent loads.
 */
export const listRecipientsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(SEARCH_MAX).optional(),
});

export type CreateRecipientInput = z.infer<typeof createRecipientSchema>;
export type ListRecipientsQuery = z.infer<typeof listRecipientsQuerySchema>;
