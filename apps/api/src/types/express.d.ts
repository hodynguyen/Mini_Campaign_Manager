/**
 * Module augmentation for Express's `Request` type.
 *
 * `requireAuth` middleware (src/auth/middleware.ts) attaches `req.user` after
 * verifying the JWT. This declaration teaches TypeScript about that property
 * so handlers can type-safely read `req.user.id` without `as` casts.
 *
 * The property is OPTIONAL: routes without `requireAuth` mounted in front
 * will receive `req.user === undefined`. Handlers should narrow before use.
 *
 * The trailing `export {}` makes this file a module — required for `declare
 * global` to work under TS's strict module resolution.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; email: string };
    }
  }
}

export {};
