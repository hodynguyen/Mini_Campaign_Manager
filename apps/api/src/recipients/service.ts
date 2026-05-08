/**
 * Recipients service — global lookup, no per-tenant scope.
 *
 * Recipients are tenant-shared (ADR-012) — there's no `created_by` on the
 * `recipients` table. Any authenticated user can list/create. Authentication
 * is still enforced (router mounts behind `requireAuth`); we just don't
 * filter by user.
 *
 * Error codes used by this surface:
 *   - VALIDATION_ERROR      → 400 (zod, in controller)
 *   - RECIPIENT_EMAIL_TAKEN → 409 (UniqueConstraintError on email)
 */
import { Op, UniqueConstraintError } from 'sequelize';

import { Recipient } from '../db/models/Recipient';
import { ConflictError } from '../errors/AppError';

import type { CreateRecipientInput, ListRecipientsQuery } from './schema';
import type { PaginatedList, Recipient as RecipientDTO } from '@app/shared';

/**
 * Map a Sequelize Recipient instance to the wire DTO. Strips internal-only
 * fields (none today, but keeps the boundary explicit) and ISO-formats the
 * timestamp.
 */
function toRecipientDTO(r: Recipient): RecipientDTO {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    created_at: r.createdAt.toISOString(),
  };
}

/**
 * GET /recipients — list all recipients (NO tenant scope), paginated.
 *
 * - Filter (optional): `email ILIKE :pattern OR name ILIKE :pattern` when
 *   `query.search` is provided. Pattern is `%search%`. Postgres CITEXT on
 *   `email` makes `ILIKE` redundant for case but consistent for UX.
 * - Sort: `ORDER BY created_at DESC` (newest first).
 * - Page: `LIMIT :limit OFFSET (:page - 1) * :limit`.
 */
export async function listRecipients(
  query: ListRecipientsQuery,
): Promise<PaginatedList<RecipientDTO>> {
  const { page, limit, search } = query;
  const offset = (page - 1) * limit;

  // Sequelize ILIKE is implemented via Op.iLike. Search pattern is escaped
  // by the driver — never string-interpolate user input.
  const where = search
    ? {
        [Op.or]: [
          { email: { [Op.iLike]: `%${search}%` } },
          { name: { [Op.iLike]: `%${search}%` } },
        ],
      }
    : {};

  const { rows, count } = await Recipient.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit,
    offset,
  });

  return {
    data: rows.map(toRecipientDTO),
    meta: { page, limit, total: count },
  };
}

/**
 * POST /recipients — create a recipient.
 *
 * - Email is already lowercased + trimmed by the zod schema.
 * - On `UniqueConstraintError` (Postgres 23505 on `recipients.email`),
 *   rethrow as `ConflictError({ code: 'RECIPIENT_EMAIL_TAKEN' })` → 409.
 *   Pattern matches the `EMAIL_TAKEN` flow in `auth/service.ts` for
 *   consistency.
 *
 * This endpoint creates a STANDALONE recipient row — it does NOT attach to
 * any campaign. Campaign attachment happens via `POST /campaigns` with
 * `recipient_emails` (or via a future "add recipient" endpoint when needed).
 */
export async function createRecipient(input: CreateRecipientInput): Promise<RecipientDTO> {
  try {
    const created = await Recipient.create({
      email: input.email,
      name: input.name,
    });
    return toRecipientDTO(created);
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError({
        code: 'RECIPIENT_EMAIL_TAKEN',
        message: 'Recipient with this email already exists',
      });
    }
    throw err;
  }
}
