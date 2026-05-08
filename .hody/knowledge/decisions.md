---
tags: [decisions, adr]
created: 2026-05-06
author_agent: human
status: active
---

# Architecture Decision Records

## ADR-001: Initial Tech Stack (locked by assignment brief)

- **Date**: 2026-05-06
- **Status**: accepted
- **Context**: Take-home assignment for a Software Engineer role. Brief
  (`ASSIGNMENT.md`) prescribes specific technologies; deviation would fail the
  evaluation criteria.
- **Decision**:
  - **Backend:** Node.js + Express + TypeScript + Sequelize + PostgreSQL + JWT auth
  - **Validation:** zod (vs. joi — zod chosen for first-class TS inference)
  - **Frontend:** React 18 + TypeScript + Vite + React Query + Zustand
  - **Monorepo:** yarn workspaces (`apps/api`, `apps/web`)
  - **Local dev:** docker-compose (postgres at minimum)
  - **Tests:** jest + supertest (api), vitest (web)
- **Alternatives considered:**
  - NestJS (richer DI, my background) — rejected: brief says Express.
  - Prisma — rejected: brief says Sequelize.
  - Redux Toolkit — rejected: zustand is lighter for this scope and brief allows it.
- **Consequences:**
  - TypeScript everywhere → strict mode on, shared types via a workspace package.
  - Sequelize migrations are the source of truth for schema; no manual SQL drift.
  - JWT in HTTP Authorization header (not cookie) by default — simpler, no CSRF logic.
    May revisit if interviewer prefers httpOnly cookie.

## ADR-002: Async send simulation strategy

- **Date**: 2026-05-06 (proposed) → 2026-05-08 (accepted, F4 think)
- **Status**: accepted (during F4 think)
- **Context**: `POST /campaigns/:id/send` must be **asynchronous** per brief.
  Two reasonable approaches given a 4–8h budget.
- **Decision (accepted):** In-process background work via Node's
  `setImmediate`. The controller responds 202 Accepted FIRST, then schedules
  the worker on the next event-loop tick:

  ```ts
  // apps/api/src/campaigns/controller.ts (F4)
  const result = await sendCampaignSvc(userId, id);  // atomic state flip
  res.status(202).json(result);                       // commit response FIRST
  setImmediate(() => {
    runSendWorker(id).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[send-worker]', { id, err });
    });
  });
  ```

  The worker (`apps/api/src/campaigns/worker.ts`) buckets pending CR rows
  into `sentIds` / `failedIds` via `Math.random() < env.SEND_SUCCESS_RATE`,
  issues at most 2 bulk `UPDATE campaign_recipients` queries (one per
  outcome), then atomically flips `campaigns.status` `sending` → `sent` ONLY
  if still `sending`. Top-level try/catch prevents the api process from
  ever crashing on a worker failure — the campaign just stays in `sending`
  state, which is a recoverable observable condition rather than a data
  corruption.

- **Awaitable test variant — `runSendWorkerForTests(campaignId)`:**
  Same body as `runSendWorker`, but throws on error so integration tests
  can assert deterministic outcomes without the polling-with-timeout
  pattern. Tests import the function directly (NOT through the route) and
  `await` it synchronously after seeding state. Two distinct names so that
  production code can never accidentally serialize a request behind the
  worker. Tests can also override `SEND_SUCCESS_RATE` via env to make
  outcomes deterministic (1.0 = all sent, 0.0 = all failed).

- **Atomic state transitions** (closes the F3 carry-forward MEDIUM in
  tech-debt.md): both `scheduleCampaign` and `sendCampaign` use
  `UPDATE campaigns SET ... WHERE id=:id AND created_by=:userId AND status
  IN (...)`. The `affectedRows === 1` check + a follow-up SELECT
  distinguishes 404 (CAMPAIGN_NOT_FOUND, missing or foreign tenant) from
  409 (CAMPAIGN_NOT_SCHEDULABLE / CAMPAIGN_NOT_SENDABLE, exists-but-wrong-
  state). The state guard is now a SQL-level invariant, NOT a JS read-
  modify-write — concurrent transitions are impossible to race past.

