/**
 * Recipients controllers — the HTTP-aware layer.
 *
 * Same pattern as `auth/controller.ts` and `campaigns/controller.ts`:
 *   1. Parse with zod (ZodError → 400 VALIDATION_ERROR via global handler).
 *   2. Delegate to service (which already returns wire-shape DTOs).
 *   3. JSON the result.
 *
 * Auth: every handler runs behind `requireAuth`. Recipients are tenant-shared
 * (ADR-012), so we don't pull `req.user.id` here — auth's only job for this
 * surface is to gate access to authenticated users.
 */
import type { Request, Response } from 'express';

import { createRecipientSchema, listRecipientsQuerySchema } from './schema';
import {
  createRecipient as createRecipientSvc,
  listRecipients as listRecipientsSvc,
} from './service';

export async function listRecipients(req: Request, res: Response): Promise<void> {
  const query = listRecipientsQuerySchema.parse(req.query);
  const result = await listRecipientsSvc(query);
  res.status(200).json(result);
}

export async function createRecipient(req: Request, res: Response): Promise<void> {
  const input = createRecipientSchema.parse(req.body);
  const recipient = await createRecipientSvc(input);
  res.status(201).json(recipient);
}
