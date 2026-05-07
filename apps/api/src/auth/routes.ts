/**
 * /auth router.
 *
 * Endpoints:
 *   POST /auth/register  -> 201 User (no token, no password_hash)
 *   POST /auth/login     -> 200 { token, user }
 *
 * Async handler wrapping:
 *   Express 4 does not auto-forward Promise rejections to error middleware
 *   (Express 5 will). Rather than pull in `express-async-errors` for one
 *   monkey-patch, we wrap each async controller in a 5-line `asyncHandler`
 *   that catches and forwards via `next(err)`. The global error handler
 *   then maps domain errors to HTTP responses.
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';

import { login, register } from './controller';

/**
 * Wrap an async (req,res,next)->Promise handler so a thrown/rejected promise
 * is forwarded to Express's error middleware via `next(err)` instead of
 * crashing the process or hanging the request.
 */
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const router: Router = Router();

router.post('/register', asyncHandler(register));
router.post('/login', asyncHandler(login));

export default router;
