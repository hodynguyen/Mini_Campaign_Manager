---
tags: [log, api-endpoint, campaigns, recipients]
date: 2026-05-08
author-agent: start-feature
status: completed
---

# Feature Log: F3 — Campaigns + Recipients CRUD + state machine

Type: api-endpoint
Started: 2026-05-08
Mode: auto

## Spec
-> spec-campaigns-crud.md

## Agent Work

### architect — F3 campaigns/recipients scaffolding

- Files created:
  - `apps/api/migrations/0002-create-campaigns.ts` — CREATE TYPE campaign_status, CREATE TABLE campaigns + 2 indexes (`(created_by, updated_at DESC)` and partial `(status, scheduled_at) WHERE status='scheduled'`).
  - `apps/api/migrations/0003-create-recipients.ts` — CREATE TABLE recipients (CITEXT email UNIQUE, no `created_by` per ADR-012, no `updated_at`).
  - `apps/api/migrations/0004-create-campaign-recipients.ts` — CREATE TYPE campaign_recipient_status, join table with FKs (campaign_id ON DELETE CASCADE, recipient_id ON DELETE RESTRICT), UNIQUE (campaign_id, recipient_id), index on campaign_id.
  - `apps/api/src/db/models/Campaign.ts` — Sequelize model. ENUM status field, scheduledAt nullable, underscored:true. NO associations in this file.
  - `apps/api/src/db/models/Recipient.ts` — Sequelize model. timestamps:true with updatedAt:false (only created_at exists in table).
  - `apps/api/src/db/models/CampaignRecipient.ts` — Sequelize model. timestamps:false. Has its own UUID PK in addition to UNIQUE (campaign_id, recipient_id).
  - `apps/api/src/db/associations.ts` — Centralized `User.hasMany(Campaign)`, `Campaign.hasMany(CampaignRecipient)`, `Recipient.hasMany(CampaignRecipient)`, plus M:N via belongsToMany. Single-import wires everything.
  - `apps/api/src/campaigns/schema.ts` — zod `createCampaignSchema` (1-120 name, 1-200 subject, 1-10000 body, 0-1000 recipient_emails, all `.strict()`), `updateCampaignSchema` (`.partial().strict()` — never accepts status/scheduled_at/created_by), `listQuerySchema` (page/limit/status with coerce + caps).
  - `apps/api/src/campaigns/service.ts` — Function signatures for `listCampaigns`, `createCampaign`, `getCampaignDetail`, `updateCampaign`, `deleteCampaign` with TODO bodies. Each function's JSDoc spells out the exact SQL/Sequelize approach + the error-code contract (CAMPAIGN_NOT_FOUND, CAMPAIGN_NOT_EDITABLE).
  - `apps/api/src/campaigns/stats.ts` — `STATS_SQL` constant + `computeCampaignStats(campaignId)` skeleton. Uses `COUNT(*) FILTER (WHERE ...)::int`, named bind via `replacements`, `QueryTypes.SELECT`. TS comments document the rate computation + zero-on-zero guard.
  - `apps/api/src/recipients/schema.ts` — zod `createRecipientSchema` (lowercased email), `listRecipientsQuerySchema` (page/limit/optional search).
  - `apps/api/src/recipients/service.ts` — Function signatures for `listRecipients`, `createRecipient` with TODO bodies. Documents 409 RECIPIENT_EMAIL_TAKEN mapping pattern.
- Files modified:
  - `apps/api/tests/helpers/server.ts` — Added side-effect imports for Campaign, Recipient, CampaignRecipient models + associations. `truncate()` now wipes `campaign_recipients`, `campaigns`, `recipients`, `users` in one TRUNCATE ... CASCADE statement.
  - `packages/shared/src/index.ts` — Added type-only exports: `CampaignStatus`, `CampaignRecipientStatus`, `Campaign`, `Recipient`, `CampaignRecipientRow`, `CampaignStats`, `CampaignDetail`, `CreateCampaignRequest`, `UpdateCampaignRequest`, `PaginatedList<T>`. Updated header comment to mention F3 surface and corrected ADR reference (ADR-009 not ADR-010).
