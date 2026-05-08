---
tags: [log, api-endpoint, schedule, send, async]
date: 2026-05-08
author-agent: start-feature
status: completed
---

# Feature Log: F4 — Schedule + Send (async) + Stats refresh

Type: api-endpoint
Started: 2026-05-08
Mode: auto

## Spec
-> spec-schedule-send.md

## Agent Work

### architect — F4 schedule/send scaffolding

- Files created:
  - `apps/api/src/campaigns/worker.ts` — `runSendWorker(campaignId)` (production, never-throws) + `runSendWorkerForTests(campaignId)` (awaitable, throws-on-error). TODO bodies; full JSDoc spells out the bucket-and-bulk-update worker plus the atomic `sending → sent` flip.
- Files modified:
  - `apps/api/src/campaigns/schema.ts` — added `scheduleSchema` (`{ scheduled_at: ISO8601 with offset }`, `.strict()`) and `openTrackParamsSchema` (UUID id + recipientId). Future-time check is documented as service-side, NOT zod.
  - `apps/api/src/campaigns/service.ts` — added `ATOMIC_SCHEDULE_SQL`, `ATOMIC_SEND_SQL`, `ATOMIC_OPEN_TRACK_SQL` constants + `scheduleCampaign`, `sendCampaign`, `trackOpen` skeletons (TODO bodies). JSDoc for each function fully specifies bind params, affectedRows-then-fallback-SELECT pattern, and the four error codes.
  - `apps/api/src/campaigns/controller.ts` — added `scheduleCampaign`, `sendCampaign`, `trackOpen` controller skeletons. The send controller's JSDoc spells out the `setImmediate(() => runSendWorker(id).catch(...))` kick AFTER `res.status(202).json(...)`.
  - `apps/api/src/campaigns/routes.ts` — added 3 new routes after DELETE `:id` per the spec's locked mount order.
  - `apps/api/src/config/env.ts` — added `SEND_SUCCESS_RATE` (`z.coerce.number().min(0).max(1).default(0.8)`) and `SEND_WORKER_DELAY_MS` (`z.coerce.number().int().min(0).default(0)`).
  - `apps/api/.env.example` — documented both new vars.
  - `packages/shared/src/index.ts` — exported `ScheduleCampaignRequest` and `SendCampaignResponse` interfaces.
- KB updated:
  - `.hody/knowledge/architecture.md` — appended "F4 Schedule/Send — Locked Decisions" with file map, ATOMIC_*_SQL strings verbatim, worker bucket/bulk-update strategy, error code table, response status code table, env additions, mount order, and the test-flow recipe for the worker.
  - `.hody/knowledge/decisions.md` — flipped ADR-002 to **accepted** with full implementation strategy: setImmediate from controller after `res.json(202)`, awaitable test variant `runSendWorkerForTests`, atomic UPDATE pattern that closes the F3 race, alternatives explicitly considered (BullMQ, inline-await, `Promise.resolve().then` microtask race).
  - `.hody/knowledge/api-contracts.md` — extended schedule/send entries with full error code table; added `POST /:id/recipients/:recipientId/open` contract; demoted the "Open tracking demo-only" note to a pointer to the real endpoint.
  - `.hody/knowledge/tech-debt.md` — marked the F3 "find-then-update race window" entry **RESOLVED IN F4** with the atomic UPDATE pattern. Audit-trail note about the residual PATCH/DELETE race kept open (low-risk; not actioned).
- Key decisions:
  - **Atomic SQL pattern over SERIALIZABLE transaction** — `UPDATE ... WHERE status IN (...)` + `affectedRows === 1` is simpler, doesn't need isolation-level juggling, and the follow-up SELECT cleanly distinguishes 404 vs 409 without leaking row existence.
  - **Worker bucket + bulk update (2 queries max)** — beats per-row UPDATEs by orders of magnitude on large campaigns. Bucketing at JS level is fine because `Math.random` is cheap; the constraint is round-trip count, not CPU.
  - **`runSendWorker` (production) and `runSendWorkerForTests` are two distinct exports with the SAME body** — production-named version wraps the test-named version in try/catch + console.error to guarantee no unhandled rejections in the api process. Tests import the test-named version directly so they can assert eventual state without polling. Names are deliberate so production code can never accidentally `await` the test variant and serialize a request behind the worker.
  - **`SEND_WORKER_DELAY_MS` env knob** — lets tests that want to observe the `sending` intermediate state inject artificial latency without mocking timers. Default 0 in production.
  - **Server-clock future-time check in service, not zod** — zod only knows ISO format; future-time has to be enforced against `Date.now()` at the request handler, mapped to 400 `SCHEDULED_AT_IN_PAST` (distinct from generic VALIDATION_ERROR so clients can pattern-match).
