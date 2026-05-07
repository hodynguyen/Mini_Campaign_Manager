/**
 * Domain error hierarchy.
 *
 * Every error thrown out of services/controllers should be one of these
 * subclasses. The global error handler (`./handler.ts`) maps the class to an
 * HTTP status and serializes `{ code, message, details? }` per the project's
 * uniform error shape (`ApiError` in `@app/shared`).
 *
 * Codes are SCREAMING_SNAKE strings (e.g. `EMAIL_TAKEN`, `INVALID_CREDENTIALS`)
 * — the front end / clients pattern-match on these, NOT on `message`.
 *
 * F2 SCAFFOLD-ONLY: classes are defined; BUILD throws them from auth service
 * and controllers. Do NOT add field-level logic here — keep it a pure
 * data-carrier hierarchy.
 */

export interface AppErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export class AppError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details: unknown;

  constructor(status: number, payload: AppErrorPayload) {
    super(payload.message);
    this.name = new.target.name;
    this.status = status;
    this.code = payload.code;
    this.details = payload.details;
    // Restore prototype chain for `instanceof` after `extends Error` under
    // CommonJS / ES5-targeted output. Standard Node convention.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — request body / params failed validation. */
export class ValidationError extends AppError {
  constructor(payload: AppErrorPayload) {
    super(400, payload);
  }
}

/** 401 — missing/invalid/expired credentials or token. */
export class UnauthorizedError extends AppError {
  constructor(payload: AppErrorPayload) {
    super(401, payload);
  }
}

/** 403 — authenticated but not allowed. (Tenancy uses 404 instead, see business-rules.md.) */
export class ForbiddenError extends AppError {
  constructor(payload: AppErrorPayload) {
    super(403, payload);
  }
}

/** 404 — resource not found OR not visible to this caller (tenancy). */
export class NotFoundError extends AppError {
  constructor(payload: AppErrorPayload) {
    super(404, payload);
  }
}

/** 409 — state conflict (e.g. EMAIL_TAKEN, CAMPAIGN_NOT_EDITABLE). */
export class ConflictError extends AppError {
  constructor(payload: AppErrorPayload) {
    super(409, payload);
  }
}
