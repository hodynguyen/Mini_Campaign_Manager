# Mini Campaign Manager

A simplified MarTech tool for marketers to create, manage, and track email campaigns.
Take-home assignment — see [`ASSIGNMENT.md`](./ASSIGNMENT.md) for the brief.

> **Status:** F1–F5 complete. Backend + frontend feature-complete. F6 = seed script + final README polish + tests round-up.

---

## Stack

| Layer       | Choice                                                              |
|-------------|---------------------------------------------------------------------|
| Backend     | Node.js 20 · Express 4 · TypeScript 5.4 · Sequelize 6 · PostgreSQL 16 |
| Validation  | zod                                                                 |
| Auth        | JWT (HS256)                                                         |
| Frontend    | React 18 · TypeScript · Vite 5 · Ant Design 5                       |
| Data        | @tanstack/react-query · zustand · axios                             |
| Tests       | jest + supertest (api) · vitest + RTL (web)                         |
| Monorepo    | yarn 1 workspaces                                                   |
| Local infra | docker-compose (Postgres only)                                      |
| CI          | GitHub Actions — install + lint + test (DB-backed, Postgres service) |

---

## Quick start

### Prerequisites

- Node.js **20.x** (a `.nvmrc` is provided — run `nvm use`)
- Yarn **1.22+** (classic — not Berry)
- Docker + Docker Compose

### One-time setup

```bash
nvm use                    # picks up Node 20
yarn install               # installs all workspaces
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env   # optional — has a sane default
docker compose up -d       # starts Postgres on :5432
```

### Run dev

```bash
# in two terminals (or use yarn workspaces run dev to fan out)
yarn workspace @app/api dev      # http://localhost:4000
yarn workspace @app/web dev      # http://localhost:5173
```

Sanity check:
```bash
curl http://localhost:4000/health    # → {"ok":true}
open http://localhost:5173            # → "Mini Campaign Manager" placeholder
```

### Tests & lint

```bash
yarn test       # runs both api (jest) and web (vitest) suites
yarn lint       # eslint across all workspaces
yarn workspace @app/api test
yarn workspace @app/web test
```

The api test suite is **DB-backed** — tests run real SQL against a Postgres
test database (`campaign_test`), separate from the dev DB so truncates can
never wipe local data. Two ways to provision it:

