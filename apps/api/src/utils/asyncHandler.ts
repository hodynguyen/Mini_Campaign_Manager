/**
 * `asyncHandler` — Express 4 promise-rejection forwarder.
 *
 * Express 4's built-in error dispatch only catches synchronous throws and
 * `next(err)` calls. A rejected Promise from an async controller would crash
 * the process or hang the request. Express 5 fixes this natively, but we are
 * on 4.x.
 *
 * Two options on the table when this was first introduced (F2):
 *   1. `express-async-errors` — monkey-patches Express. One global side-effect
 *      import. Considered, then rejected: the patch silently mutates Router
 *      and Layer prototypes, which makes failure modes harder to reason about
 *      and ties us to that package's compatibility with future Express releases.
 *   2. A 5-line wrapper that catches and forwards via `next(err)`. Zero new
 *      dependencies, no global mutation, trivially auditable. We chose this.
 *
 * F3 promotes the helper from `auth/routes.ts` to a shared util so the new
 * `/campaigns` and `/recipients` routers can reuse it without copy-paste. The
 * implementation is byte-identical to the original — pulling it out is purely
 * a DRY refactor; existing F2 tests still exercise the same behavior.
 *
 * Usage:
 *   import { asyncHandler } from '../utils/asyncHandler';
 *   router.get('/', asyncHandler(myAsyncController));
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wrap an async (req,res,next)->Promise handler so a thrown/rejected promise
 * is forwarded to Express's error middleware via `next(err)` instead of
 * crashing the process or hanging the request.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
