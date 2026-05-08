/**
 * Campaigns controllers — the HTTP-aware layer.
 *
 * Pattern (mirrors `auth/controller.ts`):
 *   1. Parse `req.body` / `req.query` with the relevant zod schema.
 *      A ZodError bubbles to `errors/handler.ts` → 400 VALIDATION_ERROR.
 *   2. Delegate to the service for the actual work.
 *   3. Serialize JSON. The service already returns DTOs in wire shape
 *      (snake_case, ISO date strings) — no re-mapping here.
 *
 * Auth: every handler runs behind `requireAuth` (mounted in app.ts), so
 * `req.user.id` is always populated when these handlers run.
 */
import type { Request, Response } from 'express';

import { NotFoundError, UnauthorizedError } from '../errors/AppError';

import {
  createCampaignSchema,
  listQuerySchema,
  updateCampaignSchema,
} from './schema';
import {
  createCampaign as createCampaignSvc,
  deleteCampaign as deleteCampaignSvc,
  getCampaignDetail,
  listCampaigns as listCampaignsSvc,
  updateCampaign as updateCampaignSvc,
} from './service';

/**
 * Pull the authenticated user id off the request. `requireAuth` is mounted in
 * front of every route in this surface, so `req.user` is populated. The guard
 * here is defense-in-depth — if a future refactor mounts a route without
 * auth, this will surface the bug as a 401 instead of dereferencing
 * `undefined`.
 */
function requireUserId(req: Request): string {
  const userId = req.user?.id;
  if (!userId) {
    throw new UnauthorizedError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  }
  return userId;
}

/**
 * Pull `:id` off `req.params`. Under `noUncheckedIndexedAccess`, Express types
 * `req.params.id` as `string | undefined`. The route only matches when `:id`
 * is present in the URL, so the `undefined` branch is unreachable in practice
 * — but TypeScript doesn't know that. We narrow here and surface a 404 if it
 * ever fires (instead of letting the service receive an undefined id).
 */
function requireParamId(req: Request): string {
  const id = req.params['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new NotFoundError({
      code: 'CAMPAIGN_NOT_FOUND',
      message: 'Campaign not found',
    });
  }
  return id;
}

export async function listCampaigns(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const query = listQuerySchema.parse(req.query);
  const result = await listCampaignsSvc(userId, query);
  res.status(200).json(result);
}

export async function createCampaign(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const input = createCampaignSchema.parse(req.body);
  const campaign = await createCampaignSvc(userId, input);
  res.status(201).json(campaign);
}

export async function getCampaign(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  // No zod schema for the path param — Sequelize `WHERE id = :uuid` simply
  // returns null for a non-UUID input, and the service maps null → 404
  // CAMPAIGN_NOT_FOUND. Same path as a real 404, no existence leak.
  const id = requireParamId(req);
  const detail = await getCampaignDetail(userId, id);
  res.status(200).json(detail);
}

export async function updateCampaign(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  // .strict() in updateCampaignSchema rejects status/scheduled_at/created_by
  // injection with VALIDATION_ERROR. This is the load-bearing security guard
  // for the state-machine — see schema.ts.
  const patch = updateCampaignSchema.parse(req.body);
  const id = requireParamId(req);
  const updated = await updateCampaignSvc(userId, id, patch);
  res.status(200).json(updated);
}

export async function deleteCampaign(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const id = requireParamId(req);
  await deleteCampaignSvc(userId, id);
  // 204 No Content — empty body, no JSON.
  res.status(204).end();
}