- Hand-off notes for backend:
  - Atomic UPDATE SQL strings are in `apps/api/src/campaigns/service.ts` as exported constants (`ATOMIC_SCHEDULE_SQL`, `ATOMIC_SEND_SQL`, `ATOMIC_OPEN_TRACK_SQL`). Use them verbatim — the JSDoc on each function gives the bind shape. Don't inline the SQL into the function bodies.
  - Files to fill (TODO bodies):
    - `apps/api/src/campaigns/service.ts` — `scheduleCampaign`, `sendCampaign`, `trackOpen` (3 functions).
    - `apps/api/src/campaigns/worker.ts` — `runSendWorker` (delegates to runSendWorkerForTests inside try/catch), `runSendWorkerForTests` (the actual impl).
    - `apps/api/src/campaigns/controller.ts` — `scheduleCampaign`, `sendCampaign` (with the `setImmediate` kick AFTER `res.status(202).json(...)`), `trackOpen`.
  - Files to create from scratch: none. Worker file is created by THINK as a skeleton.
  - Mount order in `apps/api/src/campaigns/routes.ts` (already wired by THINK):
    ```
    GET    /
    POST   /
    GET    /:id
    PATCH  /:id
    DELETE /:id
    POST   /:id/schedule
    POST   /:id/send
    POST   /:id/recipients/:recipientId/open
    ```
  - Env additions: `SEND_SUCCESS_RATE` (0.8 default), `SEND_WORKER_DELAY_MS` (0 default). Both documented in `.env.example`. Tests can override `SEND_SUCCESS_RATE` via env to make outcomes deterministic.
  - Imports backend will need: `import { QueryTypes, Op } from 'sequelize';` for the worker's bulk update; `import { env } from '../config/env';` for `SEND_SUCCESS_RATE` / `SEND_WORKER_DELAY_MS`; `import { ValidationError } from '../errors/AppError';` for `SCHEDULED_AT_IN_PAST`.
  - Affected-rows tuple shape: `sequelize.query(SQL, { type: QueryTypes.UPDATE, replacements })` returns `[unknown, number]` in Sequelize 6; destructure as `[, affectedRows]`.
  - Re-fetch pattern after a successful schedule UPDATE: `Campaign.findOne({ where: { id, createdBy: userId } })` and pass to existing `toCampaignDTO`. The row is non-null by construction (the UPDATE succeeded), but the type system won't know — use `!` or an assertive guard.
  - DO NOT modify F3 source/tests. F4 is purely additive on the campaigns surface.
- Hand-off notes for integration-tester:
  - Worker test pattern: `import { runSendWorkerForTests } from '../src/campaigns/worker'` and `await` it directly after the route returns 202. Avoids polling-with-timeout flakiness.
  - Alternative for tests that want to observe the `sending` intermediate state: set `SEND_WORKER_DELAY_MS=200` in the test env before booting the app, send through the route, poll `GET /:id` within the delay window, then `await runSendWorkerForTests(id)` to drain.
  - `SEND_SUCCESS_RATE` can be overridden per test via env to make outcomes deterministic — set `process.env.SEND_SUCCESS_RATE='1'` (all sent) or `'0'` (all failed) BEFORE the env loader runs (i.e. before importing `createApp`). Tests that don't care about distribution can leave it at 0.8 default.
  - Required test files (≥7 tests per the DoD):
    - `apps/api/tests/campaigns.schedule.test.ts` — happy / past-time (SCHEDULED_AT_IN_PAST) / wrong-state (CAMPAIGN_NOT_SCHEDULABLE) / tenancy-404.
    - `apps/api/tests/campaigns.send.test.ts` — happy with worker assertion / wrong-state (CAMPAIGN_NOT_SENDABLE).
    - `apps/api/tests/campaigns.open-track.test.ts` — happy / non-sent-row no-op / dup-no-op.
  - Atomic transitions are SQL-level invariants — there's no need to write a concurrency stress test (the SQL guarantees it). Asserting the error path is sufficient.
