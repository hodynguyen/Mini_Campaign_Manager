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

## F3 Campaigns/Recipients — code-reviewer findings (2026-05-08)

---
tags: [tech-debt, campaigns, medium, low]
created: 2026-05-08
author_agent: code-reviewer
status: active
---

### ~~MEDIUM — `updateCampaign` find-then-update race window~~ — RESOLVED IN F4
- **Status:** RESOLVED (2026-05-08, F4 architect think).
- **Where:** `apps/api/src/campaigns/service.ts` (PATCH/DELETE were the original concern; the F4 schedule/send paths were the actual race surface that would have made this exploitable).
- **Resolution:** F4 introduces `ATOMIC_SCHEDULE_SQL`, `ATOMIC_SEND_SQL`, and
  `ATOMIC_OPEN_TRACK_SQL` constants in `apps/api/src/campaigns/service.ts`.
  Each uses `UPDATE ... WHERE id=:id AND created_by=:userId AND status IN
  (...)` with an `affectedRows === 1` success check + follow-up SELECT to
  distinguish 404 vs 409. The state guard is now a SQL-level invariant — no
  read-modify-write window. The worker's final `sending → sent` flip uses
  the same pattern (`WHERE status='sending'`) so a partial-completion retry
  cannot trample.
- **Note on PATCH/DELETE residual:** `updateCampaign` and `deleteCampaign`
  in F3 still use the find-then-update pattern. With the F4 schedule/send
  surface added, a concurrent `POST /:id/schedule` could in principle race
  a PATCH. In practice both endpoints are owned by the same authenticated
  user and the UI does not issue concurrent transitions; risk is low
  enough that F4 deliberately leaves the F3 PATCH/DELETE code unchanged.
  If a follow-up wants to close even this residual window, mirror the same
  atomic-UPDATE-with-affectedRows pattern in `updateCampaign` /
  `deleteCampaign`. Tracked here for the audit trail; not currently
  actioned.

### MEDIUM — `recipient_emails` upsert is a sequential await loop
- **Where:** `apps/api/src/campaigns/service.ts:152-164`.
- **Issue:** Each `Recipient.findOrCreate` in the loop is a separate round-trip, sequential. For the spec cap of 1000 emails this is up to 1000 round-trips inside a single transaction. Worst-case latency on a real campaign create is unbounded by anything except request timeout.
- **Why deferred:** typical inputs are tiny (handful of emails); 1000-email payload is a stress edge. Spec budget for F3 is ~2h.
- **Fix shape:** swap the loop for a single bulk upsert — `Recipient.bulkCreate(rows, { transaction: t, updateOnDuplicate: ['name'], ignoreDuplicates: true })` then `Recipient.findAll({ where: { email: { [Op.in]: emails } }, transaction: t })` to retrieve ids. One round-trip per side instead of N.
- **When:** when bulk import endpoints land or first time a 1000-email payload is observed in metrics.

### LOW — `bulkCreate({ ignoreDuplicates: true })` masks future genuine duplicates
- **Where:** `apps/api/src/campaigns/service.ts:173-176`.
- **Issue:** the JS-side `Set` already dedupes, so `ignoreDuplicates: true` is dead-code defense in F3. If a future caller passes pre-deduped recipient ids that collide for a legitimate reason (re-attach), Sequelize will silently swallow it instead of surfacing the conflict.
- **Fix shape:** drop `ignoreDuplicates: true` (the Set dedup is the canonical guard) OR leave it but explicitly comment that it is a belt-and-braces guard that future maintainers should NOT rely on.
- **When:** next F3 touch-up, or never if the comment is judged enough.

### LOW — `updateCampaign` JSDoc claims `update({})` bumps `updated_at`
- **Where:** `apps/api/src/campaigns/service.ts:256-258` (JSDoc).
- **Issue:** Comment says "`update()` still bumps `updated_at` via Sequelize default". Verified via DEBUG_SQL trace — Sequelize sees no changed fields and skips the UPDATE entirely; `updated_at` is NOT bumped on empty-patch PATCH. The behavior is benign (idempotent no-op), but the doc is wrong.
- **Fix shape:** rephrase to "Sequelize sees no changed fields and skips the UPDATE; `updated_at` is unchanged on empty patch — list ordering is naturally stable."
- **When:** trivial doc fix, can land in any campaigns/service.ts touch.

