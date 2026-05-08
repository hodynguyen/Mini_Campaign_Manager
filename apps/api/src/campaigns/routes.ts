/**
 * /campaigns router.
 *
 * Endpoints (all behind `requireAuth`, mounted in app.ts):
 *   GET    /campaigns                                   -> 200 { data, meta }
 *   POST   /campaigns                                   -> 201 Campaign
 *   GET    /campaigns/:id                               -> 200 CampaignDetail
 *   PATCH  /campaigns/:id                               -> 200 Campaign (draft-only, else 409)
 *   DELETE /campaigns/:id                               -> 204         (draft-only, else 409)
 *   POST   /campaigns/:id/schedule                      -> 200 Campaign (status=scheduled)
 *   POST   /campaigns/:id/send                          -> 202 { id, status: 'sending' }
 *   POST   /campaigns/:id/recipients/:recipientId/open  -> 204         (idempotent)
 *
 * Mount order: F4 transition + open-track routes come AFTER the `:id`
 * single-resource routes (GET/PATCH/DELETE). Express matches routes in
 * registration order; placing `/:id/schedule` BEFORE `:id` would still work
 * here (Express requires an exact path match per route, not a prefix), but
 * keeping the per-resource and sub-resource routes adjacent is clearer to
 * read and matches the file map in spec-schedule-send.md.
 *
 * Async handlers are wrapped via the shared `asyncHandler` util so any
 * thrown/rejected error reaches the global error handler.
 */
import { Router } from 'express';

import { asyncHandler } from '../utils/asyncHandler';

import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  scheduleCampaign,
  sendCampaign,
  trackOpen,
  updateCampaign,
} from './controller';

const router: Router = Router();

router.get('/', asyncHandler(listCampaigns));
router.post('/', asyncHandler(createCampaign));
router.get('/:id', asyncHandler(getCampaign));
router.patch('/:id', asyncHandler(updateCampaign));
router.delete('/:id', asyncHandler(deleteCampaign));
router.post('/:id/schedule', asyncHandler(scheduleCampaign));
router.post('/:id/send', asyncHandler(sendCampaign));
router.post('/:id/recipients/:recipientId/open', asyncHandler(trackOpen));

export default router;
