/**
 * /campaigns router.
 *
 * Endpoints (all behind `requireAuth`, mounted in app.ts):
 *   GET    /campaigns       -> 200 { data, meta }
 *   POST   /campaigns       -> 201 Campaign
 *   GET    /campaigns/:id   -> 200 CampaignDetail (campaign + stats + recipients)
 *   PATCH  /campaigns/:id   -> 200 Campaign     (only when status='draft', else 409)
 *   DELETE /campaigns/:id   -> 204              (only when status='draft', else 409)
 *
 * Async handlers are wrapped via the shared `asyncHandler` util so any
 * thrown/rejected error reaches the global error handler. F4 will add
 * `/campaigns/:id/schedule` and `/campaigns/:id/send` to this same router.
 */
import { Router } from 'express';

import { asyncHandler } from '../utils/asyncHandler';

import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
} from './controller';

const router: Router = Router();

router.get('/', asyncHandler(listCampaigns));
router.post('/', asyncHandler(createCampaign));
router.get('/:id', asyncHandler(getCampaign));
router.patch('/:id', asyncHandler(updateCampaign));
router.delete('/:id', asyncHandler(deleteCampaign));

export default router;