- **Alternatives considered:**
  - **BullMQ + Redis**: production-grade, "nice-to-have" per JD. Adds Redis
    to docker-compose, a worker process, and a job-state DB. Rejected: the
    brief says "simulate", not "production-grade". The setImmediate pattern
    encapsulated in `worker.ts` swaps cleanly to a queue later — same
    function signature, different scheduler.
  - **Inline await + 200**: rejected. Defeats the brief's "async" requirement
    and ties response latency to the recipient count.
  - **`Promise.resolve().then(...)` instead of setImmediate**: subtler — that
    runs in the SAME tick as the response (microtask), so `res.json` flush
    races the worker's first DB query. `setImmediate` defers to the next
    macro-task tick, after I/O has drained, which is the safer default.

- **Consequences:**
  - **Simpler infra** — postgres only, no Redis.
  - **Worker is best-effort, not durable** — if the api process crashes
    mid-send, in-flight rows stay `pending` and the campaign stays in
    `sending`. Re-running the worker is safe by design (the worker filters
    `WHERE status='pending'`, so a retry only touches still-pending rows).
    Operator can re-trigger by calling the worker directly, or via a future
    cron sweep. Documented as a known limitation in README.
  - **Test sequencing is deterministic** via the awaitable test variant +
    `SEND_SUCCESS_RATE` env override.
  - **Easy to swap to BullMQ later** — keep the `runSendWorker(campaignId)`
    function signature; replace the controller's `setImmediate` with a
    `queue.add('send', { campaignId })` call.

## ADR-003: JWT storage on the client

- **Date**: 2026-05-06
- **Status**: proposed
- **Context**: Brief allows "in memory or httpOnly cookie".
- **Decision (proposed):** In-memory (zustand store, non-persistent). User
  re-logs after refresh.
- **Rationale:** No CSRF concerns, no cookie/CORS plumbing, fits the time budget.
  Trade-off — UX papercut on refresh — accept and document.

## ADR-004: Yarn 1 + selective `nohoist` for testing-library

- **Date**: 2026-05-06
- **Status**: accepted (during F1 verify)
- **Context**: First `yarn install` in F1 hoisted `@testing-library/jest-dom`
  to root `node_modules` while `vitest` stayed inside `apps/web/node_modules`.
  Loading `@testing-library/jest-dom/vitest` then failed because that ESM
  entry imports `vitest`, and Node's ESM resolver couldn't see it from the
  hoisted location.
- **Decision:** Convert `package.json#workspaces` from a flat array to the
  object form and add a `nohoist` rule: `["**/@testing-library/jest-dom"]`.
  This keeps `jest-dom` next to `vitest` inside `apps/web` so the relative
  ESM resolution works.
- **Alternatives considered:**
  - Switch the entire repo to `yarn berry` — out of scope; reviewers expect
    `yarn install` to "just work" with the version on their machine.
  - Pin `@testing-library/jest-dom` at root and accept it as a dev tool
    seam — fragile; future packages added to apps/web would hit the same
    issue.
- **Consequences:**
  - Future testing-library extensions may need similar `nohoist` entries.
  - Documented as a known trap in the README troubleshooting section
    (to add when troubleshooting comes up).

## ADR-005: TypeScript module strategy split — ESM web / CJS api

- **Date**: 2026-05-06
- **Status**: accepted (during F1 build)
- **Context**: `tsconfig.base.json` uses `module: ESNext` +
  `moduleResolution: bundler` because Vite handles ESM resolution natively.
  But on the API side, `jest + ts-jest` under ESM is famously fragile (`.js`
  import suffix juggling, `extensionsToTreatAsEsm`, ESM hooks). We can't
  iterate on it without running code, so the BUILD agents had to ship a
  config they were confident in.
- **Decision:** `apps/api/tsconfig.json` overrides `module: CommonJS` +
  `moduleResolution: node`. `apps/api/package.json` has no `"type"` field
  (defaulting to CommonJS). `apps/web` keeps base settings + `"type":
  "module"`.
- **Consequences:**
  - Two workspaces, two module systems — must be aware when sharing code via
    `packages/shared`. F2+ should ensure shared exports don't depend on ESM
    syntax that breaks under CJS (top-level await, `import.meta`, etc.).
  - `tsx watch` (the API dev runner) handles both ESM and CJS, so dev DX is
    unchanged.
  - If F3 adopts BullMQ (which ships ESM-only in newer majors), revisit:
    either bump the API to ESM (and do the jest+ESM work then) or pin BullMQ
    to a CJS-compatible major.

## ADR-006: ESLint 8 (legacy config), not 9 (flat config)