**Option A — docker compose Postgres (recommended):**
```bash
docker compose up -d postgres
docker compose exec postgres \
  psql -U campaign -d campaign -c 'CREATE DATABASE campaign_test;'
cp apps/api/.env.example apps/api/.env.test   # gitignored — tweak if needed
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
test truncates `users` for isolation. Tests run with `--runInBand` to share a
single connection pool.

#### Troubleshooting

- **`role "campaign" does not exist`** — the Postgres instance you're pointing
  at doesn't have the `campaign` user. With docker compose this is created
  automatically; on a host Postgres run
  `psql -d postgres -c "CREATE ROLE campaign WITH LOGIN PASSWORD 'campaign' SUPERUSER;"`.
- **`database "campaign_test" does not exist`** — you skipped the
  `CREATE DATABASE campaign_test` step above. The compose service only
  auto-creates the dev DB (`campaign`); the test DB is your responsibility.
- **`apps/api/src/config/env.ts` exits at boot with "DATABASE_URL_TEST is
  required when NODE_ENV=test"** — your `apps/api/.env.test` is missing or
  empty. Copy from `.env.example` and ensure `DATABASE_URL_TEST` points at
  `campaign_test`.

CI runs the same flow against an ephemeral Postgres service container — see
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

### Stop

```bash
docker compose down        # stop Postgres
docker compose down -v     # also drop the pgdata volume
```

---

## Repository layout

```
mini-campaign-manager/
├── apps/
│   ├── api/                  # Express backend (Node)
│   │   ├── src/
│   │   │   ├── app.ts        # createApp() factory — testable, no listen
│   │   │   ├── index.ts      # boot + listen
│   │   │   ├── config/env.ts # zod-parsed env (fail-fast on bad config)
│   │   │   └── routes/health.ts
│   │   └── tests/health.test.ts
│   └── web/                  # React + Vite frontend
│       ├── src/
│       │   ├── main.tsx      # Provider stack: AntD → ReactQuery → Router
│       │   ├── App.tsx
│       │   ├── lib/{api,queryClient}.ts
│       │   └── store/auth.ts # zustand skeleton
│       └── vite.config.ts    # also wires Vitest
├── packages/
│   └── shared/               # @app/shared — shared TS types/DTOs (used in F2+)
├── docker-compose.yml        # Postgres 16
├── .github/workflows/ci.yml
├── tsconfig.base.json        # shared TS config (strict, ES2022, bundler resolution)
├── .eslintrc.cjs             # shared ESLint config (TS + Prettier)
├── package.json              # workspaces root
└── ASSIGNMENT.md
```

The `.hody/` directory contains workflow knowledge base files (specs, ADRs, agent
work logs) that drove the AI-assisted build — see the section below.

---

## Roadmap (feature passes)

| Pass | Scope                                                 | Status |
|------|-------------------------------------------------------|--------|
| F1   | Monorepo scaffold + dev env                           | ✅ done |
| F2   | Auth (User model, register/login, JWT middleware)     | ✅ done |
| F3   | Campaigns + Recipients CRUD + state machine           | ✅ done |
| F4   | Schedule + Send (async simulation) + open-track       | ✅ done |
| F5   | Frontend pages + UX polish (loading/error states)     | ✅ done |
| F6   | Seed script + final README pass + tests round-up      | next   |

Acceptance criteria for each pass live in `.hody/knowledge/spec-*.md`.

---

## How I Used Claude Code

> This section is a non-negotiable part of the assignment grading. The full
> retrospective is filled out at the end of the project (after F5). What's
> below is the **F1 + F2 account**; F3 → F5 will append.

### What I delegated to Claude Code (F1)

I drove the scaffold via the `hody-workflow` plugin — a multi-agent system I
built that delegates discrete parts of feature development to specialized
sub-agents (architect, backend, frontend, devops, unit-tester, code-reviewer).

For F1 specifically:

- **architect** — picked exact pinned versions (TS 5.4.5, ESLint 8.57 vs 9, etc.), wrote `tsconfig.base.json` / root `.eslintrc.cjs` / `.prettierrc`, drafted detailed hand-off notes for downstream agents.
- **backend** + **frontend** (parallel) — scaffolded `apps/api` and `apps/web` independently with one smoke test each. The backend chose CommonJS for the API workspace specifically to avoid `jest + ESM + ts-jest` fragility, and explained that trade-off.
- **devops** — authored `docker-compose.yml` (Postgres 16), `.github/workflows/ci.yml`, extended `.gitignore`. Verified Postgres credentials in compose match `apps/api/.env.example`.
- **unit-tester** — ran `yarn install` (the only install in the workflow), `yarn lint`, both test suites, both builds. Made 4 tooling fixes (no source code edits): converted `jest.config.ts` → `.js` (avoid `ts-node` dep), fixed a `tsconfig.node.json` `noEmit` + `composite` conflict (TS6310), added `nohoist` for `@testing-library/jest-dom` to fix a yarn-1 hoisting issue, and pinned `@testing-library/dom@10` as an explicit peer.
- **code-reviewer** — final sweep: 0 BLOCKER, 1 HIGH (README missing — fixed in this commit), 2 MEDIUM, 4 LOW. Verdict: APPROVED-WITH-NITS.

### What I delegated to Claude Code (F2)

For F2 the workflow extended to a 5-agent pipeline:
**architect → backend → integration-tester → code-reviewer → devops**.

- **architect** — locked the auth implementation skeletons before any code: Sequelize singleton, **umzug-direct migration runner** (rejected `sequelize-cli` because TS+CJS interop is fragile — see `ADR-008`), `AppError` hierarchy + Express error dispatch table, env extensions (`JWT_SECRET`, `JWT_EXPIRES_IN`, `CORS_ORIGINS`, `DATABASE_URL_TEST`), and the **types-in-shared / schemas-in-api** split (`ADR-009`) — keeps zod out of the web bundle.
- **backend** — wrote the User model, `/auth/register`, `/auth/login`, `requireAuth` middleware, the migration, and authored ADR-010 (bcrypt cost 10) + ADR-011 (HS256/24h JWT). Implemented a **constant-time-ish login** (`SENTINEL_HASH` decoy run when no user is found) so `INVALID_CREDENTIALS` doesn't leak which of email/password was wrong via timing.
- **integration-tester** — wrote 24 tests against a real Postgres test DB (no mocks). Set up jest `globalSetup` to run migrations once, per-worker dotenv from a gitignored `.env.test`, and `--runInBand` to avoid truncate races. **Found zero source-code bugs** — every test passed against the backend's implementation as authored.
- **code-reviewer** — security-focused review against an OWASP-flavored checklist. Found **two BLOCKERs** I fixed inline: `jwt.verify` was missing `algorithms: ['HS256']` (defense-in-depth against algorithm-confusion attacks), and `express.json()` had no body-size limit (DOS surface). Logged 3 MEDIUM tech-debt items in `tech-debt.md` for F3+ (login rate-limit, `JWT_EXPIRES_IN` regex validation, Zod-issue echoing).
- **devops** — extended CI with a Postgres 16 service container, a step that creates `campaign_test`, and a heredoc that materializes `apps/api/.env.test` inside the runner (the file is gitignored so we can't commit it). Re-ran the test suite locally post-edit: still 24/24 in ~1.9s.

### Real prompts I used

**F1 (architect)** — "Your job is to lock the root-level architecture artifacts so the BUILD agents can work in parallel without colliding. Write `tsconfig.base.json` + `.eslintrc.cjs` + `.prettierrc` + `.editorconfig` + `.nvmrc` + root `package.json` + `packages/shared` scaffold. **DO NOT scaffold `apps/api/` or `apps/web/`** — those are the next agents' jobs. Pin exact versions, no `latest`. ESLint 9 has flat-config breaking changes — pick 8.x to avoid burning time."

**F1 (unit-tester)** — "Run `yarn install` (the only install in this workflow). Then `yarn lint` → fix iff genuine. Then both workspace tests. Then both builds. **Do NOT install new packages opportunistically.** **Do NOT modify root locked configs** (flag loudly if you must). **Do NOT skip a failing test by editing it to pass trivially — fix the root cause.**"

**F2 (integration-tester)** — "Write integration tests against a **real Postgres test database**, run them, get them green. ≥5 meaningful tests. Spec lists 7 — aim for all 7. ... DO NOT mock the database or the Sequelize layer. Tests use real Postgres. ... DO NOT modify `apps/api/src/auth/*` or other source code unless to fix a genuine bug found during testing — if you do, document it as a finding."

**F2 (code-reviewer, security pass)** — "This is a SECURITY-focused review — auth code is the highest-risk surface in the project. ... For each finding: **BLOCKER** must fix before shipping F2; **HIGH** fix before merging post-review; **MEDIUM** record in `tech-debt.md`. ... Do NOT add new tests beyond what's already there (integration-tester's job)."

The pattern that's been most reliable across both passes: **scope what the agent OWNS plus what it MUST NOT touch**, then describe the deliverable as concrete acceptance checks (tests pass, lint clean, specific severity-bucketed findings get logged). Agents drift toward "thoroughness" if you don't bound them; they drift toward shallowness if you don't ground them in checks. Negative scope ("DO NOT...") carries at least as much weight as positive scope.

### Where Claude Code was wrong / needed correction

**F1:**
- The backend agent initially wrote `jest.config.ts`. That's idiomatic but jest needs `ts-node` to load a TS config file — adding a dep just to read a config file would be silly. The unit-tester agent caught it during execution and converted to `.js`.
- The frontend agent set `noEmit: true` on `tsconfig.node.json` while also declaring `composite: true`. TypeScript rejects this combination (TS6310). Caught during `yarn workspace @app/web build`. Fix: switch to `emitDeclarationOnly: true` + `outDir`.
- A third issue surfaced from yarn 1's hoisting model: `@testing-library/jest-dom` was hoisted to root `node_modules` while `vitest` (its peer) stayed in the workspace, and `jest-dom/vitest`'s ESM entry couldn't resolve `vitest`. Cure: `"workspaces": { "packages": [...], "nohoist": ["**/@testing-library/jest-dom"] }`. This is the kind of thing only debuggable by actually running the install — emphasizing the value of a separate execute-and-verify step.