- KB updated:
  - `.hody/knowledge/architecture.md` — Appended `## F3 Campaigns CRUD — Locked Decisions` section: file map, model relationship diagram + association alias table, stats query (constant + bind pattern), list-query shape, index plan + rationale, exact mount order for app.ts, deviations note.
  - `.hody/knowledge/decisions.md` — Authored ADR-012 (recipients are tenant-shared, no `created_by` column). Justified per spec/brief schema + dedup pragmatics; consequences include no DELETE /recipients in F3.
- Key decisions:
  - **Centralized associations file** — All `hasMany`/`belongsTo` calls live in `src/db/associations.ts`, imported once at boot (and once in test helpers). Avoids the model-load-order pitfalls of scattering `Campaign.hasMany(CampaignRecipient, ...)` across model files.
  - **Stats via raw SQL with FILTER, not Sequelize aggregate API** — Sequelize can't natively express `COUNT(*) FILTER (WHERE ...)`; doing four conditional counts in one pass is the whole point. Bound via `replacements` (named param), `QueryTypes.SELECT`. SQL-injection-safe.
  - **CampaignRecipient gets its own UUID PK** in addition to the UNIQUE (campaign_id, recipient_id). Spec implies but doesn't enforce a PK. Reason: simplifies F4 open-tracking endpoint (`findByPk(crId)`) and any row-level ops.
  - **Recipient model has timestamps:true, updatedAt:false** — table only has `created_at`; Sequelize default would expect both columns and fail.
  - **`updateCampaignSchema = .partial().strict()`** — `.strict()` is the load-bearing security guard; it rejects `status`, `scheduled_at`, `created_by` injection from PATCH bodies with 400 VALIDATION_ERROR.
  - **Service functions all take `userId` as the first arg** — tenancy contract is "scope by created_by = userId; foreign access returns 404, not 403". Every TODO spells out the `findOne({ where: { id, created_by: userId } })` pattern.
- Hand-off notes for backend:
  - Migrations to run: `yarn workspace @app/api migrate` (umzug auto-discovers 0002/0003/0004; status check: `migrate:status`).
  - Files to fill (TODO bodies):
    - `apps/api/src/campaigns/service.ts` — 5 functions (list/create/get/update/delete).
    - `apps/api/src/campaigns/stats.ts` — `computeCampaignStats` (use `STATS_SQL` constant verbatim).
    - `apps/api/src/recipients/service.ts` — 2 functions (list/create).
  - Files to create from scratch:
    - `apps/api/src/campaigns/controller.ts` — request handlers (parse zod → call service → JSON response). Pattern from `auth/controller.ts`.
    - `apps/api/src/campaigns/routes.ts` — Router with GET /, POST /, GET /:id, PATCH /:id, DELETE /:id. Async-handler wrap pattern from `auth/routes.ts`.
    - `apps/api/src/recipients/controller.ts` — same pattern.
    - `apps/api/src/recipients/routes.ts` — Router with GET /, POST /.
  - Mount order in `apps/api/src/app.ts` (add AFTER `/auth` mount, BEFORE `errorHandler`):
    ```ts
    import campaignsRouter from './campaigns/routes';
    import recipientsRouter from './recipients/routes';
    import { requireAuth } from './auth/middleware';
    // ...
    app.use('/campaigns', requireAuth, campaignsRouter);
    app.use('/recipients', requireAuth, recipientsRouter);
    ```
  - In `apps/api/src/index.ts`, add `import './db/associations';` next to the existing `./db/models/User` side-effect import. Tests already import it via `tests/helpers/server.ts`.
  - Imports backend should use:
    - `import { sequelize } from '../db/sequelize';` (services).
    - `import { QueryTypes } from 'sequelize';` (stats.ts already imports — keep).
    - `import { Campaign } from '../db/models/Campaign';` etc.
    - `import { ConflictError, NotFoundError, ValidationError } from '../errors/AppError';`.
    - `import { computeCampaignStats } from './stats';` (in service.ts).
    - `import type { Campaign as CampaignDTO, CampaignDetail, PaginatedList, Recipient as RecipientDTO } from '@app/shared';`.
  - Error codes contract:
    - `CAMPAIGN_NOT_FOUND` → 404 (NotFoundError) — also for foreign-user access (tenancy).
    - `CAMPAIGN_NOT_EDITABLE` → 409 (ConflictError) — PATCH/DELETE on status != 'draft'.
    - `RECIPIENT_EMAIL_TAKEN` → 409 (ConflictError) — UniqueConstraintError on POST /recipients.
    - `VALIDATION_ERROR` → 400 (handled by errors/handler.ts on ZodError).
  - DO NOT expose status/scheduled_at via PATCH — those transitions are F4 (`POST /:id/schedule`, `POST /:id/send`).
