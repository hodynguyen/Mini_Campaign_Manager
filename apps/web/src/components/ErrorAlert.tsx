import { Alert } from 'antd';

import { messageFor } from '../types/api-error';

/**
 * F5 — Reusable inline error renderer.
 *
 * Wraps AntD `<Alert type="error" showIcon>` and applies the
 * `error.code -> user message` mapping from `types/api-error.ts`. Always
 * pattern-matches on `code`, NEVER on `message` (per F4 carry-forward and
 * spec §UX requirements).
 *
 * Usage:
 *   <ErrorAlert code={err.code} fallback={err.message} />
 *   <ErrorAlert code="VALIDATION_ERROR" />
 *
 * If `code` is undefined (e.g. raw network error), `fallback` is used and
 * finally a generic 'Unknown error.' literal — never blank, never a stack.
 */
export interface ErrorAlertProps {
  /** API error code (e.g. 'INVALID_CREDENTIALS'). */
  code?: string;
  /** Optional fallback (typically the API's raw `message`) for unknown codes. */
  fallback?: string;
  /** Optional override for the `<Alert>` description; otherwise omitted. */
  description?: string;
}

export default function ErrorAlert({
  code,
  fallback,
  description,
}: ErrorAlertProps): JSX.Element {
  return (
    <Alert
      type="error"
      showIcon
      message={messageFor(code, fallback)}
      description={description}
    />
  );
}