**F2:**
- **Inter-agent contract drift**: architect's `migrate.ts` had a stale type annotation (`Umzug<typeof sequelize>` where the runtime context is `QueryInterface`). The build broke; backend caught and fixed it. This is exactly why I keep a feature log — the next agent reads what the previous one actually shipped, not just the spec.
- **Algorithm-confusion attack surface**: backend wrote `jwt.verify(token, env.JWT_SECRET)` without pinning `algorithms`. `jsonwebtoken@9` is already strict by default, but explicit pinning matches OWASP guidance and survives any future major-version regression. Defaults are never load-bearing in security code.
- **Body-size limit**: `express.json()` defaults to 100kb but pinning explicitly turns "implementation detail" into "API contract".
- **Spec deviation done right**: spec said use `sequelize-cli`. Architect read the spec, recognized the TS+CJS interop trap, **wrote ADR-008 explaining the deviation**, and chose `umzug` directly. The deviation was grounded in actual repo state (F1 had locked CJS for the api), not an arbitrary preference. Specs aren't decrees; they're starting hypotheses.

### What I would NOT let Claude Code do

- **Decide the schema or business rules without me ratifying first.** The spec in `.hody/knowledge/business-rules.md` was written by hand, sourced directly from `ASSIGNMENT.md`, and is the contract every agent reads. I do not delegate the part where the contract gets defined.
- **Run destructive commands without asking** — e.g. `yarn upgrade --latest`, `git reset --hard`, `rm -rf node_modules`. Agents in this workflow are scoped to file writes + scoped command execution; destructive ops require explicit user approval.
- **Skip tests to ship faster.** Verify-phase agents are instructed: "Do NOT skip a failing test by editing it to pass trivially. Fix the root cause." This is enforced by phrasing the prompt so that "skip" is the worst-graded outcome, not the easiest.
- **Mock the DB in tests.** Mocked SQL is meaningless for an assignment that grades "efficient SQL" and "business rules enforced". F2 tests hit a real Postgres — slower CI, but the JD literally calls out "code quality, testing, craftsmanship" as a hiring signal.
- **Bury security findings under "minor".** Code-reviewer was prompted with a strict severity grid (BLOCKER → HIGH → MEDIUM → LOW → PRAISE) and the rule "BLOCKER means workflow stays in_progress". This forces categorization decisions instead of soft "consider this someday" punts.
- **Pick `latest` for anything.** Pinning is a hard requirement in every agent's brief — this is what made `yarn install` reproducible on the first try (no version drift across the dep graph).
- **Auto-commit between feature passes.** Each F-pass ends with me reviewing + committing. Agents have NEVER committed code in this repo; that's a deliberate human checkpoint.

---

## License

Private — submission for take-home assignment evaluation.