- Hand-off notes for integration-tester:
  - `truncate()` already extended — calling it in `afterEach` cleans `campaign_recipients`, `campaigns`, `recipients`, `users` (CASCADE).
  - Side-effect imports in `tests/helpers/server.ts` register all 4 models + associations. Direct `Campaign.findByPk(...)` etc. works in tests.
  - Critical test files (per spec §10 — ≥10 tests across 5 files):
    - `tests/campaigns.crud.test.ts` — list (paginated + filter), create, get-with-stats happy paths.
    - `tests/campaigns.tenancy.test.ts` — **security-relevant**: foreign-user GET/PATCH/DELETE all return 404, NOT 403. Don't leak existence.
    - `tests/campaigns.state-machine.test.ts` — **business rules**: PATCH on draft OK, PATCH on scheduled/sending/sent → 409 CAMPAIGN_NOT_EDITABLE. Same for DELETE.
    - `tests/campaigns.stats.test.ts` — seed campaign_recipients with mixed statuses, assert send_rate / open_rate (including zero denominators).
    - `tests/recipients.crud.test.ts` — list, create, dup → 409 RECIPIENT_EMAIL_TAKEN.
  - Helper to seed a campaign in a non-draft state: directly UPDATE the row via `sequelize.query` (no public endpoint to transition status in F3 — F4 adds those).
- Open questions / risks:
  - `Recipient` model uses `timestamps: true` + `updatedAt: false` — confirmed against migration (only `created_at` column exists). If backend hits a Sequelize warning about missing `updated_at` on insert, double-check this combination in the Sequelize 6 docs.
  - `Campaign.status` field uses Sequelize ENUM mirror; the actual SQL type is owned by the migration's `CREATE TYPE campaign_status`. If `tsc` complains about the ENUM vs string union mismatch, backend may need to assert `status: campaign.status as CampaignStatus` at the DTO mapping site. Documented in the model file.
  - I did NOT run `yarn install` or invoke any migrations. Backend should run `yarn workspace @app/api migrate` (umzug picks up 0002-0004 automatically) before writing service implementations so they can iterate against a real DB.

### backend — F3 campaigns/recipients implementation

- Migration result: applied 0001 (was pending in dev DB), 0002, 0003, 0004 against both `campaign` and `campaign_test` databases. `migrate:status` confirms all 4 executed, 0 pending. Re-running `yarn migrate` is a no-op (idempotent).
- Files created:
  - `apps/api/src/utils/asyncHandler.ts` — extracted shared promise-rejection forwarder; replaces the inline copy in `auth/routes.ts`.
  - `apps/api/src/campaigns/controller.ts` — list/create/get/update/delete handlers + `requireUserId` and `requireParamId` helpers.
  - `apps/api/src/campaigns/routes.ts` — Router with GET / POST / GET :id / PATCH :id / DELETE :id.
  - `apps/api/src/recipients/controller.ts` — list/create handlers.
  - `apps/api/src/recipients/routes.ts` — Router with GET / and POST /.
  - `apps/api/.env` — copied from `.env.example` so migrations / dev server can boot.