- **Date**: 2026-05-06
- **Status**: accepted (during F1 think)
- **Context**: ESLint 9 ships flat-config (`eslint.config.js`) as the
  default. Many plugin authors haven't updated yet (especially React/TS
  plugins through 2025), and migrating during a 4–8h assignment would burn
  a real chunk of that budget.
- **Decision:** Pin `eslint@8.57.1` + `@typescript-eslint@7.18.0`. Use the
  legacy `.eslintrc.cjs` configuration format.
- **Consequences:**
  - Will need to migrate eventually; not in this assignment's scope.
  - Some newer plugins drop ESLint 8 — pin those carefully too.

## ADR-007: F1 scope guards — what is intentionally NOT here

- **Date**: 2026-05-06
- **Status**: accepted
- **Decision:** F1 ships scaffold + smoke tests only. The following are
  installed-but-unused in the apps/api dep graph because F2/F3 will use them:
  - `bcrypt`, `jsonwebtoken` — used by F2 auth
  - `sequelize`, `pg`, `pg-hstore` — used by F2 models
- **Rationale:** Installing all the heavy deps once at F1 means `yarn install`
  doesn't re-run between feature passes. Trade-off: the F1 dep graph is
  bigger than the code that uses it. Acceptable.

## ADR-008: Migrations via `umzug` directly, not `sequelize-cli`

- **Date**: 2026-05-06
- **Status**: accepted (during F2 think)
- **Context**: spec-auth.md §"Locked tech decisions" called for
  `sequelize-cli` with TS migrations + a `.sequelizerc`. Actually wiring
  TS-based migrations through `sequelize-cli` under our CommonJS api workspace
  requires either the `sequelize-cli-typescript` community fork (sporadic
  upkeep) or a `babel-register` hook in `.sequelizerc`. Both are interpreters
  layered on an interpreter — exactly the kind of fragility the F1 retro
  flagged ("BUILD agents cannot run code to verify").
- **Decision:** Wrap `umzug` directly in a small `apps/api/src/db/migrate.ts`
  CLI. Migrations are `.ts` files in `apps/api/migrations/` loaded as-is via
  `tsx src/db/migrate.ts <up|down|status>`. Ship `.sequelizerc` only as a path
  hint so contributors who run `sequelize-cli migration:generate` for ad-hoc
  scaffolding still land files in the right folder.
- **Why this works**: `sequelize-cli` itself wraps `umzug` under the hood;
  we're cutting out the middle layer that needs the babel/ts interop. `tsx`
  already handles TS/CJS in the API dev runner — same loader, same paths.
  Tests can `import { runMigrations } from './db/migrate'` directly.
- **Alternatives considered:**
  - `sequelize-cli` + `sequelize-cli-typescript` — rejected: extra dep with
    erratic release cadence, surface for breakage we can't iterate on.
  - `sequelize-cli` + `babel-register` — rejected: pulls babel just for the
    migration runner; unrelated tooling for one job.
  - Raw SQL files via `node-pg-migrate` — rejected: spec is Sequelize-native;
    we already have `QueryInterface` ergonomics.
- **Consequences:**
  - Acceptance criterion "yarn migrate runs the User migration cleanly" still
    holds — only the runner is different.
  - `umzug@^3.8.2` added to `apps/api` dependencies.
  - Production build (`tsc`) emits the same migrations as `.js`; the umzug
    glob picks up both `.ts` and `.js` so `node dist/db/migrate.js up` works
    after build.

## ADR-009: Shared types in `@app/shared`, zod schemas in `apps/api`

- **Date**: 2026-05-06
- **Status**: accepted (during F2 think)
- **Context**: Two reasonable ways to share request/response shapes between
  api and web:
  - **(A)** zod schemas in `@app/shared`, `z.infer` re-exported.
  - **(B)** Pure TS interfaces in `@app/shared`, separate zod schemas inside
    `apps/api/src/schemas/`.
- **Decision:** Option B. `packages/shared/src/index.ts` exports only types
  (`User`, `RegisterRequest`, `LoginRequest`, `AuthResponse`, `ApiError`).
  Zod schemas live in `apps/api/src/schemas/auth.schema.ts`.