- Open questions / risks:
  - None blocking. The architect did NOT run any DB-touching code; only `tsc -p` and `yarn lint`. Both clean. F3 test suite (59/59) re-run green to confirm no regression from the schema/route additions.
  - Sequelize 6's `[unknown, number]` typing for the UPDATE return tuple is sometimes `[any[], number]` depending on the dialect and the SQL flavor; backend may need a cast. Not blocking but worth noting.

### backend — F4 schedule/send/open-track implementation

- Files modified:
  - `apps/api/src/campaigns/service.ts` — filled bodies for `scheduleCampaign`, `sendCampaign`, `trackOpen`. Removed the now-unnecessary `runSendWorker` import (the controller owns the kick-off, not the service).
  - `apps/api/src/campaigns/worker.ts` — implemented `runSendWorkerForTests` (delay → find pending → bucket-and-bulk-update → atomic flip) and the `runSendWorker` production wrapper (try/catch + console.error, never-throws). Inlined the `ATOMIC_SENDING_TO_SENT_SQL` constant adjacent to the worker so the idempotency invariant is local to read.
  - `apps/api/src/campaigns/controller.ts` — filled bodies for the three new handlers; added imports for `scheduleSchema`, `openTrackParamsSchema`, `scheduleCampaignSvc`, `sendCampaignSvc`, `trackOpenSvc`, and `runSendWorker`.
- Service summary:
  - `scheduleCampaign`: server-clock `Date.now()` future check (400 `SCHEDULED_AT_IN_PAST`), then `ATOMIC_SCHEDULE_SQL` via `sequelize.query(..., { type: QueryTypes.UPDATE, replacements })`. Affected-rows tuple destructured as `[, affectedRows]`. On `affectedRows === 1`, re-fetch via tenancy-scoped `Campaign.findOne` and `toCampaignDTO`. Otherwise follow-up SELECT distinguishes 404 `CAMPAIGN_NOT_FOUND` vs 409 `CAMPAIGN_NOT_SCHEDULABLE` without leaking foreign-row existence.
  - `sendCampaign`: same atomic-UPDATE-then-fallback-SELECT pattern with `ATOMIC_SEND_SQL`. Returns `{ id, status: 'sending' }` literal on success. 409 code is `CAMPAIGN_NOT_SENDABLE`. Worker is NOT kicked from the service — kept pure so tests can `await runSendWorkerForTests(id)` directly.
  - `trackOpen`: single `ATOMIC_OPEN_TRACK_SQL` call; affectedRows is intentionally discarded. The SQL embeds the tenancy join (created_by) and idempotency guards (status='sent' AND opened_at IS NULL), so foreign-user / wrong-status / already-opened all silently no-op without an existence leak. No throw — 204 every time.
- Worker summary:
  - `runSendWorker` (production) wraps `runSendWorkerForTests` in try/catch + `console.error('[send-worker]', { campaignId, err })`; intentionally swallows so the api process can never crash on a simulated send failure. Campaign left in `sending` state on error for manual re-trigger (the pending-filter at step 1 makes re-runs idempotent).
  - `runSendWorkerForTests`: optional `SEND_WORKER_DELAY_MS` setTimeout BEFORE any DB work (so the `sending` state is observable through GET during the delay window in tests that opt-in). Then `CampaignRecipient.findAll({ where: { campaignId, status: 'pending' }, attributes: ['id'] })` → JS-side bucket using `Math.random() < env.SEND_SUCCESS_RATE` → at most TWO bulk `CampaignRecipient.update` calls (one per outcome bucket; skipped entirely when a bucket is empty). Both buckets stamp `sentAt` (per business-rules.md "attempted at"). Final atomic flip via `ATOMIC_SENDING_TO_SENT_SQL` (`WHERE id=:campaignId AND status='sending'`) — idempotent on retry.