- Files modified:
  - `apps/api/src/campaigns/service.ts` — implemented the 5 functions per architect's TODO contracts.
  - `apps/api/src/campaigns/stats.ts` — implemented `computeCampaignStats` using `STATS_SQL` verbatim with named-bind `{ campaignId }` and zero-on-zero rate guards.
  - `apps/api/src/recipients/service.ts` — implemented `listRecipients` (with optional `Op.iLike` search) and `createRecipient` (UniqueConstraintError → 409 RECIPIENT_EMAIL_TAKEN).
  - `apps/api/src/auth/routes.ts` — refactored to import `asyncHandler` from `../utils/asyncHandler`. F2 tests still pass (24/24).
  - `apps/api/src/app.ts` — mounted `/campaigns` and `/recipients` behind `requireAuth`, after `/auth`/`/health`, before `errorHandler`.
  - `apps/api/src/index.ts` — added side-effect imports for Campaign / Recipient / CampaignRecipient + associations so the production process boots with all models registered (tests already had this via `tests/helpers/server.ts`).
- Service summary:
  - `listCampaigns`: `Campaign.findAndCountAll({ where: { createdBy, ...status?status:{} }, order: [['updated_at','DESC']], limit, offset })`. Returns `{ data, meta: { page, limit, total } }`. Index `(created_by, updated_at DESC)` from migration 0002 covers it.
  - `createCampaign`: single `sequelize.transaction`. Creates Campaign with `status: 'draft'`. If `recipient_emails` non-empty, dedupes + lowercases, then `Recipient.findOrCreate({ where: { email }, defaults: { email, name: email-prefix } })` per email (sequential — capped at 1000 by zod). Builds CR rows with `status: 'pending'` and `bulkCreate` with `ignoreDuplicates: true` against the UNIQUE (campaign_id, recipient_id) constraint. Returns Campaign DTO.
  - `getCampaignDetail`: Tenancy-scoped `findOne({ where: { id, createdBy } })` → throws `NotFoundError({ code: 'CAMPAIGN_NOT_FOUND' })` on miss. Then runs `computeCampaignStats(id)` and `CampaignRecipient.findAll({ where: { campaignId }, include: [{ model: Recipient, as: 'recipient', required: true }], order: [['id','ASC']] })` in parallel (Promise.all). Maps eager-loaded `cr.get('recipient')` to `CampaignRecipientRow`. Returns `{ ...campaign, stats, recipients }`.
  - `updateCampaign`: 404 if absent; throws `ConflictError({ code: 'CAMPAIGN_NOT_EDITABLE', message: 'Campaign can only be edited in draft state' })` (409) when `status !== 'draft'`. Builds an `updates` object skipping undefined keys (workaround for `exactOptionalPropertyTypes: true` in Sequelize's `update()` types).
  - `deleteCampaign`: same find + state-machine guard, then `campaign.destroy()`. FK ON DELETE CASCADE on `campaign_recipients.campaign_id` cleans up join rows automatically.
- DRY refactor: `asyncHandler` extracted from `auth/routes.ts` into `apps/api/src/utils/asyncHandler.ts`. Auth and the two new routers now share one implementation. F2 tests remain green.
- Build / lint / test results:
  - `yarn workspace @app/api build` → clean (`tsc -p` exit 0).
  - `yarn lint` → 0 errors, 1 pre-existing warning (`no-console` in `db/sequelize.ts` — not mine).
  - `yarn workspace @app/api test` → 24/24 (F2) still green; no new tests added (per scope — integration-tester runs next).
  - Smoke booted `createApp()` + all model imports under tsx — no runtime errors.
- Notes for integration-tester:
  - **Tenancy is enforced by `createdBy = userId` filter on every `Campaign.findOne` / `findAndCountAll`** — write tests where userA creates a campaign and userB GET/PATCH/DELETE returns 404 (NOT 403). The error code is `CAMPAIGN_NOT_FOUND`, identical to the genuine-404 path.
  - **State-machine 409 returns `code: "CAMPAIGN_NOT_EDITABLE"`** on PATCH/DELETE when `status !== 'draft'`. Use `sequelize.query("UPDATE campaigns SET status='scheduled' WHERE id=:id", { replacements })` to seed a non-draft state directly (no public endpoint to transition status in F3).
  - **Recipient dedup is via `findOrCreate` by email**. Test: send `recipient_emails: ['Foo@Bar.com', 'foo@bar.com', 'foo@bar.com']` → exactly one Recipient row + one CampaignRecipient row. CITEXT in DB also enforces this at the constraint level.
  - **Stats**: with no CR rows, `total=sent=failed=opened=0` and both rates are 0 (not NaN). Seed 5 CRs (3 sent, 1 failed, 1 pending; 2 of the sent rows have `opened_at`) → `total=5, sent=3, failed=1, opened=2, send_rate=0.6, open_rate=0.666...`.
  - **Recipient duplicate**: POST /recipients with an existing email returns 409 `RECIPIENT_EMAIL_TAKEN` (NOT the generic `UNIQUE_CONSTRAINT`).
  - **PATCH .strict() guard**: sending `{ status: 'sent' }` or `{ scheduled_at: '2030-01-01' }` or `{ created_by: '<other>' }` returns 400 `VALIDATION_ERROR` (zod `.strict()` rejects unknown keys).
  - The test DB (`campaign_test`) is now fully migrated. `tests/helpers/server.ts` already truncates the new tables CASCADE on each `truncate()` call.
- Open questions / risks:
  - None blocking. The Sequelize `order: [['updated_at','DESC']]` works because Sequelize v6 accepts column-name strings directly when the model declares `underscored: true`. If integration-tester hits issues with the order key, the alternate is `order: [['updatedAt','DESC']]` — both produce `ORDER BY updated_at DESC` in this codebase.
  - `req.params['id']` is narrowed via `requireParamId` (TS `noUncheckedIndexedAccess` makes `req.params.id: string | undefined`). This should never fire under the routing config, but it returns 404 CAMPAIGN_NOT_FOUND if it ever does — same shape as a genuine miss.

### integration-tester — F3 campaigns/recipients tests

- Files created:
  - `apps/api/tests/helpers/auth.ts` — `createTestUser(app, suffix)` plus
    `createUserA(app)` / `createUserB(app)` convenience wrappers. Each helper
    register-then-logs-in a user against the live `/auth` surface and returns
    `{ token, userId, email, name, password }`. Tenancy + state-machine suites
    use the two-user variant; CRUD suites use the single-user variant.
  - `apps/api/tests/campaigns.crud.test.ts` — happy-path coverage for list /
    create / get-detail. 6 tests including the mixed-case dedupe scenario.
  - `apps/api/tests/campaigns.tenancy.test.ts` — foreign-user 404 + per-route
    401 coverage. 9 tests.
  - `apps/api/tests/campaigns.state-machine.test.ts` — PATCH/DELETE happy +
    409-on-non-draft + .strict() PATCH security guard. 9 tests (incl. it.each
    on scheduled/sending/sent and it.each on status/scheduled_at/created_by
    injection).
  - `apps/api/tests/campaigns.stats.test.ts` — empty / mixed-CR / open-without-
    sent guard. 3 tests.
  - `apps/api/tests/recipients.crud.test.ts` — list (paginated + ?search=) +
    create (happy / lowercase / dup-409 / 400 / 401). 8 tests.
- Files modified: none in source. No bugs found in F3 source code — all 35
  new tests passed on the first run alongside the existing 24 F2 tests.
- Test counts:
  - campaigns.crud.test.ts: 6
  - campaigns.tenancy.test.ts: 9
  - campaigns.state-machine.test.ts: 9
  - campaigns.stats.test.ts: 3
  - recipients.crud.test.ts: 8
  - Total F3: 35 (target ≥10 — exceeded by 25)
  - Total project (F1+F2+F3): 59 passing (target ≥34 — exceeded by 25)
- Bugs found in source: none. Backend's hand-off notes were accurate end-to-end.
- Build / lint:
  - `yarn workspace @app/api build` → clean.
  - `yarn lint` → 0 errors, 1 pre-existing warning (`no-console` in
    `db/sequelize.ts`, not introduced by this work).
- Final result: PASS — 59/59 tests green, build + lint clean.
- Notes for code-reviewer:
  - Tenancy 404-not-403 is exercised end-to-end in `campaigns.tenancy.test.ts`
    on GET, PATCH, and DELETE — each variant also asserts the DB row is
    untouched (PATCH name unchanged, DELETE row still present). The error
    body is identical to a genuine miss (`code: 'CAMPAIGN_NOT_FOUND'`), so a
    foreign-user probe cannot distinguish "exists but not yours" from "doesn't
    exist". Verified.
  - Stats float math uses `toBeCloseTo(value, 4)` for rates to dodge IEEE-754
    precision drift across the Postgres → node-postgres → JS path. Counts are
    asserted with strict `toBe` since they are Postgres int casts.
  - The `.strict()` PATCH guard is exercised on a draft campaign with
    `{ status }`, `{ scheduled_at }`, and `{ created_by }` payloads. All three
    return 400 VALIDATION_ERROR and leave the row's `status='draft'`,
    `scheduled_at=null`, `createdBy=<original userId>` invariants intact.
  - The CR-fixture test (`campaigns.stats.test.ts`) seeds 5 recipients via
    `POST /campaigns` (so we exercise the upsert path) and then directly
    mutates `CampaignRecipient` rows for the per-row state. This avoids
    bypassing the public create flow while still reaching the non-default
    statuses that F4 will set.
  - Pagination meta defaults are asserted: campaigns default `limit=20`,
    recipients default `limit=50` (per their respective zod schemas).
  - `recipients.crud.test.ts` includes a search test where the substring
    "alice" matches both an email (`alice@example.com`) and a name
    (`Dave Alicea`) — proves the `Op.or` branch in service.ts.
  - The 401 coverage on `/recipients` and `/campaigns` is per-route via
    parameterized it.each — confirms `requireAuth` is mounted on every entry
    point, not just one.
- Open risks: none. The 5ms `setTimeout` between `POST /campaigns` calls in
  the list-order test (`campaigns.crud.test.ts`) is the only place a flake
  could surface if Postgres timestamptz precision were to suddenly drop —
  Postgres documents microsecond resolution, so 5ms is ~5000x safe.

### code-reviewer — F3 review

- **Verdict: APPROVED-WITH-NITS** — all BLOCKER + HIGH gates pass. 4 nits filed
  to tech-debt (2 MEDIUM, 2 LOW + 1 LOW doc), none ship-blocking.

- **Findings (severity table):**

  | Severity | Area | Item | Decision |
  | --- | --- | --- | --- |
  | PRAISE | Tenancy | `findOne({ where: { id, createdBy } })` on every single-campaign endpoint; foreign-user GET/PATCH/DELETE all 404 with `CAMPAIGN_NOT_FOUND` (verified end-to-end in `campaigns.tenancy.test.ts` + DB-state assertions). Identical body to a genuine miss — no existence leak. | none |
  | PRAISE | SQL injection | Stats raw SQL is a `const` string, single bind via `replacements: { campaignId }`, `QueryTypes.SELECT`. Only raw query in F3. ILIKE pattern in recipients service is parameterized via Sequelize `Op.iLike`, not string-concatenated. Migrations are static SQL. | none |
  | PRAISE | Stats correctness | Single SQL via `COUNT(*) FILTER (WHERE ...)::int`, indexed by `idx_cr_campaign_id` (verified via EXPLAIN). `send_rate` denominator is `total`, `open_rate` denominator is `sent` (per spec). Zero-on-zero guards on both. Counts are int, rates are float in [0, 1]. | none |
  | PRAISE | State machine | PATCH/DELETE both 409 with `code: 'CAMPAIGN_NOT_EDITABLE'` on non-draft (verified for `scheduled`/`sending`/`sent` via `it.each`). zod `.partial().strict()` rejects `status`/`scheduled_at`/`created_by` injection on PATCH with 400 VALIDATION_ERROR (verified via `it.each`, with DB-state invariants). | none |
  | PRAISE | Transactions | `createCampaign` wraps recipient `findOrCreate` + CR `bulkCreate` in `sequelize.transaction(...)`. Any throw rolls everything back — no orphan campaigns. | none |
  | PRAISE | Indexes | All three indexes from spec exist (`idx_campaigns_created_by_updated_at`, partial `idx_campaigns_status_scheduled_at WHERE status='scheduled'`, `idx_cr_campaign_id`). EXPLAIN confirms list query hits the composite index, stats hits the cr index. | none |
  | PRAISE | Cascade | `DELETE /campaigns/:id` on a draft cascades CR rows via FK `ON DELETE CASCADE`. Tested. Foreign user DELETE leaves the row + CRs untouched. | none |
  | PRAISE | DRY | `asyncHandler` extracted to `utils/asyncHandler.ts`; `auth/routes.ts`, `campaigns/routes.ts`, `recipients/routes.ts` all import the same impl. F2's 24 tests still green after the refactor. | none |
  | PRAISE | Mount order | `helmet → cors → morgan → json(100kb) → /auth → /health → requireAuth+/campaigns → requireAuth+/recipients → errorHandler`. helmet ahead of cors is the safer order; 100kb JSON cap prevents body-DOS. | none |
  | PRAISE | Error mapping | `UniqueConstraintError` → `RECIPIENT_EMAIL_TAKEN` (409) at service level. Generic 500 handler does NOT leak `err.message` or stack — body is `{ code: 'INTERNAL', message: 'Internal Server Error' }` only. JWT errors map to TOKEN_EXPIRED / INVALID_TOKEN. | none |
  | PRAISE | Validation | `recipient_emails` zod-capped at 1000 (DOS guard). `name`/`subject`/`body` length-bounded. `.trim()` before `.min(1)` rejects whitespace-only. `recipients.email` lowercased + trimmed by zod before insert. | none |
  | MEDIUM | Concurrency | `updateCampaign` / `deleteCampaign` find-then-check-then-update is not atomic. Currently unreachable in F3 (no concurrent transition path exists), but F4's `schedule`/`send` endpoints will create the race. → `tech-debt.md` | defer to F4 |
  | MEDIUM | Performance | `recipient_emails` upsert in `createCampaign` is a sequential `findOrCreate` loop, up to N round-trips in a single transaction. Acceptable for typical inputs; pathological at the spec cap (1000). → `tech-debt.md` | defer |
  | LOW | Code | `bulkCreate({ ignoreDuplicates: true })` is dead-code defense after JS-side `Set` dedup. → `tech-debt.md` | defer |
  | LOW | Docs | `updateCampaign` JSDoc claims `update({})` bumps `updated_at`; verified via DEBUG_SQL that Sequelize skips the UPDATE entirely when no fields changed. → `tech-debt.md` | defer (doc-only) |
  | LOW | UX | Recipient `name` fallback (`email.split('@')[0]`) on auto-upsert is a sane default; would benefit from light cleanup (capitalize, strip plus-tags) in F5. → `tech-debt.md` | defer to F5 |

- **Fixes applied during review (BLOCKER only):** none. No BLOCKER or HIGH issues
  found.

- **DoD checklist outcome:**
  - [x] `yarn workspace @app/api migrate` applies 0002/0003/0004 cleanly (idempotent re-run is no-op).
  - [x] `yarn workspace @app/api test` → 59/59 (24 F2 + 35 F3) all green on this run.
  - [x] `GET /campaigns` paginated + `requireAuth` + scoped by `created_by`. List leak test in `campaigns.tenancy.test.ts`.
  - [x] `POST /campaigns` creates draft + attaches recipients in single transaction. Mixed-case dedup test passes.
  - [x] `GET /campaigns/:id` returns campaign + stats + recipients in one response (single-flight stats SQL, parallel CR include).
  - [x] `PATCH /campaigns/:id` 409s on non-draft with `CAMPAIGN_NOT_EDITABLE`. `it.each` over `scheduled`/`sending`/`sent`.
  - [x] `DELETE /campaigns/:id` 409s on non-draft, cascades CR rows on draft success (FK `ON DELETE CASCADE` + DB-state assertions).
  - [x] Foreign-user campaign access → 404 (NOT 403, NOT 200), DB row untouched.
  - [x] Stats query is single SQL — verified by reading `STATS_SQL` constant + `EXPLAIN` plan; only one raw query in the codebase.
  - [x] `yarn lint` → 0 errors, 1 pre-existing warning (db/sequelize.ts no-console; not from F3). `tsc -p` exits 0.
  - [x] decisions.md ADR-012 (recipients are tenant-shared) authored by architect; matches implementation.
  - [x] business-rules.md cross-references checked — every rule under "Campaign lifecycle", "Authorization", "Stats computation", "Recipients" is enforced server-side.

- **tech-debt.md additions:** 2 MEDIUM (find-then-update race; sequential upsert
  loop) + 3 LOW (`ignoreDuplicates` dead-code, JSDoc inaccuracy on empty PATCH,
  recipient-name fallback UX). All filed under "F3 Campaigns/Recipients —
  code-reviewer findings (2026-05-08)".

- **Recommendations for finalize:**
  1. Commit the 35 new tests + the new files exactly as-is (verdict
     APPROVED-WITH-NITS); no fix-up commit required ahead of the squash.
  2. README: add a one-liner under "Known limitations" pointing at the F4 race-
     window MEDIUM (so reviewers see we know about it before F4 lands it as a
     real concern).
  3. Confirm `apps/api/.env` is NOT staged — `.gitignore` already excludes
     `.env`/`.env.*`; verified during this review (only `.env.example` is
     tracked).

- **Recommendations for F4 (carry-forward):**
  1. **Atomic state transitions:** when `POST /campaigns/:id/schedule` and
     `POST /campaigns/:id/send` land, implement them as `Campaign.update(...,
     { where: { id, createdBy, status: <expected> } })` and check
     `affectedRows === 1` to raise 409 atomically. Closes the find-then-update
     race flagged MEDIUM here.
  2. **Bulk recipient upsert:** if F4 adds an "attach recipients to campaign"
     endpoint (or a bulk import), retire the sequential `findOrCreate` loop
     in `createCampaign` simultaneously — single bulk upsert + bulk find-by-
     emails. Cuts a 1000-email create from up to 1000 round-trips to ~3.
  3. **Worker tenancy:** the F4 background sender will scan the partial index
     `idx_campaigns_status_scheduled_at WHERE status='scheduled'` — make sure
     it does NOT filter by `created_by` (it acts as the system, not as a user)
     but DOES NOT leak per-tenant campaign content into other tenants'
     channels. Document the cross-tenant boundary at the worker entry point.

