/**
 * /auth router.
 *
 * Endpoints:
 *   POST /auth/register  -> 201 User (no token, no password_hash)
 *   POST /auth/login     -> 200 { token, user }
 *
 * Async handler wrapping:
 *   Express 4 does not auto-forward Promise rejections to error middleware
 *   (Express 5 will). The shared `asyncHandler` util in `../utils/asyncHandler`
 *   wraps each controller so rejections flow through `next(err)` to the
 *   global error handler. F3 extracted that helper out of this file so other
 *   routers (`/campaigns`, `/recipients`) can share it — see `utils/asyncHandler.ts`.
 */
import { Router } from 'express';

import { asyncHandler } from '../utils/asyncHandler';

import { login, register } from './controller';

const router: Router = Router();

router.post('/register', asyncHandler(register));
router.post('/login', asyncHandler(login));

export default router;
