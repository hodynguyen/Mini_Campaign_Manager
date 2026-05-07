---
tags: [tech-debt, quality]
created: 2026-05-06
author_agent: human
status: active
---

# Tech Debt

> To be filled as tech debt is identified during development. The code-reviewer
> agent should append entries here when it finds issues that are intentionally
> deferred for the 4–8h budget.

## F2 Auth — code-reviewer findings (2026-05-07)

---
tags: [tech-debt, auth, security, medium]
created: 2026-05-07
author_agent: code-reviewer
status: active
---

### MEDIUM — Login brute-force rate-limit
- **Where:** `apps/api/src/auth/routes.ts` (`POST /auth/login`).
- **Issue:** No throttling on login attempts. An attacker can hammer the endpoint with a single email + wordlist; the only thing slowing them is bcrypt cost 10 (~60ms/attempt).
- **Why deferred:** explicit "out of scope" in `spec-auth.md` §"Out of Scope". Time-budget call.
- **Fix shape:** `express-rate-limit` (5 attempts / 5min window per IP) on `/auth/login` and `/auth/register`. Optional: account-level lockout after N failures (more invasive).
- **When:** F3+ if assignment time allows; otherwise document as a known limitation in README.

### MEDIUM — `JWT_EXPIRES_IN` env not regex-validated
- **Where:** `apps/api/src/config/env.ts`.
- **Issue:** Schema is `z.string().min(1)`. A value like `"24"` (no unit) is accepted; `vercel/ms` parses it as `24` milliseconds, so tokens expire instantly and login becomes effectively broken at runtime — silently. Boot succeeds.
- **Fix:** add `.regex(/^\d+(ms|s|m|h|d|w|y)?$/i)` (or equivalent) to the schema so the env loader fails fast on malformed values.
- **When:** small refactor; can land alongside the next env-touching feature.

### MEDIUM — Full Zod `err.issues` echoed back as error `details`
- **Where:** `apps/api/src/errors/handler.ts:56`.
- **Issue:** `details: err.issues` returns the full Zod issue array including `received`/`expected` fields and any user input that Zod chose to surface in messages. zod@^3.23.8 is currently safe (it does not echo password values for `min`/`max` failures), but a future Zod major could regress.
- **Fix:** map issues to `{ path, message }` only; drop `received`. Adds 5 lines.
- **When:** any Zod upgrade or sensitive-input audit.

### LOW — `Authorization` header scheme is case-sensitive
- **Where:** `apps/api/src/auth/middleware.ts:34`.
- **Issue:** RFC 7235 says auth-scheme is case-insensitive; this middleware accepts only the literal `"Bearer "`. A strict-RFC client sending `bearer ` would be 401'd.
- **Fix:** lowercase the scheme before comparing, or use `scheme.toLowerCase() !== 'bearer'`.
- **When:** if/when a third-party client ever integrates. Not assignment-blocking.