- **Rationale:**
  - Option A would force `@app/shared` to ship `zod` as a runtime dependency.
    Vite would then bundle zod into `apps/web` purely so the web app could
    read types — wasteful, especially because zod is not a small lib.
  - `@app/shared` is currently consumed as TS source (no build step). Going
    runtime-coupled to zod means either we build shared (more tooling) or
    accept zod in the web bundle. Neither is worth the DRY savings on a
    5-type / 2-schema surface.
  - Drift risk between hand-kept interfaces and zod schemas is bounded by the
    integration tests — `auth.register.test.ts` and `auth.login.test.ts` hit
    both surfaces through the wire.
- **Consequences:**
  - When F3/F4 grow the shared types (Campaign, Recipient, etc.), the api
    keeps its own zod schemas. If drift becomes a real maintenance cost,
    revisit and either build shared or write a tiny "zod-in-shared" approach.
  - The `.eslintrc.cjs` `import/no-extraneous-dependencies` will not catch
    accidental zod imports in `@app/shared` (root config doesn't enable that
    rule). Convention is enforced by code review.

## ADR-010: bcrypt cost factor = 10

- **Date**: 2026-05-07
- **Status**: accepted (during F2 build)
- **Context**: Need to pick a bcrypt work factor for `hashPassword` / verify on
  login. The original spec-auth.md draft floated cost 12; the locked-decisions
  table already softened that to cost 10, and BUILD authors the working ADR.
  Two competing pressures:
  - **Latency**: every additional cost step roughly doubles per-hash CPU time.
    On the dev laptop where this is built, cost 10 ≈ 60ms, cost 12 ≈ 240ms.
    Login request budget is "fast enough that the user doesn't notice" — sub-
    100ms is the sweet spot. Cost 12 puts every login on the edge of feeling
    sluggish, especially under any concurrency.
  - **Brute-force resistance**: cost 10 is OWASP's "default for typical web
    applications" recommendation. Combined with our enforced password floor
    (`min(8)` in zod), a determined GPU attacker still has to burn meaningful
    work per candidate.
- **Decision**: `BCRYPT_COST = 10` in `apps/api/src/auth/service.ts`. Used
  by `hashPassword` AND for the `SENTINEL_HASH` (constant-time login decoy)
  so both code paths consume equivalent CPU time.
- **Alternatives considered**:
  - cost 12 — rejected: doubles per-login latency without proportional
    security gain at our password-length floor. Revisit when we have prod
    metrics.
  - cost 14+ (paranoid) — rejected: noticeable user-facing delay; not worth
    it for assignment-scope traffic.
  - argon2id — rejected: not in the brief; bcrypt is the prescribed choice.
- **Consequences**:
  - Re-evaluate to 12 once production load metrics are available.
  - Cost is encoded into each stored hash, so a future increase doesn't break
    existing users — bcrypt verifies against the cost in the hash, and we can
    re-hash on next login if we want to migrate.

## ADR-011: JWT shape, signing, and expiry

- **Date**: 2026-05-07
- **Status**: accepted (during F2 build)
- **Context**: spec-auth.md committed to HS256 / 24h / `{ sub, email }`. BUILD
  authors the working ADR documenting the actual `sign` and `verify` call
  sites and the trade-offs accepted.
- **Decision**:
  - **Algorithm**: HS256 (`jsonwebtoken.sign(..., { algorithm: 'HS256' })`).
    Single-service architecture — no public-key distribution to solve, no
    asymmetric-verification third party. RS256 would only matter if we ever
    federate auth.
  - **Secret**: `env.JWT_SECRET`. The env loader enforces ≥32 chars in
    production via `superRefine`; dev/test accept any non-empty value (so
    reviewers can use `change-me-please-use-32-chars-min-12345` from
    `.env.example` and still boot).
  - **Payload**: `{ sub: <userId>, email: <userEmail>, iat, exp }`. `sub` is
    the JWT-standard subject claim — middleware reads `payload.sub` straight
    out. `email` is included so `req.user.email` is available without a DB
    lookup per request.
  - **Expiry**: `env.JWT_EXPIRES_IN`, default `'24h'`. No refresh tokens, no
    revocation list.
- **Verify path**: `apps/api/src/auth/middleware.ts` calls `jwt.verify` with
  the same secret. On `JsonWebTokenError` / `TokenExpiredError` it forwards
  to `next(err)` and the global handler maps them to 401 `INVALID_TOKEN` /
  `TOKEN_EXPIRED`. The middleware also performs a defensive `typeof` check on
  `sub` and `email` so a token with the wrong shape returns 401 instead of
  silently writing `undefined` to `req.user`.
