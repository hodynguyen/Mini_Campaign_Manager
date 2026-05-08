/**
 * /recipients router.
 *
 * Endpoints (all behind `requireAuth`, mounted in app.ts):
 *   GET    /recipients   -> 200 { data, meta } (paginated, optional ?search=)
 *   POST   /recipients   -> 201 Recipient
 *
 * No PATCH/DELETE in F3 — recipients are tenant-shared (ADR-012); a delete
 * endpoint would require ownership semantics we don't have, and edits are
 * deferred. The UNIQUE (email) constraint already ensures POST is
 * idempotent-friendly (409 RECIPIENT_EMAIL_TAKEN on dup).
 */
import { Router } from 'express';

import { asyncHandler } from '../utils/asyncHandler';

import { createRecipient, listRecipients } from './controller';

const router: Router = Router();

router.get('/', asyncHandler(listRecipients));
router.post('/', asyncHandler(createRecipient));

export default router;