- Controller summary:
  - `scheduleCampaign`: `requireUserId` → `requireParamId` → `scheduleSchema.parse(req.body)` → service → `res.status(200).json(updated)`.
  - `sendCampaign`: `requireUserId` → `requireParamId` → `sendCampaignSvc(...)` → `res.status(202).json(result)` → `setImmediate(() => { runSendWorker(id).catch(logErr) })`. The setImmediate runs strictly AFTER res.json (Express flushes synchronously off `res.status(...).json(...)`, then the next event-loop tick starts the worker). Kept the inner `.catch` as defense-in-depth even though `runSendWorker` already swallows.
  - `trackOpen`: `requireUserId` → `openTrackParamsSchema.parse(req.params)` (validates BOTH `:id` and `:recipientId` as UUIDs at the boundary; rejects non-UUID with 400 VALIDATION_ERROR before Postgres can throw `invalid_text_representation`) → service → `res.status(204).end()`.
- Build/lint/test:
  - `yarn workspace @app/api build` — clean.
  - `yarn lint` — 0 errors, 1 pre-existing unrelated warning in `db/sequelize.ts` (no-console; not introduced by F4).
  - `yarn workspace @app/api test` — 59/59 F3 tests still green. F4 endpoints are wired but untested at this layer; integration-tester adds the ≥7 new tests next.
- Notes for integration-tester:
  - `import { runSendWorkerForTests } from '../src/campaigns/worker'` and `await` it directly after the route returns 202 for deterministic sequencing.
  - `process.env.SEND_SUCCESS_RATE='1'` makes all-sent; `'0'` makes all-failed. Must be set BEFORE the env loader runs (i.e. before `import` of `createApp` / anything that pulls in `config/env.ts`).
  - `SEND_WORKER_DELAY_MS` env (numeric ms) — set BEFORE app boot to inject artificial worker latency for tests that want to observe the `sending` intermediate state via `GET /:id`.
  - `openTrackParamsSchema` rejects non-UUID path params with 400 VALIDATION_ERROR; tests asserting 204 must pass a real-shape UUID even for the no-op cases.
  - The `ATOMIC_OPEN_TRACK_SQL` JOIN-based tenancy filter means a foreign user's call returns 204 (silent no-op) — tests for "User A cannot open User B's recipient" assert 204 + DB state unchanged, NOT 404.
  - The send happy-path test pattern: register/login → POST /campaigns with recipient_emails → POST /:id/send (assert 202, status='sending') → `await runSendWorkerForTests(id)` → GET /:id (assert status='sent', stats reflect sent/failed counts). For deterministic distribution, set `SEND_SUCCESS_RATE='1'` for all-sent assertions or `'0'` for all-failed.
- Open questions/risks:
  - None. The Sequelize 6 `[unknown, number]` tuple typing flagged by architect destructured cleanly without a cast under the project's `tsconfig.json` settings — `affectedRows` is correctly typed as `number`. No runtime guard needed.

### integration-tester — F4 tests

- Files created:
  - `apps/api/tests/campaigns.schedule.test.ts` — 6 tests (happy / past-time SCHEDULED_AT_IN_PAST / wrong-state CAMPAIGN_NOT_SCHEDULABLE on `sent` row / tenancy-404 / non-ISO VALIDATION_ERROR / strict-body unknown-key VALIDATION_ERROR). Every error-path test re-fetches the campaign and asserts the DB row is unchanged.
  - `apps/api/tests/campaigns.send.test.ts` — 6 tests (happy with worker-await assertion + 5 recipients / random distribution at default 0.8 across 100 recipients with both buckets non-empty / 202-not-200 immediate response shape `{ id, status: 'sending' }` / wrong-state CAMPAIGN_NOT_SENDABLE on already-sent / tenancy-404 / empty-recipients send still flips campaign to `sent` with all-zero stats).
  - `apps/api/tests/campaigns.open-track.test.ts` — 7 tests (happy stamps opened_at / idempotent second call does NOT advance opened_at / pending no-op / failed no-op / foreign-tenancy silent 204 with row state unchanged plus User-A confirmation that the row IS open-trackable / non-UUID :recipientId 400 VALIDATION_ERROR / E2E send-then-open producing non-zero open_rate). Idempotency test waits 10ms between calls so a re-stamp would be observable at Postgres microsecond precision.