- **Trade-offs accepted**:
  - **No mid-life invalidation**: a stolen token is valid for up to 24h.
    Mitigations available later: Redis revocation list, rotating refresh
    tokens, shorter access TTL. All explicitly out of scope for the
    assignment.
  - **Logout is client-side only**: the API has no `/auth/logout` endpoint.
    The client drops the token from memory; there is no server-side state to
    clear. Documented as a known limitation.
  - **Plaintext claims**: `email` is in the payload. JWT payloads are base64-
    encoded but NOT encrypted. We're already serving over HTTPS in any
    deployed env, so this is acceptable. Don't add anything sensitive (PII
    beyond email, role escalation context) without revisiting.

## ADR-012: Recipients are tenant-shared (no `created_by` column)

- **Date**: 2026-05-08
- **Status**: accepted (during F3 think)
- **Context**: F3 (Campaigns + Recipients CRUD) introduces the `recipients`
  table. Two tenancy models are reasonable for marketing recipient lists:
  - **(A) Per-tenant (recipients have `created_by`)** — each user manages
    their own recipient pool. List/get/delete scoped by `created_by =
    req.user.id`. Same tenancy contract as campaigns.
  - **(B) Tenant-shared (no `created_by`)** — recipients are a global lookup.
    Any authenticated user can list/create/attach any recipient. Only the
    `email` UNIQUE constraint scopes identity.
- **Decision**: Option B — recipients are tenant-shared. The `recipients`
  table has NO `created_by` column. `GET /recipients` returns all recipients;
  `POST /recipients` creates a globally-unique row keyed by lowercased email.
  Authentication is still required (`requireAuth` mounts the router).
- **Rationale**:
  - **The brief schema doesn't include `created_by` on recipients.**
    `ASSIGNMENT.md` §1 lists `Recipient` columns as `id, email, name,
    created_at` — no `created_by`. Adding one would deviate from the spec.
  - **Marketing reality**: recipient lists are usually shared business assets
    (one address book per company), not per-user. A "marketer" persona in
    the brief is plural — multiple users at the same company collaborating
    on the same recipient pool.
  - **Email uniqueness across tenants makes more sense globally**. If two
    users both try to add `alice@example.com`, we want exactly ONE recipient
    row, not two. Per-tenant tenancy would force a composite unique
    `(email, created_by)` and make cross-user dedup impossible — the
    upsert-on-create pattern in `POST /campaigns` (recipient_emails: [...])
    would silently create duplicates.
  - **Privacy is bounded**: recipients only carry `email` + `name`. There's
    no per-user message history exposed via `GET /recipients` — only the
    contact list. Per-campaign send results are scoped through
    `campaigns.created_by` (only the campaign owner sees their own
    `campaign_recipients` rows).
- **Consequences**:
  - `GET /recipients` lists ALL recipients in the system (paginated). If
    multi-tenant deployment becomes a real concern, revisit and add a
    `tenant_id` + filter (NOT `created_by` — keep recipients shared within
    a tenant boundary).
  - `DELETE /recipients/:id` is NOT exposed in F3. With tenant-shared
    recipients, "user A deletes recipient that user B is using" is a
    footgun. Out of scope; the FK `ON DELETE RESTRICT` on
    `campaign_recipients.recipient_id` would block it anyway.
  - `POST /recipients` returns 409 `RECIPIENT_EMAIL_TAKEN` on duplicate
    email — same pattern as `EMAIL_TAKEN` for users.
  - The model does NOT need a `defaultScope` to filter by user; queries are
    plain `Recipient.findAll(...)`.
- **Alternatives considered**:
  - Option A (per-tenant) — rejected for the schema/brief reason above plus
    the dedup footgun. Would also create the "one recipient per user per
    email" anti-pattern that production address books explicitly avoid.
  - Hybrid (creator visible, list public) — rejected: extra column for no
    behavior change; the schema would still need a `created_by` we can't
    add per the brief.
- **Cross-references**:
  - Implemented in: `apps/api/migrations/0003-create-recipients.ts`,
    `apps/api/src/db/models/Recipient.ts`,
    `apps/api/src/recipients/{schema,service}.ts`.
  - Related to: ADR-011 (auth — recipients still require auth, just no
    `created_by` filter).
