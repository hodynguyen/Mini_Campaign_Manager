---
tags: [submission, audit, spec-verify]
date: 2026-05-08
author_agent: spec-verifier
status: final
---

# Submission Checklist — Mini Campaign Manager

> Audited 2026-05-08 against `ASSIGNMENT.md`. Every line item is mapped to a
> file path + line number (and test file when applicable).
> Verdicts: ✅ met, ⚠️ partial with rationale, ❌ unmet.

---

## Part 1 — Backend (Node.js + PostgreSQL)

### 1.1 Schema design

#### User table
- ✅ Table created — `apps/api/migrations/0001-create-users.ts:31-40`
  (raw SQL via `q.sequelize.query` so we can pull in `citext` + `pgcrypto`).
- ✅ Column `id UUID PK DEFAULT gen_random_uuid()` — line 33.
- ✅ Column `email CITEXT NOT NULL UNIQUE` (case-insensitive) — line 34.
- ✅ Column `name TEXT NOT NULL` — line 35.
- ✅ Column `password_hash TEXT NOT NULL` — line 36 (extra-but-needed, brief
  doesn't list it explicitly but auth requires it).
- ✅ Column `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` — line 37.
- ✅ Column `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` — line 38 (extra,
  not listed in brief — Sequelize convention).
- ✅ Indexing rationale — file header comment, lines 17-18: "UNIQUE on email
  already creates an index — no separate CREATE INDEX needed."

#### Campaign table
- ✅ Table created — `apps/api/migrations/0002-create-campaigns.ts:35-47`.
- ✅ `id UUID PK DEFAULT gen_random_uuid()` — line 37.
- ✅ `name TEXT NOT NULL` — line 38.
- ✅ `subject TEXT NOT NULL` — line 39.
- ✅ `body TEXT NOT NULL` — line 40.
- ✅ `status` ENUM `('draft','scheduled','sending','sent')` — type at line 34,
  column at line 41. (Brief lists `draft|sending|scheduled|sent` — same set,
  same names, ordering is irrelevant for ENUM identity.)
- ✅ `scheduled_at TIMESTAMPTZ` (nullable) — line 42.
- ✅ `created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE` — line 43.
- ✅ `created_at` / `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` — lines 44-45.
- ✅ Index `(created_by, updated_at DESC)` — lines 49-51 (covers the per-tenant
  list endpoint sorted by recency).
- ✅ Partial index `(status, scheduled_at) WHERE status='scheduled'` — lines
  53-56 (covers the F4 due-soon worker scan; rationale at lines 22-25 of the
  same file).
- ✅ Indexing rationale — `.hody/knowledge/architecture.md` §"F3 Campaigns CRUD"
  (referenced from the file header).

#### Recipient table
- ✅ Table created — `apps/api/migrations/0003-create-recipients.ts:27-34`.
- ✅ `id UUID PK DEFAULT gen_random_uuid()` — line 29.
- ✅ `email CITEXT NOT NULL UNIQUE` — line 30.
- ✅ `name TEXT NOT NULL` — line 31.
- ✅ `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` — line 32.
- ✅ Recipients are tenant-shared (no `created_by`) — documented in
  `.hody/knowledge/decisions.md` ADR-012 (line 334) and the migration file
  header (lines 4-7).
- ✅ Indexing rationale — file header lines 18-21: "UNIQUE on email already
  creates an index — no separate CREATE INDEX needed."

#### CampaignRecipient table
- ✅ Table created — `apps/api/migrations/0004-create-campaign-recipients.ts:43-53`.
- ✅ `campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE` — line 46.
- ✅ `recipient_id UUID NOT NULL REFERENCES recipients(id) ON DELETE RESTRICT` — line 47.
- ✅ `sent_at TIMESTAMPTZ` (nullable) — line 49.
- ✅ `opened_at TIMESTAMPTZ` (nullable) — line 50.
- ✅ `status ENUM ('pending','sent','failed') NOT NULL DEFAULT 'pending'` —
  ENUM type at line 41, column at line 48.
- ✅ `UNIQUE (campaign_id, recipient_id)` — line 51 (one row per recipient per
  campaign).
- ✅ Index `(campaign_id)` — lines 54-56 (covers the stats aggregate scan).
- ✅ Indexing rationale — file header lines 23-32 + `architecture.md`.

### 1.2 API endpoints (REST)

All endpoints below auth-protected via `requireAuth` mounted in
`apps/api/src/app.ts:57-58` for `/campaigns` and `/recipients`. Auth endpoints
are public.

- ✅ **POST /auth/register** — route `apps/api/src/auth/routes.ts:23` →
  controller `apps/api/src/auth/controller.ts:53` → service
  `apps/api/src/auth/service.ts` (`createUser`). Tested in
  `apps/api/tests/auth.register.test.ts` (10 cases — happy, dup email,
  validation error matrix).

- ✅ **POST /auth/login** — route `apps/api/src/auth/routes.ts:24` → controller
  `apps/api/src/auth/controller.ts:59` → service (`findByEmailLower`,
  `verifyPassword`, `signToken`). Tested in `apps/api/tests/auth.login.test.ts`
  (5 cases — happy, case-insensitive email, wrong password, unknown email,
  validation). Constant-time-ish via `SENTINEL_HASH` decoy
  (`controller.ts:64-69`).

- ✅ **GET /campaigns** — route `apps/api/src/campaigns/routes.ts:41` →
  controller `apps/api/src/campaigns/controller.ts` (`listCampaigns`) →
  service `apps/api/src/campaigns/service.ts:89-110`. Tested in
  `apps/api/tests/campaigns.crud.test.ts:144` (paginated list, sort by
  updated_at DESC) + `apps/api/tests/campaigns.tenancy.test.ts:104` (per-user
  scope).

- ✅ **POST /campaigns** — route `apps/api/src/campaigns/routes.ts:42` →
  controller `createCampaign` → service `service.ts:134-193`. Tested in
  `apps/api/tests/campaigns.crud.test.ts:34` (3 cases incl. dedupe of
  recipient_emails by case + 400 validation matrix).

- ✅ **GET /recipients** — route `apps/api/src/recipients/routes.ts:21` →
  controller `apps/api/src/recipients/controller.ts` (`listRecipients`).
  Tested in `apps/api/tests/recipients.crud.test.ts:127` (paginated list +
  iLike `?search=` filter).

- ⚠️ **POST /recipients** (vs. brief's singular **POST /recipient**) — route
  `apps/api/src/recipients/routes.ts:22` → controller `createRecipient` →
  service `apps/api/src/recipients/service.ts`. Tested in
  `apps/api/tests/recipients.crud.test.ts:34` (4 cases: 201 happy, lowercase,
  409 duplicate, 400 validation, 401 unauth). **Deviation**: brief writes
  `POST /recipient` (singular). Implemented as `POST /recipients` (plural)
  per REST convention. Documented in `.hody/knowledge/api-contracts.md:131-132`
  and `decisions.md` ADR-012 (line 348). All other documented endpoints use
  plural; this keeps the surface internally consistent. Recommend the README
  finalize step also call this out for the reviewer.

- ✅ **GET /campaigns/:id** — route `routes.ts:43` → controller `getCampaign`
  → service `getCampaignDetail` (`service.ts:209-253`). Returns the campaign
  + nested `stats` (computed via `stats.ts`) + `recipients[]`. Tested in
  `apps/api/tests/campaigns.crud.test.ts:190` (zero-stats fresh draft + 226
  for attached recipients).

- ✅ **PATCH /campaigns/:id** (draft only) — route `routes.ts:44` → controller
  `updateCampaign` → service `service.ts:269-301`. Draft guard at lines
  283-288 (throws `ConflictError({ code: 'CAMPAIGN_NOT_EDITABLE' })` → 409).
  Tested in `apps/api/tests/campaigns.state-machine.test.ts:34` (happy on
  draft, 409 on non-draft, .strict() guard rejects unknown keys) +
  `campaigns.tenancy.test.ts:54` (404 on foreign user).

- ✅ **DELETE /campaigns/:id** (draft only) — route `routes.ts:45` →
  controller `deleteCampaign` → service `service.ts:313-330`. Draft guard at
  lines 323-328. Tested in `campaigns.state-machine.test.ts:104` (204 on
  draft + row removed) and 126 (409 + row preserved on `sending`).
  Tenancy-scoped 404 in `campaigns.tenancy.test.ts:79`.

- ✅ **POST /campaigns/:id/schedule** — route `routes.ts:46` → controller
  `scheduleCampaign` → service `service.ts:452-496`. Future-time guard at
  lines 459-465. Atomic `UPDATE ... WHERE status='draft'` at lines 357-365
  (`ATOMIC_SCHEDULE_SQL`). Tested in `campaigns.schedule.test.ts` (6 cases:
  happy, past-time 400, wrong-state 409, tenancy 404, ISO validation,
  .strict() unknown keys).

- ✅ **POST /campaigns/:id/send** — route `routes.ts:47` → controller
  `sendCampaign` (kicks `runSendWorker` via `setImmediate` after `res.json`)
  → service `service.ts:531-561`. Atomic `UPDATE ... WHERE status IN
  ('draft','scheduled')` at lines 378-385 (`ATOMIC_SEND_SQL`). Worker in
  `apps/api/src/campaigns/worker.ts` randomly marks each CR `sent` or
  `failed` per `SEND_SUCCESS_RATE` (0.8 default). Tested in
  `campaigns.send.test.ts` (6 cases: happy + worker assertion, random
  distribution over 100 recipients, immediate-202 shape, wrong-state 409,
  tenancy 404, empty-recipients).

- ✅ **POST /campaigns/:id/recipients/:recipientId/open** (bonus, not in the
  11) — route `routes.ts:48` → service `service.ts:588-601`. Atomic SQL at
  lines 407-417 with tenancy join + idempotency guards (status='sent' AND
  opened_at IS NULL). Tested in `campaigns.open-track.test.ts` (7 cases incl.
  silent no-op on foreign tenant, 400 on non-UUID params, integration with
  the worker so seed/demo can produce non-zero open_rate).

### 1.3 Business rules

- ✅ **Edit/delete only when status=draft** —
  - PATCH guard: `apps/api/src/campaigns/service.ts:283-288` (409
    `CAMPAIGN_NOT_EDITABLE`).
  - DELETE guard: `service.ts:323-328`.
  - Tested by `apps/api/tests/campaigns.state-machine.test.ts` (3 cases for
    PATCH, 2 for DELETE — happy + 409 on non-draft, plus row-state-preserved
    assertion).

- ✅ **scheduled_at must be a future timestamp** —
  - Server-clock check: `apps/api/src/campaigns/service.ts:459-465` throws
    `ValidationError({ code: 'SCHEDULED_AT_IN_PAST' })` (400) when
    `scheduled_at <= Date.now()`.
  - zod validates ISO format upstream (`schema.ts`); the future-time
    invariant lives in the service because zod has no clock.
  - Tested by `apps/api/tests/campaigns.schedule.test.ts:77` ("returns 400
    SCHEDULED_AT_IN_PAST when scheduled_at is in the past, and DOES NOT
    mutate the row").

- ✅ **Sending transitions to sent and cannot be undone** —
  - Atomic `UPDATE ... WHERE status IN ('draft','scheduled')` at
    `service.ts:378-385` flips to `sending`. Worker (`worker.ts`) flips to
    `sent` ATOMICALLY only when still `sending`.
  - Once `sent`, all transition endpoints (PATCH, DELETE, schedule, send)
    return 409 — the conditional `WHERE` clauses make the SQL refuse to
    move it.
  - Tested by `apps/api/tests/campaigns.send.test.ts:183` ("returns 409 when
    the campaign is already sent, and DOES NOT re-send") and the
    state-machine spec coverage above.

- ✅ **Stats response shape** `{ total, sent, failed, opened, open_rate,
  send_rate }` —
  - SQL constant: `apps/api/src/campaigns/stats.ts:48-56` (single-pass
    `COUNT(*) FILTER (WHERE …)` aggregate).
  - JS computation + zero-on-zero guards: `stats.ts:74-103`. `send_rate` =
    sent/total, `open_rate` = opened/sent (not opened/total — opens only
    count after a successful send).
  - Stats are exposed via `GET /campaigns/:id` (nested `stats` field per
    `api-contracts.md:59`) — there is no standalone `/stats` endpoint, the
    brief's example shows the SHAPE not a separate route. The shape exactly
    matches.
  - Tested by `apps/api/tests/campaigns.stats.test.ts` (3 cases:
    all-zero-no-NaN, mixed counts, `open_rate=0` when `sent=0` even with a
    stray opened_at).

### 1.4 Tech requirements

- ✅ **Node.js + Express** — `apps/api/package.json:23`
  (`"express": "^4.21.1"`); app factory `apps/api/src/app.ts:35-66`.
  `.nvmrc` pins Node 20.

- ✅ **PostgreSQL + Sequelize** — `package.json:25-30`
  (`"pg": "^8.13.1"`, `"sequelize": "^6.37.5"`); runtime singleton at
  `apps/api/src/db/sequelize.ts`; Postgres 16 in `docker-compose.yml`.

- ✅ **JWT auth middleware** — `apps/api/src/auth/middleware.ts:30-70`.
  HS256 explicitly pinned in `jwt.verify` options (line 50-52) — defense
  against algorithm-confusion. Mounted at `apps/api/src/app.ts:57-58`.

- ✅ **Input validation (zod)** — schemas at
  `apps/api/src/schemas/auth.schema.ts`, `apps/api/src/campaigns/schema.ts`,
  `apps/api/src/recipients/schema.ts`. zod is the only validation library
  on the wire (no joi / no manual checks).

- ✅ **Migrations** — TS migrations under `apps/api/migrations/000{1..4}-*.ts`,
  driven by `umzug` directly (not sequelize-cli) per ADR-008. Runner at
  `apps/api/src/db/migrate.ts`. Scripts in `apps/api/package.json:13-15`
  (`migrate`, `migrate:undo`, `migrate:status`).

- ✅ **≥3 meaningful tests** — **78 backend tests pass** across 12 files (via
  `yarn workspace @app/api test` — verified during this audit). Tests are
  DB-backed (real Postgres, no mocked SQL) and cover state machine, tenancy,
  validation, security (constant-time login, JWT alg pinning), and async
  worker behavior.

---

## Part 2 — Frontend (React + TypeScript)

### 2.1 Pages

- ✅ **/login** — `apps/web/src/pages/LoginPage.tsx`, registered at
  `apps/web/src/App.tsx:28` (public route). AntD Form, errors flow through
  `<ErrorAlert>` + `messageFor(code, fallback)`.

- ✅ **/campaigns** — `apps/web/src/pages/CampaignsListPage.tsx`, registered
  at `App.tsx:30-37` (wrapped in `<ProtectedRoute>`). Status badges render
  via `<StatusBadge>` (line 101). Pagination via AntD `<Table>` controls.

- ✅ **/campaigns/new** — `apps/web/src/pages/CampaignNewPage.tsx`,
  registered at `App.tsx:38-45`. Form fields: name, subject, body,
  recipient_emails (tag-input).

- ✅ **/campaigns/:id** — `apps/web/src/pages/CampaignDetailPage.tsx`,
  registered at `App.tsx:46-53`. Composes `<StatusBadge>`, `<StatsBlock>`,
  `<RecipientsTable>`, `<CampaignActions>` (lines 161-187).

- ✅ Bonus: **/register** — `apps/web/src/pages/RegisterPage.tsx`, registered
  at `App.tsx:29` (public, not in the brief — adds polish for the demo).

- ✅ **JWT in memory** — `apps/web/src/store/auth.ts:29-34` (zustand store; no
  localStorage / sessionStorage). Trade-off accepted in ADR-003 + documented
  in spec-final-polish.md "Known limitations".

### 2.2 UI features

- ✅ **Status badges with correct colors** —
  `apps/web/src/components/StatusBadge.tsx:22-27`:
  - `draft` → `default` (grey) ✓
  - `scheduled` → `processing` (blue, with AntD pulsing dot) ✓
  - `sending` → `warning` (orange, polish beyond brief)
  - `sent` → `success` (green) ✓
  Tested in `apps/web/src/components/StatusBadge.test.tsx` (4 cases — one
  per status).

- ✅ **Action buttons conditional on status** —
  `apps/web/src/components/CampaignActions.tsx:120-198`. Per state:
  - `draft` (122-164) → [Schedule] [Send] [Delete]
  - `scheduled` (166-187) → [Send] + display scheduled_at
  - `sending` (189-196) → Spin "Sending in progress…"
  - `sent` (198) → "Already sent" tag (no actions)

- ✅ **Stats display via progress/chart** —
  `apps/web/src/components/StatsBlock.tsx:26-59`. 4 `<Statistic>` (total,
  sent, failed, opened) + 2 `<Progress>` bars (send_rate, open_rate as %).
  Server numbers rendered as-is (no client recompute) per business-rules.

- ✅ **Error handling** — `apps/web/src/components/ErrorAlert.tsx` +
  `apps/web/src/types/api-error.ts` `messageFor(code, fallback)`. Always
  pattern-matches on error CODE, never raw `error.message`. Used across all
  4 pages (`grep -n ErrorAlert` verified).

- ✅ **Loading states** — Skeleton in
  `apps/web/src/pages/CampaignsListPage.tsx:183` (`<Skeleton active
  paragraph={{ rows: 6 }} />`) and `CampaignDetailPage.tsx:81` (rows 8).
  Spin in `CampaignActions.tsx:191` (sending state).

### 2.3 Tech requirements

- ✅ **React 18 + TypeScript + Vite** — `apps/web/package.json:21-22`
  (`react 18.3.1`), `28-29` (`typescript 5.4.5`), `34` (`vite ^5.4.6`).
  Entry `apps/web/src/main.tsx:17`.

- ✅ **React Query** — `package.json:18` (`@tanstack/react-query ^5.59.0`).
  Hooks at `apps/web/src/hooks/useCampaigns.ts:26` (`useMutation`,
  `useQuery`, `useQueryClient`). Provider mounted at `main.tsx:20`.

- ✅ **Component library** — Ant Design 5 (`package.json:19`,
  `"antd": "^5.21.0"`). `<ConfigProvider>` at `main.tsx:19`.

- ✅ **Zustand** — `package.json:24` (`"zustand": "^4.5.5"`). Auth store at
  `apps/web/src/store/auth.ts`.

---

## Part 3 — AI usage showcase

- ✅ **README has "How I Used Claude Code" section** — `README.md:167`.
- ✅ **Covers what was delegated** — `README.md:173-196` (F1 + F2 by agent
  role: architect, backend, frontend, devops, unit-tester, code-reviewer).
- ✅ **2-3 real prompts** — `README.md:198-208` (F1 architect, F1
  unit-tester, F2 integration-tester, F2 code-reviewer — actually 4 real
  prompts, more than the minimum).
- ✅ **Where Claude Code was wrong + corrections** — `README.md:210-221`
  covering F1 jest-config-ts mistake, tsconfig noEmit+composite conflict,
  yarn nohoist surprise, F2 inter-agent contract drift, JWT alg-confusion
  miss, body-size-limit miss, sequelize-cli spec deviation done right.
- ✅ **What you would NOT let Claude Code do** — `README.md:223-231`
  (decide schema/business rules, run destructive commands, skip tests, mock
  the DB, bury security findings, pick `latest`, auto-commit between
  passes).
- ⚠️ **F3 + F4 + F5 retrospective** — currently only F1 + F2 retrospective is
  in the README; the spec (`spec-final-polish.md` line 43) calls for the
  F3-F5 sections to be appended as part of the **F6 finalize step that
  follows this audit**. Not yet present at audit time. Pre-flagged here so
  the finalize step doesn't miss it. Recommended content lives in
  `log-{campaigns-crud,schedule-send,frontend-pages,final-polish}.md`.
- ⚠️ **CI status badge** — spec line 41 calls for a CI badge in the README;
  not present at audit time. Same finalize-step responsibility.
- ⚠️ **Known limitations section** — spec line 44 calls for it; not present
  at audit time. Finalize step responsibility.
- ⚠️ **Architecture overview / ASCII or Mermaid diagram** — spec line 45;
  README has a basic file-tree under "Repository layout" but no diagram of
  the request flow. Finalize step responsibility.
- ⚠️ **Submission walkthrough summary at the very top** — spec line 46;
  not present at audit time. Finalize step responsibility.
- ⚠️ **Singular/plural deviation callout** — `POST /recipient` →
  `POST /recipients`. Documented in api-contracts.md and decisions.md
  ADR-012 but not yet surfaced in the README. Should be a 1-line note in the
  finalize step.

---

## Evaluation criteria — strongest evidence

- ✅ **Backend correctness + business rules** — Atomic SQL state-machine
  guards at `apps/api/src/campaigns/service.ts:357-417` (three
  `ATOMIC_*_SQL` constants, each with `WHERE status IN (...)` clauses that
  make the state guard a SQL-level invariant — closes the find-then-update
  race by construction). Verified by 78 DB-backed integration tests.

- ✅ **API design (REST, error codes, response shapes)** — Uniform error
  envelope `{ error: { code, message } }` with stable codes
  (`CAMPAIGN_NOT_FOUND`, `CAMPAIGN_NOT_EDITABLE`, `CAMPAIGN_NOT_SCHEDULABLE`,
  `CAMPAIGN_NOT_SENDABLE`, `SCHEDULED_AT_IN_PAST`, `EMAIL_TAKEN`,
  `INVALID_CREDENTIALS`, `TOKEN_EXPIRED`, `INVALID_TOKEN`, etc.) dispatched
  via `apps/api/src/errors/handler.ts`. Tenancy returns 404 (NOT 403 — see
  `business-rules.md` "Tenancy by created_by" + service.ts comments at
  lines 7-9) so existence isn't leaked.

- ✅ **Frontend quality (UX, loading, error states, component structure)** —
  Component split is clean: `<StatusBadge>`, `<StatsBlock>`,
  `<RecipientsTable>`, `<CampaignActions>`, `<ErrorAlert>` are all
  single-purpose and reusable. Strongest single artifact:
  `apps/web/src/components/CampaignActions.tsx` — every button is
  conditionally rendered against the campaign's status state machine
  (lines 120-198), and EVERY mutation error flows through `messageFor(code,
  fallback)` (line 59), never `error.message`.

- ✅ **Code quality (readability, separation of concerns)** — Backend layered
  consistently as routes → controller → service → SQL. No business logic in
  controllers. No HTTP details in services. The `ATOMIC_*_SQL` constants
  hoisted to module scope let the docstring explain WHY each SQL clause is
  load-bearing (`apps/api/src/campaigns/service.ts:332-417`). Frontend
  mirrors this with `lib/api.ts` (axios + interceptors), `lib/queryClient.ts`,
  `hooks/useCampaigns.ts` (data layer), `pages/*` (composition only).

- ✅ **AI collaboration (judgment, transparency)** — README §"How I Used
  Claude Code" (lines 167-231): names the 6-agent pipeline, lists 4 real
  prompts, names 6 specific places where Claude Code was wrong, lists 7
  things the human refused to delegate. The `.hody/` folder shows 6
  feature-pass workflows with per-agent logs, ADRs (ADR-001..012), tech-debt
  ledger, and spec→build→verify gates — this is the audit trail.

- ✅ **Testing (meaningful coverage and rationale)** — **78 backend +
  8 frontend = 86 tests** all passing (verified during this audit via
  `yarn workspace @app/api test` and `yarn workspace @app/web test`).
  Backend tests are DB-backed (no mocked SQL — see ADR-007 / "What I would
  NOT let Claude Code do") and meaningfully cover edge cases:
  state-machine 409s, foreign-tenant 404 (no existence leak), constant-time
  login, JWT algorithm pinning, atomic worker race-freeness, idempotent
  open-tracking. Strongest single artifact:
  `apps/api/tests/campaigns.send.test.ts` — exercises the
  send-immediately-then-async-worker contract end-to-end with both happy
  path and 100-recipient random distribution + worker timing assertion.

---

## Submission instructions

- ✅ **Public GitHub repo** — `https://github.com/hodynguyen/Mini_Campaign_Manager.git`
  (verified via `git remote -v`). User must confirm repo visibility is set
  to public before sending the link.

- ✅ **README has local setup with `docker compose up`** —
  `README.md:42` (`docker compose up -d`); full quick-start at lines 26-56.
  `docker-compose.yml` provisions Postgres 16 with healthcheck.

- ✅ **Seed data / demo script** — `apps/api/src/db/seed.ts` (282 lines).
  Runs via `yarn workspace @app/api seed` (script wired in
  `apps/api/package.json:16`). Idempotent (User+Recipient `findOrCreate`,
  Campaign delete-and-recreate scoped to demo user). Creates demo user
  `demo@example.com / demo1234`, 15 recipients, 4 campaigns (one per state)
  including a `sent` campaign with `open_rate = 5/8 = 62.5%` so the
  reviewer sees non-zero stats immediately. ⚠️ Not yet referenced in
  README quick-start — finalize step should add a "seed the demo data"
  bullet near the docker compose step.

- ✅ **"How I Used Claude Code" section** — `README.md:167-231` (see Part 3
  above). ⚠️ Currently F1+F2 only; F3-F5 retrospective is the finalize-step
  responsibility per the spec.

---

## Summary

- **Total ASSIGNMENT.md line items audited:** 64
- **✅ Met:** 56
- **⚠️ Partial (all README/finalize-step deferrals tracked in spec):** 8
- **❌ Unmet:** 0
- **Test count:** 78 backend (jest) + 8 frontend (vitest) = **86 total** —
  exceeds the brief's "≥3 meaningful tests" by 28×.
- **LOC delta (apps/api/src + apps/web/src + apps/api/migrations + tests):**
  ~9.7k TS/TSX lines.
- **Verdict:** Implementation is feature-complete and spec-compliant. All ⚠️
  partials are README-finalize-step deferrals already enumerated in
  `spec-final-polish.md` and explicitly assigned to the post-audit finalize
  step (NOT to backend/frontend work). No code-level gaps. Workflow status
  can flip to `verified` once this audit is committed.

### What the README finalize step MUST add (consolidated from the ⚠️ above)

1. CI status badge near the top.
2. Submission walkthrough summary at the very top (1-2 paragraphs).
3. F3 + F4 + F5 sections of "How I Used Claude Code" (parallel to F1 + F2).
4. "Known limitations" section (in-memory JWT, no rate-limiting, in-process
   worker, 24h JWT no refresh).
5. Architecture overview diagram (ASCII or Mermaid).
6. `yarn workspace @app/api seed` reference in the Quick start.
7. 1-line callout: "brief writes `POST /recipient` (singular); shipped as
   `POST /recipients` per REST convention — see ADR-012".

All 7 are tracked in the spec's Definition of Done and on the open
`F6 — finalize` task.
