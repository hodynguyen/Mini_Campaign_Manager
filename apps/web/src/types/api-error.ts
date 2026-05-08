/**
 * F5 — Frontend error mapping.
 *
 * The backend returns errors uniformly as `{ error: { code, message, details? } }`
 * (see `ApiError` in `@app/shared`). The wire `code` is the STABLE contract;
 * messages may evolve. **All UI branching MUST pattern-match on `error.code`,
 * never on `error.message`** (per F4 carry-forward note + spec §UX requirements).
 *
 * `ERROR_MESSAGES` translates the known error codes the backend can emit (per
 * `api-contracts.md` and `apps/api/src/errors/AppError.ts`) to user-facing
 * copy. Codes not in the map fall back to either the API's `message` or a
 * generic literal — never to a stack trace or a code string.
 *
 * Frontend pages should call `messageFor(err.code, err.message)` to get the
 * right user-readable string for an `<Alert>` / `notification.error` body.
 */

import type { ApiError } from '@app/shared';

// Re-export so pages/components import the type from a single place.
export type { ApiError };

/**
 * Type guard for axios error responses that carry our uniform ApiError envelope.
 * Use after `axios.isAxiosError(err)` in catch blocks:
 *
 *   if (axios.isAxiosError(err) && isApiErrorResponse(err.response?.data)) {
 *     const code = err.response.data.error.code;
 *     ...
 *   }
 */
export function isApiErrorResponse(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  const e = (value as { error?: unknown }).error;
  if (typeof e !== 'object' || e === null) return false;
  return typeof (e as { code?: unknown }).code === 'string';
}

/**
 * Authoritative error code -> user message map.
 *
 * Codes sourced from:
 *  - `apps/api/src/errors/AppError.ts` (ValidationError, NotFoundError, etc.)
 *  - `apps/api/src/auth/service.ts` (EMAIL_TAKEN, INVALID_CREDENTIALS)
 *  - `apps/api/src/auth/middleware.ts` (UNAUTHORIZED, INVALID_TOKEN, TOKEN_EXPIRED)
 *  - `apps/api/src/campaigns/service.ts` (CAMPAIGN_NOT_*, SCHEDULED_AT_IN_PAST)
 *  - `apps/api/src/recipients/service.ts` (RECIPIENT_EMAIL_TAKEN)
 *
 * Keep keys in sync if the backend adds new error codes.
 */
export const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: 'The form has invalid input. Check the highlighted fields.',
  EMAIL_TAKEN: 'An account with this email already exists.',
  INVALID_CREDENTIALS: 'Invalid email or password.',
  UNAUTHORIZED: 'Your session has expired. Please log in again.',
  INVALID_TOKEN: 'Your session is invalid. Please log in again.',
  TOKEN_EXPIRED: 'Your session has expired. Please log in again.',
  CAMPAIGN_NOT_FOUND: 'Campaign not found.',
  CAMPAIGN_NOT_EDITABLE:
    'This campaign can no longer be edited (it has been scheduled or sent).',
  CAMPAIGN_NOT_SCHEDULABLE:
    'This campaign cannot be scheduled (likely already scheduled or sent).',
  CAMPAIGN_NOT_SENDABLE:
    'This campaign cannot be sent (likely already sent).',
  SCHEDULED_AT_IN_PAST: 'Schedule date must be in the future.',
  RECIPIENT_EMAIL_TAKEN: 'A recipient with this email already exists.',
  INTERNAL: 'Something went wrong on our side. Please try again.',
};

/**
 * Resolve a user-facing message for an API error code.
 *
 * @param code     Error code from `ApiError.error.code`. May be undefined when
 *                 the failure is a network/parse error before the response was
 *                 parsed.
 * @param fallback Optional fallback (typically the API's raw `message`) to use
 *                 when the code is unknown. If neither code nor fallback are
 *                 useful, returns 'Unknown error.' (never empty/null).
 */
export function messageFor(code: string | undefined, fallback?: string): string {
  if (!code) return fallback ?? 'Unknown error.';
  return ERROR_MESSAGES[code] ?? fallback ?? code;
}
