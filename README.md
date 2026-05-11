# Mini Campaign Manager

[![CI](https://github.com/hodynguyen/Mini_Campaign_Manager/actions/workflows/ci.yml/badge.svg)](https://github.com/hodynguyen/Mini_Campaign_Manager/actions/workflows/ci.yml)

A simplified MarTech tool for marketers to create, manage, and track email campaigns.
Take-home assignment — see [`ASSIGNMENT.md`](./ASSIGNMENT.md) for the brief.

> **Status:** F1–F6 complete. Backend + frontend feature-complete with a deterministic seed and submission audit.

---

## Submission walkthrough (TL;DR for the reviewer)

- **Public repo:** https://github.com/hodynguyen/Mini_Campaign_Manager
- **One-liner setup:** `nvm use && yarn install && docker compose up -d --wait && yarn workspace @app/api migrate && yarn workspace @app/api seed && yarn dev`
- **Demo login:** `demo@example.com` / `demo1234` (created by the seed)
- **Tests:** 78 backend (jest+supertest, real Postgres) + 8 frontend (vitest+RTL) = **86 total**
- **CI:** GitHub Actions runs install + lint + test on every push, with an ephemeral Postgres service container
- **Submission audit:** `.hody/knowledge/submission-checklist.md` maps every line of `ASSIGNMENT.md` to file:line evidence

The 4-campaign demo seed shows all 4 campaign states the UI handles:

| Campaign | Status | Recipients | Why it's there |
|---|---|---|---|
| Welcome series — email 1 | `draft` | 5 pending | Exercise PATCH/DELETE + Schedule + Send actions |
| Newsletter template | `draft` | 0 | Exercise the empty-recipients edge case |
| Spring sale launch 🌸 | `scheduled` | 8 pending | Exercise the Send-from-scheduled flow |
| Q4 product update | `sent` | 8 sent + 2 failed (5 opened) | Show non-zero `open_rate=62.5%` in the stats view |

---

## Stack

| Layer       | Choice                                                              |
|-------------|---------------------------------------------------------------------|
| Backend     | Node.js 20 · Express 4 · TypeScript 5.4 · Sequelize 6 · PostgreSQL 16 |
| Validation  | zod (server) / Ant Design `Form` (client)                            |
| Auth        | JWT (HS256, 24h, in-memory client storage)                           |
| Frontend    | React 18 · TypeScript · Vite 5 · Ant Design 5                        |
| Data        | @tanstack/react-query · zustand · axios                              |
| Tests       | jest + supertest (api, DB-backed) · vitest + RTL (web)               |
| Monorepo    | yarn 1 workspaces (`apps/api`, `apps/web`, `packages/shared`)        |
| Local infra | docker-compose (Postgres 16-alpine)                                  |
| CI          | GitHub Actions — install + lint + test (DB-backed, Postgres service) |

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                  apps/web (React + Vite)               │
│   /login   /register   /campaigns   /campaigns/:id     │
│   pages → hooks (react-query) → axios + JWT (zustand)  │
└────────────────────┬───────────────────────────────────┘
                     │ HTTP + JSON, Authorization: Bearer
                     ▼
┌────────────────────────────────────────────────────────┐
│              apps/api (Express)                        │
│   middleware: helmet · cors · json(100kb) · morgan     │
│   /auth                /campaigns       /recipients    │
│     ↳ controller         ↳ controller     ↳ controller │
│     ↳ service            ↳ service        ↳ service    │
│   errors/ (AppError + handler)                         │
│   utils/asyncHandler                                   │
│                                                        │
│   /campaigns/:id/schedule  ── atomic UPDATE WHERE …    │
│   /campaigns/:id/send      ─→ 202 + setImmediate(…)    │
│                                  └─ worker.ts          │
│                                       ↳ bulk update    │
│                                       ↳ atomic flip    │
└────────────────────┬───────────────────────────────────┘
                     │ Sequelize 6 (CJS) + umzug migrations
                     ▼
              ┌─────────────────┐
              │  PostgreSQL 16  │   citext, pgcrypto
              └─────────────────┘
```

`packages/shared` exports type-only DTOs (`User`, `Campaign`, `CampaignDetail`,
`AuthResponse`, etc.) consumed by both apps so the wire format stays
authoritative in one place.

---

## Quick start

### Prerequisites

- Node.js **20.x** (a `.nvmrc` is provided — run `nvm use`)
- Yarn **1.22+** (classic — not Berry)
- Docker + Docker Compose

### Boot the demo

```bash
nvm use                                           # picks up Node 20
yarn install                                      # all workspaces
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env            # optional — has a sane default
docker compose up -d --wait                       # Postgres 16 on :5432 (waits for healthcheck)
yarn workspace @app/api migrate                   # apply migrations 0001..0004
yarn workspace @app/api seed                      # demo user + 15 recipients + 4 campaigns
yarn dev                                          # api :4000 + web :5173 in parallel
```

Then open http://localhost:5173 and log in with `demo@example.com` / `demo1234`.

### What to click in the UI (manual smoke flow)

1. **Log in** → land on `/campaigns` showing the 4 seeded campaigns.
2. Click **Q4 product update** → see stats with non-zero `open_rate` (62.5%).
3. Click **Spring sale launch** → see the future `scheduled_at`. Click **Send** to fire the worker. Status flips `scheduled → sending → sent` (polling refreshes every 1.5s).
4. Click **+ New campaign** → fill the form with comma-separated recipient emails → submit → land on the detail page in `draft` state.
5. **Schedule** with a future date OR **Send** immediately. Watch the polling.
6. Try editing a `sent` campaign → notice the action buttons disappear (state-machine guard).

### Tests & lint

```bash
yarn test                                         # 86 total: api 78 + web 8
yarn lint                                         # 0 errors
yarn workspace @app/api build && yarn workspace @app/web build
```

The api test suite is **DB-backed** — tests run real SQL against a Postgres
test database (`campaign_test`), separate from the dev DB so truncates can
never wipe demo data. Two ways to provision it:

**Option A — docker compose Postgres (recommended):**
```bash
docker compose up -d --wait postgres
docker compose exec postgres \
  psql -U campaign -d campaign -c 'CREATE DATABASE campaign_test;'
cp apps/api/.env.example apps/api/.env.test       # gitignored
yarn workspace @app/api test
```

**Option B — host Postgres (no Docker):**
```bash
# As a Postgres superuser, with a `campaign` role already created:
createdb -O campaign campaign_test
cp apps/api/.env.example apps/api/.env.test
yarn workspace @app/api test
```

The first run creates schema via `umzug` migrations (jest `globalSetup`); each
test truncates the campaign tables for isolation. Tests run with `--runInBand`
to share a single connection pool.

#### Troubleshooting

- **`role "campaign" does not exist`** — the Postgres instance you're pointing at doesn't have the `campaign` user. With docker compose this is created automatically; on a host Postgres run `psql -d postgres -c "CREATE ROLE campaign WITH LOGIN PASSWORD 'campaign' SUPERUSER;"`.
- **`database "campaign_test" does not exist`** — you skipped the `CREATE DATABASE campaign_test` step above. The compose service only auto-creates the dev DB (`campaign`); the test DB is your responsibility.
- **`apps/api/src/config/env.ts` exits at boot with "DATABASE_URL_TEST is required when NODE_ENV=test"** — your `apps/api/.env.test` is missing or empty.

CI runs the same flow against an ephemeral Postgres service container — see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

### Stop

```bash
docker compose down        # stop Postgres
docker compose down -v     # also drop the pgdata volume (deletes seed data)
```

---

## Repository layout

```
mini-campaign-manager/
├── apps/
│   ├── api/                         # Express backend
│   │   ├── migrations/              # umzug TS migrations (0001..0004)
│   │   ├── src/
│   │   │   ├── app.ts               # createApp() factory — testable, no listen
│   │   │   ├── index.ts             # boot + listen (fail-fast on DB ping)
│   │   │   ├── config/env.ts        # zod-parsed env, fail-fast on bad config
│   │   │   ├── auth/                # service · controller · routes · middleware
│   │   │   ├── campaigns/           # service · controller · routes · stats · worker · schema
│   │   │   ├── recipients/          # service · controller · routes · schema
│   │   │   ├── db/                  # sequelize · migrate (umzug CLI) · models · associations · seed
│   │   │   ├── errors/              # AppError hierarchy · handler
│   │   │   └── utils/asyncHandler.ts
│   │   └── tests/                   # 12 suites, 78 tests, real Postgres
│   └── web/                         # React + Vite frontend
│       └── src/
│           ├── main.tsx             # Provider stack: AntD → ReactQuery → Router
│           ├── App.tsx              # routes + ProtectedRoute
│           ├── pages/               # Login · Register · CampaignsList · CampaignNew · CampaignDetail
│           ├── components/          # StatusBadge · StatsBlock · RecipientsTable · CampaignActions · ErrorAlert · ProtectedRoute
│           ├── hooks/               # useAuth · useCampaigns (mutations + queries + polling)
│           ├── lib/                 # api (axios + JWT interceptor + 401 handler) · queryClient
│           ├── store/auth.ts        # zustand: { token, user, login(), logout() }
│           └── types/api-error.ts   # error-code → user message map
├── packages/
│   └── shared/                      # @app/shared — type-only DTOs
├── docker-compose.yml               # Postgres 16-alpine
├── .github/workflows/ci.yml         # install + lint + test (DB-backed)
├── tsconfig.base.json               # shared TS config (strict, ES2022)
├── .eslintrc.cjs                    # shared root eslint
├── package.json                     # workspaces root
└── ASSIGNMENT.md                    # the brief
```

The `.hody/` directory contains the AI-workflow knowledge base: spec/log per
feature pass, ADR ledger, business-rules contract, tech-debt ledger, and the
[`submission-checklist.md`](./.hody/knowledge/submission-checklist.md) audit.

---

## Roadmap (feature passes)

| Pass | Scope                                                    | Status |
|------|----------------------------------------------------------|--------|
| F1   | Monorepo scaffold + dev env + CI                         | ✅ done |
| F2   | Auth (User model, register/login, JWT middleware)        | ✅ done |
| F3   | Campaigns + Recipients CRUD + state machine + tenancy    | ✅ done |
| F4   | Schedule + Send (async simulation) + open-track          | ✅ done |
| F5   | Frontend pages + UX polish (loading/error states)        | ✅ done |
| F6   | Seed script + final README + spec-verifier audit         | ✅ done |

**Project status: SUBMISSION READY.**

Acceptance criteria for each pass live in `.hody/knowledge/spec-*.md` and the
agent record per pass lives in `.hody/knowledge/log-*.md`.

---

## Known limitations

These are deliberate scope cuts for the assignment time budget — each is
documented as either a tech-debt entry or an ADR.

- **In-memory JWT storage (ADR-003).** Logging out on refresh is the trade-off; no CSRF surface, no cookie/CORS plumbing. A production app would use httpOnly cookies + a refresh token.
- **24h JWT, no refresh tokens, no revocation list (ADR-011).** Tokens can't be invalidated mid-life; logout is client-side only.
- **No rate-limiting on `/auth/login` or `/auth/register`** — `tech-debt.md` MEDIUM. The only thing slowing brute force is bcrypt cost 10 (~60ms/attempt). `express-rate-limit` is the canonical fix.
- **In-process send worker (ADR-002).** `setImmediate` runs in the api process; if the api crashes mid-send the campaign is stuck in `sending`. A production app would use BullMQ + Redis. The `sender.service` interface is structured so swapping is a one-file change.
- **No password reset / no email verification.** Out of scope.
- **API path naming deviation.** Brief writes `POST /recipient` (singular). Implemented as `POST /recipients` (plural) for REST consistency with `GET /recipients`. Documented in `api-contracts.md`.
- **Frontend is desktop-first.** AntD's defaults work on mobile but layouts are not optimized.
- **CORS is allowlist via env (`CORS_ORIGINS`)** but defaults to `http://localhost:5173`. Production would tighten + add HSTS via reverse proxy.

The full ledger lives in [`.hody/knowledge/tech-debt.md`](./.hody/knowledge/tech-debt.md) (4 active items, 2 RESOLVED IN F4/F6).

---

## How I Used Claude Code

> Non-negotiable assignment grading section.
>
> The build was driven by a multi-agent orchestration plugin
> ([`hody-workflow`](https://github.com/hodynguyen/hody-workflow)) that I
> wrote previously and use as my daily driver. It delegates per-phase work
> to specialized agents — **architect**, **backend**, **frontend**, **devops**,
> **integration-tester**, **unit-tester**, **code-reviewer**, **spec-verifier**
> — with explicit hand-off notes so the next agent reads what the previous
> one actually shipped, not just the spec. The full feature-by-feature audit
> trail is committed under `.hody/knowledge/`.

### Architecture of the human/AI collaboration

Six feature passes, each with a tight loop:
```
spec (human) → architect → backend [‖ frontend] [‖ devops] → integration-tester → code-reviewer → finalize (human commit)
```

What I, as the human, did at each pass:
1. Wrote the spec and the immutable contract files (`ASSIGNMENT.md`, `business-rules.md`, `api-contracts.md`).
2. Reviewed each agent's output, especially flag findings (BLOCKERs were always investigated, never auto-applied without my read).
3. Performed the commit + push myself — agents have **never** committed code in this repo.
4. Made cross-feature judgment calls (e.g. ADR-002 setImmediate vs BullMQ, ADR-008 umzug vs sequelize-cli) when an agent surfaced a decision instead of making one.

### What I delegated to Claude Code (per pass)

**F1 — Scaffold & dev env.** architect picked exact pinned versions (TS 5.4.5, ESLint 8.57 vs 9, etc.) and wrote root config files; backend + frontend ran in parallel to scaffold `apps/api` and `apps/web` with one smoke test each; devops authored compose + CI; unit-tester ran the only `yarn install` of the workflow and applied 4 tooling fixes (no source edits) that surfaced from actually running the toolchain; code-reviewer signed off APPROVED-WITH-NITS.

**F2 — Auth.** architect locked the implementation skeleton (Sequelize singleton, **umzug-direct migration runner** rejecting `sequelize-cli` per ADR-008, AppError hierarchy, env extensions, types-in-shared/schemas-in-api split per ADR-009). backend wrote the User model, `/auth/register`, `/auth/login`, `requireAuth`, and authored ADR-010 (bcrypt cost 10) + ADR-011 (HS256/24h JWT). Implemented a **constant-time-ish login** (SENTINEL_HASH decoy on user-not-found) so `INVALID_CREDENTIALS` doesn't leak via timing. integration-tester wrote 24 tests against a real Postgres test DB with **zero source bugs found**. code-reviewer's security pass found two BLOCKERs I fixed inline: `jwt.verify` was missing `algorithms: ['HS256']` (algorithm-confusion defense) and `express.json()` had no body-size limit (DOS contract). devops extended CI with a Postgres service container.

**F3 — Campaigns + Recipients CRUD + state machine.** architect locked the migration files, model relationships, the **stats raw SQL** (`COUNT(*) FILTER (WHERE …)::int`), the index plan (`(created_by, updated_at DESC)` for list, partial `(status, scheduled_at) WHERE status='scheduled'` for the F4 worker), and ADR-012 (recipients are tenant-shared). backend wrote 5 service functions in a single transaction for create-with-recipients, the typed error mapper (`CAMPAIGN_NOT_FOUND` 404, `CAMPAIGN_NOT_EDITABLE` 409, `RECIPIENT_EMAIL_TAKEN` 409). integration-tester wrote 35 tests including a 9-test tenancy suite that asserts **DB rows are unchanged** after foreign-user PATCH/DELETE attempts (positive evidence the 404-not-403 contract is real). code-reviewer logged 2 MEDIUM tech-debt items for F4 carry-forward (atomic transitions race) and 3 LOW.

**F4 — Schedule + Send + open-track.** architect designed the **atomic UPDATE pattern** that closes the F3 race (`UPDATE … WHERE status='draft' AND created_by=:userId AND id=:id` + `affectedRows === 1` check, with a follow-up SELECT to distinguish 404 vs 409 cleanly) and authored a **paired worker export** (`runSendWorker` production never-throws + `runSendWorkerForTests` awaitable for deterministic test sequencing). ADR-002 flipped from "proposed" to "accepted" with the actual implementation. backend implemented bucket-and-bulk-update worker (≤2 UPDATEs per send via Math.random gating). integration-tester wrote 19 tests including a 100-recipient distribution test (loose `>0` bounds, false-positive prob ≈ 2e-10). code-reviewer's verdict was clean APPROVED — no BLOCKERs, no HIGHs, no MEDIUMs. F3 atomic-transitions tech-debt RESOLVED.

**F5 — Frontend pages.** architect locked the component tree, **error-code → user-message map** (`messageFor(code, fallback)` is the *only* sanctioned error-display path; `error.message` is a banned shortcut), the **status color/label map**, and the polling rule (`refetchInterval: 1500` ONLY when `data?.status === 'sending'`, self-stops). frontend wrote 5 pages, 6 components, 9 hooks, the axios interceptor that injects Bearer tokens from zustand + handles 401 with logout+redirect (loop-guarded by exact-match path). unit-tester wrote 7 component tests including the **send-flow polling test** that drives the 1500ms `refetchInterval` + asserts the optimistic 'sending' flip + post-send 'sent' state. code-reviewer flagged 1 MEDIUM (notification context theming) and 3 LOW; one of the LOW items (`destroyOnClose` AntD v5 deprecation, 401 loop-guard) was small enough to fix in F6.

**F6 — Seed + audit.** backend wrote an idempotent seed (`findOrCreate` for user/recipients, scoped delete-and-recreate for campaigns) producing 4 campaigns covering all 4 states with non-zero `open_rate=62.5%` on the sent one. frontend applied the two F5 LOW fixes (`destroyOnHidden`, exact-match loop-guard extended to `/register`). spec-verifier walked every line of `ASSIGNMENT.md`, mapped each requirement to file:line evidence, and produced [`submission-checklist.md`](./.hody/knowledge/submission-checklist.md): **56 ✅, 8 ⚠️ (all README finalize-step items), 0 ❌**.

### Real prompts I used

**F1 (architect)** — *"Your job is to lock the root-level architecture artifacts so the BUILD agents can work in parallel without colliding. Write `tsconfig.base.json` + `.eslintrc.cjs` + `.prettierrc` + `.editorconfig` + `.nvmrc` + root `package.json` + `packages/shared` scaffold. **DO NOT scaffold `apps/api/` or `apps/web/`** — those are the next agents' jobs. Pin exact versions, no `latest`. ESLint 9 has flat-config breaking changes — pick 8.x to avoid burning time."*

**F2 (code-reviewer, security pass)** — *"This is a SECURITY-focused review — auth code is the highest-risk surface in the project. ... For each finding: **BLOCKER** must fix before shipping F2; **HIGH** fix before merging post-review; **MEDIUM** record in `tech-debt.md`. ... Do NOT add new tests beyond what's already there (integration-tester's job)."*

**F3 (integration-tester)** — *"Write integration tests against a real Postgres test database. ... DO NOT mock the database or the Sequelize layer. ... Tenancy is the most security-relevant suite: assert DB rows are UNCHANGED after foreign-user PATCH/DELETE attempts (positive evidence the 404-not-403 contract is real)."*

**F4 (architect)** — *"Lock the atomic UPDATE pattern that closes the F3 race. The cleanest approach is `UPDATE … WHERE status IN (...) AND created_by=:userId` plus an `affectedRows === 1` check; a follow-up SELECT distinguishes 404 vs 409 without leaking row existence. Author a paired worker export — production never-throws + test-variant awaitable — so production code can never accidentally `await` the test variant and serialize a request behind the worker."*

**F5 (architect)** — *"Hook query keys are LOCKED — `['campaigns', { page, limit, status }]` for list, `['campaign', id]` for detail. Polling is gated by BOTH `opts.polling` AND cached `data?.status === 'sending'` — a function-form `refetchInterval` that returns 1500 only when both are true, false otherwise. The send mutation must NOT mark the campaign as `sent` — only an optimistic flip to `'sending'`; polling carries it the rest of the way."*

The pattern that's been most reliable across all six passes: **scope what the
agent OWNS plus what it MUST NOT touch**, then describe the deliverable as
concrete acceptance checks (tests pass, lint clean, specific severity-
bucketed findings get logged). Agents drift toward "thoroughness" if you
don't bound them; they drift toward shallowness if you don't ground them in
checks. **Negative scope ("DO NOT...") carries at least as much weight as
positive scope.**

### Where Claude Code was wrong / needed correction

**F1.** backend wrote `jest.config.ts` (idiomatic but jest needs `ts-node` to load TS configs; one-line file rename to `.js` was the right fix, not a new dep). frontend wrote `tsconfig.node.json` with both `noEmit: true` AND `composite: true` — TypeScript rejects this combo (TS6310). Yarn 1's hoisting model fought us: `@testing-library/jest-dom` hoisted to root while `vitest` stayed in workspace, so `jest-dom/vitest`'s ESM entry couldn't resolve `vitest` — cured by `nohoist` in workspaces config (ADR-004). All caught by **actually running the install + builds + tests**, which is why I wired a separate verify phase.

**F2.** Architect's `migrate.ts` had a stale type annotation (`Umzug<typeof sequelize>` where the runtime context is `QueryInterface`) — backend caught it during BUILD. **Algorithm-confusion attack surface** — backend wrote `jwt.verify(token, env.JWT_SECRET)` without pinning `algorithms: ['HS256']`. `jsonwebtoken@9` is already strict, but defaults are never load-bearing in security code. **Body-size limit** — `express.json()` defaults to 100kb but pinning explicitly turns "implementation detail" into "API contract". **Spec deviation done right** — spec said use `sequelize-cli`. Architect read the spec, recognized the TS+CJS interop trap, **wrote ADR-008 explaining the deviation**, and chose `umzug` directly. The deviation was grounded in actual repo state, not preference.

**F3.** `updateCampaign` find-then-check-then-update was non-atomic (currently unreachable race; reachable in F4 if not fixed). code-reviewer logged it as MEDIUM tech-debt. F4 architect specifically reads tech-debt.md before designing — so the F4 atomic UPDATE pattern was a direct response to F3's tech-debt entry. The **race got resolved in the next pass** without me re-prompting.

**F4.** No agent corrections — the F4 atomic-UPDATE design was so concrete that backend filled the SQL constants verbatim and integration-tester wrote 19 tests with zero source bugs found. The most surprising thing was how much agent-vs-agent contract enforcement ("don't await the test-variant in production code") actually compresses.

**F5.** AntD v5 deprecation warning (`destroyOnClose` should be `destroyOnHidden`) caught by code-reviewer. The 401-redirect loop-guard used `startsWith('/login')` which would match `/login-foo`; tightened to exact match. Both fixed in F6 — the deferral was deliberate (not BLOCKER, not HIGH).

### What I would NOT let Claude Code do

- **Decide the schema or business rules without me ratifying first.** `business-rules.md` was written by hand from `ASSIGNMENT.md`; agents read it as the contract.
- **Run destructive commands without asking** — `yarn upgrade --latest`, `git reset --hard`, `rm -rf node_modules`. Scoped to file writes + scoped command execution.
- **Skip a failing test by editing it to pass trivially.** Verify-phase agents are prompted: "Do NOT skip a failing test — fix the root cause."
- **Mock the DB in tests.** Mocked SQL is meaningless for an assignment that grades "efficient SQL" and "business rules enforced". F2-F4 tests hit a real Postgres.
- **Bury security findings under "minor".** Code-reviewer was prompted with a strict severity grid (BLOCKER → HIGH → MEDIUM → LOW → PRAISE) and the rule "BLOCKER means workflow stays in_progress".
- **Pick `latest` for anything.** Pinning is a hard requirement in every agent's brief — this is what made `yarn install` reproducible on the first try.
- **Auto-commit between feature passes.** Each F-pass ends with me reviewing + committing. **Agents have never committed code in this repo** — that's a deliberate human checkpoint.
- **Ratchet up scope without asking.** F3 was just CRUD + state-machine; schedule/send was deferred to F4 even though backend agents understood the full domain. The artificial pass boundary keeps each spec, log, and review focused enough to reason about.

---

## License

Private — submission for take-home assignment evaluation.
