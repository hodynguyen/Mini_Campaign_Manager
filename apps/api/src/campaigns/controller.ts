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
  openTrackParamsSchema,
  scheduleSchema,
  updateCampaignSchema,
} from './schema';
import {
  createCampaign as createCampaignSvc,
  deleteCampaign as deleteCampaignSvc,
  getCampaignDetail,
  listCampaigns as listCampaignsSvc,
  scheduleCampaign as scheduleCampaignSvc,
  sendCampaign as sendCampaignSvc,
  trackOpen as trackOpenSvc,
  updateCampaign as updateCampaignSvc,
} from './service';
import { runSendWorker } from './worker';

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

/* ─────────────────────────── F4 transitions ─────────────────────────── */

/**
 * POST /campaigns/:id/schedule — controller skeleton.
 *
 * Pattern (backend fills body):
 *   1. const userId = requireUserId(req);
 *   2. const id     = requireParamId(req);
 *   3. const input  = scheduleSchema.parse(req.body);  // 400 on bad/missing/extra keys
 *   4. const updated = await scheduleCampaignSvc(userId, id, input);
 *   5. res.status(200).json(updated);
 *
 * Response: 200 with the updated `Campaign` DTO (status='scheduled').
 * Errors: 400 VALIDATION_ERROR, 400 SCHEDULED_AT_IN_PAST, 404 CAMPAIGN_NOT_FOUND,
 *         409 CAMPAIGN_NOT_SCHEDULABLE — all routed through the global
 *         errorHandler from the AppError subclasses raised in the service.
 */
export async function scheduleCampaign(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const id = requireParamId(req);
  const input = scheduleSchema.parse(req.body);
  const updated = await scheduleCampaignSvc(userId, id, input);
  res.status(200).json(updated);
}

/**
 * POST /campaigns/:id/send — controller skeleton.
 *
 * Pattern (backend fills body):
 *   1. const userId = requireUserId(req);
 *   2. const id     = requireParamId(req);
 *   3. const result = await sendCampaignSvc(userId, id);  // immediate flip
 *   4. res.status(202).json(result);                       // commit response FIRST
 *   5. setImmediate(() => {
 *        runSendWorker(id).catch((err) => {
 *          // eslint-disable-next-line no-console
 *          console.error('[send-worker]', { id, err });
 *        });
 *      });
 *
 * The `setImmediate` after `res.status(202).json(...)` is load-bearing:
 *   - The JSON response is committed before the worker starts.
 *   - The worker NEVER throws out (caught + logged), but `.catch` is also
 *     applied here as defense-in-depth.
 *   - DO NOT await the worker; awaiting would defeat the async point of
 *     202 Accepted.
 *
 * Response: 202 with `{ id, status: 'sending' }` (matches
 * `SendCampaignResponse` from `@app/shared`).
 * Errors: 404 CAMPAIGN_NOT_FOUND, 409 CAMPAIGN_NOT_SENDABLE.
 */
export async function sendCampaign(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const id = requireParamId(req);
  // Service does the atomic flip ({draft|scheduled} → sending) and either
  // returns { id, status: 'sending' } or throws (404/409). On success, the
  // campaign is already 'sending' in the DB by the time we respond.
  const result = await sendCampaignSvc(userId, id);
  // Commit the response BEFORE kicking the worker. Express flushes the JSON
  // synchronously off `res.status(...).json(...)`, then the next event-loop
  // tick (`setImmediate`) starts the simulated send. DO NOT await — that
  // would defeat the async point of 202 Accepted.
  res.status(202).json(result);
  setImmediate(() => {
    // The worker is `runSendWorker` (production variant) which already
    // catches and logs. The extra `.catch` here is defense-in-depth so a
    // future refactor can't accidentally surface an unhandled rejection.
    runSendWorker(id).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[send-worker]', { id, err });
    });
  });
}

/**
 * POST /campaigns/:id/recipients/:recipientId/open — controller skeleton.
 *
 * Pattern (backend fills body):
 *   1. const userId = requireUserId(req);
 *   2. const params = openTrackParamsSchema.parse(req.params); // 400 on non-UUID
 *   3. await trackOpenSvc(userId, params.id, params.recipientId);
 *   4. res.status(204).end();
 *
 * 204 ALWAYS on the success path — the service silently no-ops on
 * already-opened / non-sent / foreign-tenancy cases (see service.trackOpen
 * JSDoc). The endpoint never reveals whether the row exists or has been
 * opened previously.
 */
export async function trackOpen(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  // Validate BOTH path params as UUIDs at the boundary. A non-UUID would
  // otherwise either match 0 rows (silent 204 — fine, but inconsistent with
  // other routes) or trip a Postgres invalid_text_representation error
  // (500 with driver-internals leak). The schema rejects up front with 400
  // VALIDATION_ERROR, matching every other path-param-validated endpoint.
  const params = openTrackParamsSchema.parse(req.params);
  await trackOpenSvc(userId, params.id, params.recipientId);
  // 204 No Content — always, regardless of affected rows. The service is
  // designed as a silent no-op for already-opened, non-sent, and foreign-
  // tenancy cases. The endpoint never reveals whether the row exists or has
  // been opened previously.
  res.status(204).end();
}