- Files modified: none (purely additive test files; F4 source was already correct).
- KB updated: `.hody/knowledge/log-schedule-send.md` (this entry).
- Worker sequencing pattern used (per backend's hand-off):
  - All send tests `import { runSendWorkerForTests } from '../src/campaigns/worker'` and `await runSendWorkerForTests(id)` immediately after the 202 response. The double-execution against the controller's setImmediate-fired production worker is safe: the second pass finds 0 pending CR rows AND the atomic `sending → sent` UPDATE matches 0 rows once status='sent'. Confirmed deterministic across multiple local runs.
  - The empty-recipients test exercises the bulk-update skip branches (both `sentIds`/`failedIds` arrays empty) plus the standalone atomic flip — important because that's the path that proves the worker doesn't depend on having any CR rows to flip the campaign.
  - Random-distribution test uses 100 recipients + loose `>0` bounds for both buckets. Probability of all-sent is 0.8^100 ≈ 2e-10; all-failed is 0.2^100 ≈ 1e-70. Effectively deterministic without env mutation.
- Test counts:
  - F4 new tests: schedule=6, send=6, open-track=7 → **19 new tests** (target was ≥7; over by 12).
  - Total project: **78 tests across 12 suites**, all green (was 59 → now 78 ≥ 66 target).
- Build/lint:
  - `yarn workspace @app/api build` — clean (tsc 0 errors).
  - `yarn lint` — 0 errors, 1 pre-existing warning in `db/sequelize.ts` (unchanged from F3 baseline).
  - `yarn workspace @app/api test` — 12/12 suites pass, 78/78 tests pass.
- Bugs found: none. F4 source code matched its JSDoc and the architect's hand-off exactly. The `runSendWorkerForTests` idempotency pattern works as documented; tenancy 404-vs-silent-204 split between schedule/send and open-track behaves per spec.
- Notes for code-reviewer:
  - Race-surface review is moot: the SQL guards (`WHERE status='draft'` for schedule, `WHERE status IN ('draft','scheduled')` for send, `WHERE status='sent' AND opened_at IS NULL AND created_by=:userId` for open-track) are SQL-level invariants. Test-side concurrency-stress is unnecessary; the error-code paths are covered by tests 3 / 10 / (open-track no-ops) above.
  - Worker error-handling is exercised indirectly: `runSendWorker` (production) wraps `runSendWorkerForTests` in try/catch and never throws. Tests use the test-named variant directly so they CAN observe a thrown error if one occurred — none did across the suite.
  - Auth on open-track: tests confirm a foreign-user call is silently 204 with NO row state change (no existence leak) and that User A's own subsequent call DOES stamp opened_at. Both are positive evidence that the tenancy join in `ATOMIC_OPEN_TRACK_SQL` is load-bearing.
  - `.strict()` on `scheduleSchema` is exercised by the strict-body test (VALIDATION_ERROR on `{ scheduled_at, extra: 'x' }`).
  - F3 regression: zero. All 59 prior tests still pass alongside the 19 new ones.
- Open questions / risks: none.
- Final result: **78/78 green, lint+build clean, F4 verified per all 11 DoD checkboxes from spec-schedule-send.md.** Ready for code-reviewer.

### code-reviewer — F4 review

- **Verdict:** **APPROVED.** No BLOCKER / HIGH / MEDIUM findings; only LOW notes. No fixes applied (none required).
- **Scope reviewed:**
  - `apps/api/src/campaigns/{service,worker,controller,routes,schema}.ts`
  - `apps/api/src/config/env.ts`
  - `apps/api/src/app.ts` (verified `requireAuth` mounted on `/campaigns` covers all F4 nested routes)
  - `apps/api/src/errors/{AppError,handler}.ts` (verified ValidationError=400, NotFoundError=404, ConflictError=409)
  - 3 new test files (`campaigns.{schedule,send,open-track}.test.ts`)
  - `.hody/knowledge/decisions.md` ADR-002 + `.hody/knowledge/tech-debt.md` F3 race entry
- **Build/lint/test:** `yarn workspace @app/api build` clean; `yarn lint` 0 errors (1 pre-existing warning in `db/sequelize.ts` no-console — predates F4); `yarn workspace @app/api test` **78/78 green across 12 suites**.
- **Findings table:**

| Section | Severity | File | Item | Status |
|---|---|---|---|---|
| A. Atomicity — schedule | PRAISE | `service.ts:357-365, 470-473` | `ATOMIC_SCHEDULE_SQL` is one UPDATE with `WHERE id=:id AND created_by=:userId AND status='draft'`; `affectedRows === 1` checked; tenancy-scoped follow-up SELECT distinguishes 404 vs 409 without existence leak. | OK |
| A. Atomicity — send | PRAISE | `service.ts:378-385, 540-560` | `ATOMIC_SEND_SQL` matches the same pattern with `status IN ('draft','scheduled')`. | OK |
| A. Atomicity — sending→sent | PRAISE | `worker.ts:72-78, 171-174` | Worker's final flip is `WHERE id=:campaignId AND status='sending'` — idempotent on retry. | OK |
| A. Atomicity — open-track | PRAISE | `service.ts:407-417` | Single UPDATE with `INNER JOIN campaigns` inline; tenancy + idempotency guards in the SQL. | OK |
| B. Worker fire-and-forget | PRAISE | `controller.ts:178-188` | `setImmediate` runs strictly AFTER `res.status(202).json(result)`. | OK |
| B. Worker never-throws | PRAISE | `worker.ts:89-99` | `runSendWorker` wraps `runSendWorkerForTests` in try/catch + console.error. | OK |
| B. Test variant awaitable | PRAISE | `worker.ts:119-175` | `runSendWorkerForTests` throws on error so tests assert deterministic state. | OK |
| B. Bucket+bulk update | PRAISE | `worker.ts:137-165` | At most 2 UPDATEs; empty-bucket skip avoids `WHERE id IN ()` SQL bug. | OK |
| B. SEND_SUCCESS_RATE comparison | PRAISE | `worker.ts:140` | `Math.random() < env.SEND_SUCCESS_RATE` — strict `<` per spec. | OK |
| B. sent_at on both buckets | PRAISE | `worker.ts:153-165` | Both `sent` and `failed` UPDATEs stamp `sentAt: now` per business-rules.md "attempted at". | OK |
| C. Open-track auth | PRAISE | `app.ts:57`, `service.ts:407-417` | `requireAuth` mounted on `/campaigns`; SQL JOIN embeds `c.created_by = :userId` (tenancy in SQL, not just middleware); foreign-tenant test asserts row UNCHANGED (positive evidence). | OK |
| D. Strict validation | PRAISE | `schema.ts:106-110, 124-127`; `controller.ts:136, 211` | `scheduleSchema.strict()`; body parse before service call; UUID-validated path params on open-track. | OK |
| E. Error mapping | PRAISE | `AppError.ts:41-73`; `handler.ts` | SCHEDULED_AT_IN_PAST→400; CAMPAIGN_NOT_SCHEDULABLE/SENDABLE→409; tenancy→404; generic 500 doesn't leak. | OK |
| F. Worker resource cleanup | PRAISE | `worker.ts:124-126, 130-133` | Uses ORM (pool managed); `if (env.SEND_WORKER_DELAY_MS > 0)` short-circuits the setTimeout when 0. | OK |
| G. State leak / privacy | PRAISE | `controller.ts:217`; `handler.ts` | Open-tracking always 204 regardless of affectedRows; error handler returns `{ code, message, details? }` — never echoes body/recipient name. | OK |
| H. Test signal | PRAISE | `campaigns.send.test.ts:82-107`; `campaigns.open-track.test.ts:206-226` | Send happy awaits `runSendWorkerForTests` AND asserts `campaign.status='sent'` + all CR rows in terminal state; distribution test uses 100 recipients + loose `>0` bounds; foreign-tenancy test asserts the DB row is UNCHANGED. | OK |
| I. ADR-002 consistency | PRAISE | `decisions.md:36-108` | Status `accepted` with full implementation strategy; BullMQ preserved as alternative (lines 83-89). | OK |
| Tech-debt closure | PRAISE | `tech-debt.md:57-75` | F3 "find-then-update race" entry is marked **RESOLVED IN F4** with the atomic UPDATE pattern explained. | OK |
| Worker logging style | LOW | `worker.ts:93-94`; `controller.ts:184-185` | `console.error` with eslint-disable-next-line is consistent with existing project style (e.g. `db/sequelize.ts`). No action. | NOTE |
| Math.random non-crypto | LOW | `worker.ts:140` | Acceptable for simulated send (not security-sensitive); the brief explicitly says "simulate". No action. | NOTE |
| Idempotency-test timing | LOW | `campaigns.open-track.test.ts:124` | 10ms sleep + Postgres µs precision is pragmatic; documented in the test comment. No action. | NOTE |

- **Fixes applied:** none — nothing required.
- **Tech-debt entries appended:** none (no MEDIUM/HIGH found).
- **DoD outcome (per spec-schedule-send.md §"Definition of Done"):**
  - [x] `POST /:id/schedule` 200 on draft+future-time — verified by happy test + DB row read.
  - [x] `POST /:id/schedule` 400 on past-time — `SCHEDULED_AT_IN_PAST`, ValidationError=400.
  - [x] `POST /:id/schedule` 409 on non-draft — `CAMPAIGN_NOT_SCHEDULABLE`, ConflictError=409.
  - [x] `POST /:id/send` 202 with `{ id, status: 'sending' }` — happy + immediate-shape tests.
  - [x] After send, `GET /:id` shows `sent` + stats reflect counts — happy + empty-recipients tests.
  - [x] `POST /:id/send` 409 on already-sent — `CAMPAIGN_NOT_SENDABLE`, ConflictError=409.
  - [x] `POST /:id/recipients/:rid/open` 204 (auth required, idempotent) — happy + idempotent tests.
  - [x] All transitions atomic (verified by READING the SQL — three `WHERE status=...` clauses + the `sending → sent` flip).
  - [x] ≥7 new tests pass; total ≥66 — actual: **78/78 (19 new)**, comfortably over 66.
  - [x] ADR-002 status `accepted` — confirmed in decisions.md.
  - [x] tech-debt F3 atomic-transitions entry RESOLVED — confirmed in tech-debt.md.
  - **All 11 DoD checkboxes pass.**
- **Top 3 finalize recommendations:**
  1. Commit message should highlight: ADR-002 accepted (in-process `setImmediate` decision) + F3 atomic-transitions race CLOSED + 19 new tests / 78 total.
  2. Push as a single feature commit (no squash needed — the agent log already documents per-agent intent in the KB).
  3. Smoke-check `yarn workspace @app/api dev` boots cleanly with the two new env vars defaulting (`SEND_SUCCESS_RATE`, `SEND_WORKER_DELAY_MS`) before pushing.
- **Top 3 F5 (frontend) carry-forward items:**
  1. The send response is **202 Accepted with `{ id, status: 'sending' }`** — the UI must NOT assume the campaign is `sent` after the call returns. Recommend: optimistic-update to `sending` on click, then poll `GET /:id` (e.g. every 1-2s for ~10s) until `status === 'sent'` or timeout. The integration tests use `runSendWorkerForTests` for determinism — production has no such hook, the UI must poll.
  2. Open-tracking is **silent 204** by design — the UI cannot probe whether an open call succeeded. Recommend a "stats refresh" button on the detail page that re-fetches `GET /:id` after open-track + after the demo seed runs, rather than expecting per-call feedback.
  3. The four error codes the schedule/send forms must pattern-match are documented in `api-contracts.md` and `service.ts:18-25`: `SCHEDULED_AT_IN_PAST` (past time), `CAMPAIGN_NOT_SCHEDULABLE`, `CAMPAIGN_NOT_SENDABLE`, `VALIDATION_ERROR` (zod). Use `error.code` for branching, never `error.message` (the message text is allowed to evolve).
- **Open questions / risks:** none. F4 is complete and ready to ship.