### LOW — Recipient `name` fallback to email-prefix on auto-upsert
- **Where:** `apps/api/src/campaigns/service.ts:159`.
- **Issue:** When `POST /campaigns` upserts a brand-new recipient by email alone, the recipient's `name` is set to `email.split('@')[0]`. For `"Foo+Bar@x.com"`, the prefix is `"foo+bar"` — odd display name. No big deal for the assignment but worth a glance.
- **Fix shape:** capitalize / strip plus-tags, or default to the full email until the user PATCHes. Optional UX polish.
- **When:** UX pass on the recipients list page in F5.

## F5 Frontend — code-reviewer findings (2026-05-08)

---
tags: [tech-debt, frontend, antd, low, medium]
created: 2026-05-08
author_agent: code-reviewer
status: active
---

### MEDIUM — Static `notification.error` API loses `ConfigProvider` theming
- **Where:** `apps/web/src/components/CampaignActions.tsx` (`showApiError`) and any future use of `notification.error()` / `message.*` static methods.
- **Issue:** AntD v5 documents that the static `notification` / `message` APIs are NOT wrapped by `<ConfigProvider>` — they read theme tokens at module-init time, so any dynamic theme overrides (dark mode, brand colors) won't apply to these toasts. Today the app uses default theme everywhere, so the visual impact is zero, but this is a known footgun.
- **Fix shape:** wrap the app in `<App>` from `antd` (a sibling of `ConfigProvider`) and use `App.useApp().notification` from inside components. ~10 LOC change.
- **When:** any time a theming feature lands (dark mode, brand colors). Not worth the churn for F5.

### ~~LOW — `destroyOnClose` is deprecated in AntD v5 (use `destroyOnHidden`)~~ — RESOLVED IN F6
- **Status:** RESOLVED (2026-05-08, F6 frontend).
- **Where:** `apps/web/src/components/CampaignActions.tsx` Schedule `<Modal destroyOnClose>`.
- **Issue:** AntD v5 emits a deprecation warning during the F5 send-flow test ("`destroyOnClose` is deprecated. Please use `destroyOnHidden` instead.") The current prop still works at runtime, but the warning will surface in production console too.
- **Resolution:** Renamed `destroyOnClose` → `destroyOnHidden` on the
  Schedule `<Modal>` (line 213). Confirmed the deprecation warning no
  longer surfaces in `yarn workspace @app/web test` output. 8/8 web tests
  still pass; build + lint clean.

### ~~LOW — 401 redirect-loop guard uses `startsWith('/login')`~~ — RESOLVED IN F6
- **Status:** RESOLVED (2026-05-08, F6 frontend).
- **Where:** `apps/web/src/lib/api.ts:55`.
- **Issue:** Loop guard does `!window.location.pathname.startsWith('/login')`. If a future route ever uses `/login-something` as a path prefix, this would silently skip the redirect on a 401 there. The app has no such route today, so the risk is theoretical.
- **Resolution:** Replaced the `startsWith` check with exact-equality on
  both public routes: `pathname !== '/login' && pathname !== '/register'`.
  Extending the guard to `/register` (the second public route in the F5
  routing shell) is symmetric and prevents a 401 fired during the
  register flow's auto-login leg from booting the user mid-form. 8/8 web
  tests still pass; build + lint clean.

### LOW — Per-page `extractApiError` + `alertProps` duplication
- **Where:** `apps/web/src/pages/{LoginPage,RegisterPage,CampaignsListPage,CampaignNewPage,CampaignDetailPage}.tsx`.
- **Issue:** Each page defines its own `extractApiError` (~10 LOC) and `alertProps` (~7 LOC). The frontend agent justified this in the log (each consumer wants slightly different fields, e.g. CampaignDetailPage cares about HTTP `status` for 404 routing). Net duplication is ~70 LOC.
- **Fix shape:** centralize as `apps/web/src/lib/error.ts` exporting a single `extractApiError(err): { status?, code?, fallback? }` and an `alertProps(e)` helper. The strict-mode `exactOptionalPropertyTypes: true` constraint that drove the local helpers can be solved once in the shared module.
- **When:** F6 if there's appetite, otherwise let it be — the duplication is intentional and well-documented.
