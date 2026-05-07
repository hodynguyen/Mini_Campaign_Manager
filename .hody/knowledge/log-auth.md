---
tags: [log, api-endpoint, auth]
date: 2026-05-06
author-agent: start-feature
status: completed
---

# Feature Log: F2 — Auth (User model, register/login, JWT middleware)

Type: api-endpoint
Started: 2026-05-06
Mode: auto

## Spec
-> spec-auth.md

## Agent Work

### architect — F2 auth scaffolding

- Files created:
  - `apps/api/.sequelizerc` — path hint only (umzug-direct is the runtime).
  - `apps/api/src/db/sequelize.ts` — Sequelize singleton + `pingDatabase()` helper. Picks `DATABASE_URL_TEST` automatically when `NODE_ENV=test`.
  - `apps/api/src/db/migrate.ts` — umzug-based CLI runner (`up`/`down`/`status`) and `runMigrations()`/`revertAllMigrations()` helpers for tests.
  - `apps/api/src/errors/AppError.ts` — `AppError` base + 5 subclasses (`ValidationError` 400, `UnauthorizedError` 401, `ForbiddenError` 403, `NotFoundError` 404, `ConflictError` 409).
  - `apps/api/src/errors/handler.ts` — Express error middleware: full dispatch table for ZodError / AppError / UniqueConstraintError / TokenExpiredError / JsonWebTokenError / fallback. Generic 500 leaks nothing.
- Files modified:
  - `apps/api/src/config/env.ts` — added `JWT_SECRET` (>=32 chars in production via `superRefine`), `JWT_EXPIRES_IN` (default `'24h'`), `CORS_ORIGINS` (CSV-string -> `string[]` via `.transform`, default `['http://localhost:5173']`), `DATABASE_URL_TEST` (required when `NODE_ENV=test`).
  - `apps/api/package.json` — added `umzug ^3.8.2` to dependencies; added `migrate`, `migrate:undo`, `migrate:status` scripts (all wired to `tsx src/db/migrate.ts ...`).
  - `packages/shared/src/index.ts` — replaced placeholder with type-only exports: `User`, `RegisterRequest`, `LoginRequest`, `AuthResponse`, `ApiError`.
- KB updated:
  - `.hody/knowledge/architecture.md` — appended `## F2 Auth — Locked Decisions` (file map, error class hierarchy, migration tooling choice, schemas-vs-types rationale, JWT payload shape, env additions, test DB strategy, deviations from spec).
  - `.hody/knowledge/decisions.md` — added ADR-008 (umzug-direct over sequelize-cli), ADR-009 (types-in-shared / schemas-in-api). Reserved ADR-010 (bcrypt cost) and ADR-011 (JWT shape/expiry) for BUILD to fill in.
- Key decisions:
  - **Migrations via `umzug` directly, NOT `sequelize-cli`** (ADR-008). Spec said sequelize-cli with TS migrations; sequelize-cli's TS+CommonJS interop needs `sequelize-cli-typescript` (fragile fork) or a `babel-register` hook. Calling umzug — which is what sequelize-cli wraps — directly via `tsx src/db/migrate.ts` skips the entire interop tax and lets BUILD write `.ts` migrations that load as-is. `.sequelizerc` ships only so contributors using `sequelize-cli migration:generate` ad-hoc land files in the right folder.
  - **Types in `@app/shared`, zod schemas in `apps/api`** (ADR-009 / Option B). Avoids dragging zod into the web bundle. The 5-type / 2-schema F2 surface is too small for drift to matter; integration tests catch any mismatch.
  - **Error hierarchy is `AppError` + 5 status-tagged subclasses**. Codes are SCREAMING_SNAKE strings; clients pattern-match on `error.code` only. The handler maps Zod/Sequelize/JWT errors to the same envelope so the entire API is uniform.
  - **`JWT_SECRET` strict-32 only in production**. Dev/test accept any non-empty string (so reviewers can use `change-me` from `.env.example`); production fails to boot on a weak secret.
  - **`DATABASE_URL_TEST` required when `NODE_ENV=test`**. `sequelize.ts` switches URLs automatically — tests can never truncate the dev DB.
- Hand-off notes for backend agent:
  - Files to create:
    - `apps/api/migrations/0001-create-users.ts` — `up({ context })` enables `citext` + `pgcrypto`, `CREATE TABLE users (id UUID PK default gen_random_uuid(), email CITEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ default now(), updated_at TIMESTAMPTZ default now());`. `down({ context })` drops the table (extensions left in place — they're harmless and other migrations may need them).
    - `apps/api/src/db/models/User.ts` — `User.init({...}, { sequelize, tableName: 'users', underscored: true })`. Import `sequelize` from `../sequelize`.
    - `apps/api/src/schemas/auth.schema.ts` — zod `registerSchema` (email lowercased+trimmed, name 1–80 trimmed, password 8–72) + `loginSchema`. Use `z.infer` only inside the api — DO NOT re-export to shared.
    - `apps/api/src/auth/service.ts` — `hashPassword` (bcrypt cost 10), `verifyPassword`, `createUser` (catches `UniqueConstraintError`, rethrows as `ConflictError({code:'EMAIL_TAKEN', message:'Email already in use'})`), `signToken({ sub, email })`, `findByEmailLower`. Constant-time comparison via bcrypt's `compare` (already CT).
    - `apps/api/src/auth/controller.ts` — request handlers calling service. Catch `INVALID_CREDENTIALS` as `UnauthorizedError({code:'INVALID_CREDENTIALS', message:'Invalid email or password'})` — DO NOT distinguish "no such email" from "wrong password".
    - `apps/api/src/auth/routes.ts` — `Router` with `POST /register`, `POST /login`. Mount at `/auth` in `app.ts`.
    - `apps/api/src/auth/middleware.ts` — `requireAuth(req, res, next)`. Read `Authorization: Bearer <jwt>`, `jwt.verify(token, env.JWT_SECRET)`, attach `req.user = { id: payload.sub, email: payload.email }`. Throw `UnauthorizedError({code:'UNAUTHORIZED'})` for missing header; let `JsonWebTokenError`/`TokenExpiredError` bubble (handler maps them).
    - `apps/api/src/types/express.d.ts` — module augmentation: `declare global { namespace Express { interface Request { user?: { id: string; email: string } } } }`.
  - Files to edit:
    - `apps/api/src/app.ts` — replace `cors()` with `cors({ origin: env.CORS_ORIGINS, credentials: false })`. Mount `/auth` router. Replace the inline 500 handler with `app.use(errorHandler)` from `./errors/handler`.
    - `apps/api/src/routes/health.ts` — call `pingDatabase()` from `../db/sequelize`. 200 `{ ok: true, db: 'up' }` on success, 503 `{ ok: false, db: 'down' }` on failure.
    - `apps/api/src/index.ts` — call `await pingDatabase()` before `app.listen`; `process.exit(1)` on failure (fail-fast at boot).
  - Imports each must use:
    - `import { sequelize, pingDatabase } from '../db/sequelize'` (relative path from `auth/`, `routes/`, `errors/` subtrees).
    - `import { runMigrations } from '../db/migrate'` (tests only).
    - `import { AppError, ConflictError, UnauthorizedError, ValidationError } from '../errors/AppError'`.
    - `import { errorHandler } from './errors/handler'` (from `app.ts`).
    - `import { env } from '../config/env'`.
    - `import type { User, RegisterRequest, LoginRequest, AuthResponse, ApiError } from '@app/shared'` — both api and tests pull DTO types from shared.
  - Migration command: `yarn workspace @app/api migrate` (umzug-direct via `tsx src/db/migrate.ts up`). Status: `yarn workspace @app/api migrate:status`. Undo last: `yarn workspace @app/api migrate:undo`.
  - ADRs to author after build: ADR-010 (bcrypt cost 10) and ADR-011 (JWT HS256 / 24h / `{ sub, email }` payload) — slots reserved in decisions.md.
  - Acceptance:
    - `yarn workspace @app/api migrate` runs cleanly against the docker-compose Postgres; `users` table exists.
    - `curl -X POST localhost:4000/auth/register -d '{...}'` -> 201 with `User` (no `password_hash`).
    - `curl -X POST localhost:4000/auth/login` -> 200 `{ token, user }`.
    - Hitting a fake protected route mounted in a test with no token via `requireAuth` -> 401 `{error:{code:'UNAUTHORIZED'}}`; bad token -> 401 `INVALID_TOKEN`; expired -> 401 `TOKEN_EXPIRED`.
    - `GET /health` with DB up -> 200 `{ok:true, db:'up'}`; DB down -> 503 `{ok:false, db:'down'}`.
    - `yarn lint` and `yarn workspace @app/api build` (`tsc -p tsconfig.json`) both clean.
- Hand-off notes for integration-tester:
  - Test DB strategy:
    - Set `DATABASE_URL_TEST=postgresql://campaign:campaign@localhost:5432/campaign_test` in CI + local `apps/api/.env.test`. The env loader (`env.ts`) errors out if it's missing while `NODE_ENV=test`. `sequelize.ts` automatically routes to it.
    - Global setup: `runMigrations()` once before the suite (jest `globalSetup` or per-file `beforeAll` — call site is `tests/helpers/server.ts`).
    - `afterEach`: truncate all tables (helper at `tests/helpers/db.ts`). Preserves the schema, wipes rows. Standard pattern: `await sequelize.query('TRUNCATE TABLE "users" RESTART IDENTITY CASCADE')` — extend as future migrations add tables.
  - Helper file expectations:
    - `tests/helpers/server.ts` exports `getApp()` (returns a built `createApp()` instance) and `bootTestDb()` (runs migrations, returns the `sequelize` singleton). Tests use supertest against `getApp()`.
    - `tests/helpers/db.ts` exports `truncateAll()` and is called in each test file's `afterEach`.
  - At least 5 tests required by spec — 7 listed: register-happy / register-dup-email / register-invalid / login-happy / login-wrong-password / middleware-missing-token / middleware-bad-token.
  - Use a tiny test-only Express app with `app.get('/protected', requireAuth, (_req, res) => res.json({ok:true}))` to exercise `requireAuth` without depending on F3 routes.
- Open questions / risks:
  - `umzug@^3.8.2` requires `sequelize@^6` peer; we already have `^6.37.5`. No conflict expected. Heads-up if BUILD encounters peer-dep warnings on `yarn install`.
  - `exactOptionalPropertyTypes: true` in the base tsconfig (carried from F1) means `details?: unknown` on `AppErrorPayload` won't accept `details: undefined` literally — must omit the key. The handler already does this correctly with the spread guard `...(err.details !== undefined ? { details: err.details } : {})`. Worth noting if BUILD writes new error throw sites.
  - `errors/handler.ts` imports from `sequelize` and `jsonwebtoken` — both are runtime deps in `apps/api/package.json`, fine. ZodError import is from `zod` (also already a dep).
  - I did NOT run `yarn install`. BUILD or integration-tester needs to run it to pick up `umzug`. CI's `yarn install --frozen-lockfile` will fail until `yarn.lock` is regenerated.

### backend — F2 auth implementation

- Files created:
  - `apps/api/migrations/0001-create-users.ts` — umzug TS migration. Enables `citext` + `pgcrypto` extensions, creates `users` table per spec (id UUID PK default gen_random_uuid(), email CITEXT UNIQUE, name, password_hash, created_at, updated_at). `down` drops the table only (extensions kept for future migrations).
  - `apps/api/src/db/models/User.ts` — Sequelize Model class using `InferAttributes`/`InferCreationAttributes`. `tableName: 'users'`, `underscored: true`. `passwordHash` -> column `password_hash`. `defaultScope` excludes `passwordHash` from queries; `withPassword` scope opts back in (used only by login).
  - `apps/api/src/schemas/auth.schema.ts` — zod `registerSchema` (email trimmed+lowercased, name 1-80, password 8-72) and `loginSchema`. `RegisterInput` / `LoginInput` exported via `z.infer` (api-internal only, not in `@app/shared` per ADR-009).
  - `apps/api/src/auth/service.ts` — `hashPassword` (bcrypt cost 10 / ADR-010), `verifyPassword`, `createUser` (catches `UniqueConstraintError`, rethrows as `ConflictError({code:'EMAIL_TAKEN'})`), `findByEmailLower` (uses `withPassword` scope), `signToken({id,email})` (HS256 / `env.JWT_EXPIRES_IN`). Module-level `SENTINEL_HASH` pre-computed for constant-time login fallback.
  - `apps/api/src/auth/controller.ts` — `register` and `login` async handlers. `toUserDTO(user)` strips password_hash and serializes `created_at` as ISO 8601. Login does NOT branch on user-found vs wrong-password — same error, same code path, equivalent CPU work via SENTINEL_HASH decoy.
  - `apps/api/src/auth/routes.ts` — Router with POST /register, POST /login. Tiny in-file `asyncHandler(fn)` wraps controllers so rejected promises forward to `next(err)` (vs pulling `express-async-errors` for one monkey-patch).
  - `apps/api/src/auth/middleware.ts` — `requireAuth(req, _res, next)`. Reads `Authorization: Bearer <jwt>`, throws `UnauthorizedError({code:'UNAUTHORIZED'})` for missing/malformed header, `jwt.verify` else, defensive `typeof sub === 'string' && typeof email === 'string'` check, attaches `req.user`. JWT errors bubble to global handler (mapped to `INVALID_TOKEN`/`TOKEN_EXPIRED`). Authored only — NOT mounted in F2.
  - `apps/api/src/types/express.d.ts` — `declare global { namespace Express { interface Request { user?: { id: string; email: string } } } }`. `export {}` makes it a module so `declare global` works under TS strict module resolution.
- Files modified:
  - `apps/api/src/app.ts` — replaced `cors()` with `cors({ origin: env.CORS_ORIGINS, credentials: false })`. Mounted `/auth` router. Replaced inline 500 handler with `errorHandler` from `./errors/handler`.
  - `apps/api/src/index.ts` — wrapped boot in async IIFE: `await pingDatabase()` first, `process.exit(1)` on failure, then `createApp().listen(...)`. Added side-effect import of `./db/models/User` so the model registers on the sequelize singleton at boot.
  - `apps/api/src/routes/health.ts` — calls `pingDatabase()`, returns 200 `{ok:true,db:'up'}` or 503 `{ok:false,db:'down'}`.
  - `apps/api/.env.example` — added `DATABASE_URL_TEST`, `JWT_EXPIRES_IN`, `CORS_ORIGINS`. Bumped `JWT_SECRET` placeholder to `change-me-please-use-32-chars-min-12345` (matches >=32 char production policy in env loader).
  - `apps/api/src/db/migrate.ts` — fixed pre-existing TS type error: `buildUmzug` was annotated `Umzug<typeof sequelize>` (i.e. `Umzug<Sequelize>`) but the runtime context is `sequelize.getQueryInterface()` (`QueryInterface`). Changed to `Umzug<QueryInterface>` and added `import type { QueryInterface } from 'sequelize'`. No behavior change; without the fix `tsc -p tsconfig.json` failed.
- KB updated:
  - `.hody/knowledge/decisions.md` — wrote ADR-010 (bcrypt cost = 10, with latency vs brute-force trade-off and revisit-on-prod-metrics note) and ADR-011 (HS256 / 24h / `{ sub, email, iat, exp }` payload, no refresh tokens, plaintext claims caveat).
- Key decisions:
  - **`asyncHandler` helper instead of `express-async-errors`**. 5-line in-file utility avoids a monkey-patching dep for one feature. Re-usable for F3.
  - **`defaultScope` excludes `passwordHash`** rather than `toJSON()` override. Short-circuits at SQL level — `password_hash` never selected for normal queries, can't accidentally leak via logs/debug printers. Login explicitly opts in via `User.scope('withPassword')`.
  - **Constant-time login defense**: pre-compute `SENTINEL_HASH = bcrypt.hashSync('__sentinel__', 10)` at module load. When `findByEmailLower` returns null, login still calls `verifyPassword(submittedPassword, SENTINEL_HASH)`. Single error path (`INVALID_CREDENTIALS`) regardless of which case failed. Documented as defense against trivial timing oracles, NOT a strong CT guarantee — a determined attacker with samples could still distinguish.
  - **Defensive `typeof` check in middleware**: even after `jwt.verify`, we check `typeof payload.sub === 'string' && typeof payload.email === 'string'` and return `INVALID_TOKEN` if either fails. Prevents `req.user` from being silently populated with `undefined` if a future token shape change goes wrong.
  - **`expiresIn` cast**: `@types/jsonwebtoken` types `expiresIn` as `StringValue | number` (a `vercel/ms` template literal type), not `string`. Under `exactOptionalPropertyTypes` we cast `env.JWT_EXPIRES_IN` through `unknown` to `number` — runtime accepts any ms-parseable string and the env loader validates `min(1)`.
- Notes for integration-tester:
  - **Test DB**: set `DATABASE_URL_TEST=postgresql://campaign:campaign@localhost:5432/campaign_test` in `.env.test` (and CI). Env loader exits if missing while `NODE_ENV=test`; `sequelize.ts` automatically routes there.
  - **Migrations**: call `runMigrations()` once in jest `globalSetup` (or `beforeAll` in `tests/helpers/server.ts`).
  - **Truncate**: `await sequelize.query('TRUNCATE TABLE "users" RESTART IDENTITY CASCADE')` in `afterEach`. Wrap in `tests/helpers/db.ts -> truncateAll()`.
  - **Required tests** (≥5; spec lists 7):
    1. register-happy — POST /auth/register valid -> 201 { id, email, name, created_at } with NO `password_hash` and NO `password` field.
    2. register-dup-email — second register with same email -> 409 `{error:{code:'EMAIL_TAKEN'}}`.
    3. register-invalid-input — bad password (e.g. `'short'`) or missing field -> 400 `{error:{code:'VALIDATION_ERROR', details:[...]}}`.
    4. login-happy — register then login -> 200 `{token, user:{...}}`. `jwt.verify(token, env.JWT_SECRET)` returns `{ sub: user.id, email: user.email, iat, exp }`.
    5. login-wrong-password — 401 `{error:{code:'INVALID_CREDENTIALS'}}`.
    6. login-no-such-user — 401 `INVALID_CREDENTIALS` (same code as wrong-password — verifies enumeration defense).
    7. middleware-no-token — `GET /protected` (test-only route mounting `requireAuth`) without header -> 401 `UNAUTHORIZED`.
    8. middleware-bad-token — invalid signature -> 401 `INVALID_TOKEN`. Optionally test expired token via signing with `expiresIn: '-1s'` -> 401 `TOKEN_EXPIRED`.
  - **Test-only protected route**: in `tests/auth.middleware.test.ts`, build a fresh express app: `const app = express(); app.use(express.json()); app.get('/protected', requireAuth, (_req, res) => res.json({ ok: true })); app.use(errorHandler);` — exercises middleware without depending on F3 routes.
  - **`yarn install` was run by BUILD** — `yarn.lock` is updated. Integration-tester does NOT need to re-run install unless they hit a peer-dep issue.
- Open questions / risks:
  - `apps/api/src/db/migrate.ts` ESLint warning still present at line 44 (`no-console`) — intentional, it's the umzug logger. Not blocking.
  - `console.error` calls in `index.ts` and `service.ts` (none in service, but the import side-effect on User) need monitoring once F3 mounts more models; the boot sequence is fine for F2.
  - The `as unknown as number` cast in `signToken` for `expiresIn` is ugly but unavoidable without bringing in `vercel/ms`'s `StringValue` template type. Documented in code.

### integration-tester — F2 auth tests

- Files created:
  - `apps/api/tests/helpers/setup-env.ts` — `setupFiles` hook; loads `.env.test` via dotenv before any test-file import evaluates (critical because `src/config/env.ts` exits the process on missing env at import-time).
  - `apps/api/tests/helpers/setup-global.ts` — jest `globalSetup`; loads dotenv, runs umzug migrations once against the test DB, truncates `users` (defensive — clears any leftover rows from a prior aborted run), closes the temporary pool. Imports `migrate`/`sequelize` via `require()` so dotenv ordering is synchronous.
  - `apps/api/tests/helpers/teardown-global.ts` — jest `globalTeardown`; closes the sequelize pool the teardown process opens.
  - `apps/api/tests/helpers/server.ts` — exports `buildTestApp()`, `truncate()`, `closeDb()`, and re-exports the `sequelize` singleton. Side-effect imports `src/db/models/User` so direct `User.findByPk(...)` works in tests.
  - `apps/api/.env.test` — dev-mode env vars used by jest (matches `.env.example` shape; gitignored via the new `.env.test` pattern in `.gitignore`).
  - `apps/api/tests/auth.register.test.ts` — register integration tests.
  - `apps/api/tests/auth.login.test.ts` — login integration tests.
  - `apps/api/tests/auth.middleware.test.ts` — `requireAuth` integration tests via a tiny test-only Express app mounting `GET /protected`.
- Files modified:
  - `apps/api/jest.config.js` — wired `setupFiles`, `globalSetup`, `globalTeardown`; added `testPathIgnorePatterns` for `tests/helpers/` so the helpers aren't picked up as test files.
  - `apps/api/package.json` — `test` script now runs `jest --runInBand` so tests share a connection-pool and truncates don't race across workers.
  - `apps/api/tests/health.test.ts` — updated to expect the F2 health-route response shape (`{ ok: true, db: 'up' }`) and to reuse `buildTestApp`/`closeDb` helpers. The pre-existing F1 test asserted `{ ok: true }` only and would have failed under F2's extended health route.
  - `.gitignore` — added `.env.test` to the env block so `apps/api/.env.test` doesn't leak into commits.
- Tests written (24 total, comfortably above the spec's ≥5 floor):
  - `tests/auth.register.test.ts`: 10 tests
    - 2 happy-path (correct DTO shape; DB row with bcrypt cost-10 hash; email lowercased+trimmed at DB)
    - 1 duplicate email (case-mismatched second registration → 409 EMAIL_TAKEN; only one row persists)
    - 7 validation cases via `it.each`: short pwd, long pwd (>72), missing name, name empty after trim, malformed email, missing email, missing password — each → 400 VALIDATION_ERROR with `details` and zero rows inserted.
  - `tests/auth.login.test.ts`: 5 tests
    - happy path (200 + decoded JWT has `{sub, email, iat, exp}` and verifies against `env.JWT_SECRET`; `password_hash`/`passwordHash` not present on wire)
    - case-mismatched login email succeeds (CITEXT)
    - wrong password → 401 INVALID_CREDENTIALS
    - unknown email → 401 INVALID_CREDENTIALS (same code as wrong-pwd; enumeration defense per business-rules.md)
    - malformed login payload → 400 VALIDATION_ERROR
  - `tests/auth.middleware.test.ts`: 8 tests
    - missing Authorization header → 401 UNAUTHORIZED
    - malformed scheme ("Token <jwt>") → 401 UNAUTHORIZED
    - "Bearer " with no token → 401 UNAUTHORIZED
    - signature mismatch → 401 INVALID_TOKEN
    - completely malformed JWT string → 401 INVALID_TOKEN
    - expired token (signed with `expiresIn:'-1s'`) → 401 TOKEN_EXPIRED
    - wrong-typed claim (`sub: 123`) → 401 INVALID_TOKEN (defensive `typeof` check)
    - valid bearer token → 200 with `req.user = { id, email }` populated
  - `tests/health.test.ts`: 1 (kept; updated to F2 contract).
- DB setup commands run:
  - `docker compose ps` / `docker info` — both hung locally (orbstack daemon unresponsive). Docker is installed but not serving the daemon socket, so the `mcm-postgres` container from `docker-compose.yml` is NOT running.
  - Found a separate Postgres listening on `localhost:5432` (homebrew install with the `hody` superuser). Bootstrapped the test environment against THAT instance:
    - `CREATE ROLE campaign WITH LOGIN PASSWORD 'campaign' SUPERUSER` — created.
    - `CREATE DATABASE campaign OWNER campaign` — created.
    - `CREATE DATABASE campaign_test OWNER campaign` — created.
  - Verified `pg_available_extensions` includes both `citext` and `pgcrypto` (migration prerequisites).
  - `yarn workspace @app/api test` — ran umzug migration once via `globalSetup`, then 24 tests, all green in ~2s.
- Final result: **PASS** — `Test Suites: 4 passed, 4 total. Tests: 24 passed, 24 total.` Build (`tsc -p tsconfig.json`) clean. `yarn lint` clean (only the pre-existing architect `no-console` warning in `src/db/sequelize.ts` remains).
- Coverage notes:
  - All 7 spec target scenarios (register-happy, register-dup-email, register-invalid-input, login-happy, login-wrong-pwd, login-no-such-email, middleware-no-token + middleware-bad-token) covered, plus a few extras (case-insensitivity at register/login, wrong-claim-type, expired token, malformed scheme).
  - `requireAuth` is exercised via a test-only Express app (`buildProtectedApp()`) per the BUILD hand-off — no F2 production route uses it, so this is the only way to reach the middleware.
  - Constant-time-ish login defense is exercised by the "unknown email" test (returns the SAME error code as wrong-password). This verifies the response-level enumeration property; we do NOT measure timing variance — that would be flaky on shared CI runners. The CPU-equivalence claim from `controller.ts` (decoy `verifyPassword` against `SENTINEL_HASH`) is documented but not asserted.
  - Stats / campaign business rules (sections in business-rules.md) are explicitly out of scope for F2 and not tested here.
- Bugs found in source code: NONE. Zero source-code edits were made; all tests pass against the existing F2 implementation as authored by backend.
- Notes for code-reviewer:
  - **Test DB lifecycle**: dotenv loads in two places (per-worker `setupFiles` AND in `globalSetup`/`globalTeardown` because those run in their own processes). `runMigrations()` is called once in `globalSetup`; tests truncate `users` in `beforeEach` for isolation. `--runInBand` is intentional — tests share a single sequelize pool against the same test DB; parallel workers would race the truncate.
  - **`process.env['NODE_ENV'] = 'test'` in setup files** is belt-and-braces; jest already sets it, but stray runners (e.g. someone invoking `setup-env.ts` directly) wouldn't.
  - **Constant-time login** is exercised at the contract level (same response code) but not at the timing level. If you want a stronger CT assertion, that's a separate jest+`process.hrtime` harness with statistical bounds — a tech-debt item, not blocking.
  - **The middleware test's "wrong-typed claim" case** uses `jwt.sign({ sub: 123, ... })` — jsonwebtoken accepts a number for `sub` because the spec allows it, but our middleware's defensive `typeof` rejects it. Worth a callout: this is BUILD's intentional hardening (see middleware.ts line 47), not a bug.
  - **Health test** was edited (not added) — F1 left a `{ ok: true }` assertion that F2 broke. The fix here is in scope per spec §8.
- Open risks:
  - **Docker daemon was not functional on the machine running these tests** (orbstack unresponsive). The tests depend on a Postgres at `localhost:5432` with a `campaign` role and a `campaign_test` DB. Devops needs to ensure CI provisions both via either (a) a `services.postgres` block in `.github/workflows/ci.yml` (per spec §10) or (b) a `docker compose up -d postgres` step. Either way, before running `yarn workspace @app/api test`, CI must `CREATE DATABASE campaign_test` (the test DB is separate from the dev DB; the official compose service only creates `campaign`).
  - The dev DB (`campaign`) was also created locally as a side-effect of bootstrapping; it has no migration applied. That's fine — `yarn workspace @app/api migrate` against `DATABASE_URL` is the user's job before running the dev server, not the test suite's.
  - `umzug`'s default logger emits `{ event: 'migrating' }` JSON to stdout during `globalSetup`. Tests still pass; if the noise bothers reviewers, set `logger: undefined` in `migrate.ts` (architect-owned file, not modified here).

### code-reviewer — F2 security review

- Verdict: APPROVED-WITH-NITS
- Findings:
  - [BLOCKER]
    - `apps/api/src/auth/middleware.ts:45` — `jwt.verify` did not pin `algorithms`. jsonwebtoken@9 already rejects `alg=none` and most algorithm-confusion vectors when verifying with a string secret, but explicit pinning is OWASP-mandated defense-in-depth and survives future major-version regressions. Fixed inline (see below).
    - `apps/api/src/app.ts:43` — `express.json()` had no explicit `limit`. The body-parser default is 100kb (safe), but pinning it here makes the DOS contract explicit. Fixed inline.
  - [HIGH] none.
  - [MEDIUM]
    - No rate-limit / brute-force throttle on `POST /auth/login`. Out of F2 scope per spec §"Out of Scope" but real attackers will probe — recommend `express-rate-limit` on `/auth/*` in F3+ if assignment time allows. Logged in tech-debt.md.
    - `errors/handler.ts` returns the full Zod `err.issues` array as `details`. Issues include both `path` and `message` fields and Zod has historically (pre-3.22) echoed user input in some error messages. zod@^3.23.8 is safe today; future Zod upgrades should re-verify. Trim to `{ path, message }` if a future audit flags echoed-input issues. Logged.
    - Middleware accepts only the literal `"Bearer "` scheme (case-sensitive). RFC 7235 says auth-scheme is case-insensitive; lowercase `bearer ` from a strict-RFC client would 401. Strictness is fine for our single-client scope but flag if a third-party client integrates later.
    - `JWT_EXPIRES_IN` is typed `z.string().min(1)` in env loader and cast through `unknown` to `number` at the jsonwebtoken call site. A malformed value (e.g. `"24"` without unit) becomes "24ms" — login succeeds at boot but tokens expire instantly. Add a regex like `/^(\d+)(ms|s|m|h|d|w|y)?$/` in env.ts to fail-fast. Logged.
  - [LOW]
    - `controller.ts:69` calls `verifyPassword` for the user-not-found decoy path, but `findByEmailLower` itself is async and its DB latency dominates over bcrypt time — the constant-time defense is best-effort and the existing comment acknowledges this. No change needed; just call out that timing-oracle defense is a known weak guarantee.
    - `migrate.ts:53` uses `require(filepath)` (dynamic require). Migration filenames are globbed from a fixed in-repo path — no user input — so it is not an arbitrary-require risk, but it does emit the `@typescript-eslint/no-var-requires` warning suppressed by an ESLint-disable comment. Acceptable for a one-line interop seam.
  - [PRAISE]
    - SENTINEL_HASH constant-time-ish login defense AND identical `INVALID_CREDENTIALS` code/message for both wrong-password and unknown-email — proper enumeration defense, exercised by `auth.login.test.ts` "unknown email" case.
    - `defaultScope` excluding `passwordHash` at the SQL level (not just at JSON serialize) — short-circuits the leak vector entirely. Login explicitly opts in via `User.scope('withPassword')`.
    - `registerSchema` enforces `password.max(72)` — explicitly handles bcrypt's silent 72-byte truncation foot-gun. Tested in `auth.register.test.ts`.
    - `JWT_SECRET` length policy split: ≥32 in production via `.superRefine`, ≥1 elsewhere — enforces fail-fast on weak prod secrets without making dev painful.
    - Defensive `typeof` check on `payload.sub`/`payload.email` after `jwt.verify` — prevents `req.user.id = undefined` if payload shape ever drifts. Tested by the wrong-typed-claim case.
    - `errorHandler` fallback returns generic `INTERNAL` 500 with NO `err.message`/stack — verified by reading the code path. No leak surface.
    - `helmet()` is mounted FIRST in the middleware chain in `app.ts`, ahead of CORS/morgan/json — security headers always set even if a downstream handler crashes.
    - `.env.test` is gitignored (`.gitignore` line `.env.test`) and confirmed NOT tracked by git. Only `.env.example` is checked in, with an obvious `change-me-please-use-32-chars-min-12345` placeholder.
    - Tests assert security guarantees, not just happy paths: enumeration parity (same code for unknown email vs wrong pwd), expired-token (`expiresIn:'-1s'`), signature-mismatch (different secret), malformed-JWT, wrong-typed-claim. The `--runInBand` flag prevents parallel-truncate races.
- Fixes applied during review (BLOCKERs only):
  - `apps/api/src/auth/middleware.ts:45-50` — added `{ algorithms: ['HS256'] }` to `jwt.verify`. Defense-in-depth against algorithm confusion. All 24 tests still pass post-fix.
  - `apps/api/src/app.ts:43` — set explicit `express.json({ limit: '100kb' })`. Pins the body-size DOS contract. All 24 tests still pass post-fix.
- DoD checklist outcome (from spec-auth.md):
  - [x] `yarn workspace @app/api migrate` runs the User migration cleanly (verified end-to-end during integration-tester run; migration in `migrations/0001-create-users.ts` exercised via `globalSetup`).
  - [x] `yarn workspace @app/api test` passes ≥5 tests, all hitting the real DB (24/24 passing — well above the 5 floor).
  - [x] `curl POST /auth/register` → 201 with user (no `password_hash`) — asserted in `auth.register.test.ts`.
  - [x] `curl POST /auth/login` → 200 `{ token, user }` — asserted in `auth.login.test.ts` (also decodes JWT and verifies payload shape).
  - [x] No-token / bad-token / expired-token via `requireAuth` → 401 — covered in `auth.middleware.test.ts` (8 cases).
  - [x] `yarn lint` exits 0 (1 warning, pre-existing in `db/sequelize.ts`, intentional `no-console` for the DB-down log).
  - [_] CI runs DB-backed tests successfully — pending devops (SHIP). Local run green; CI gap is the only DoD item not closed.
  - [x] No secrets in committed code; `JWT_SECRET` placeholder in `.env.example` matches policy.
  - [x] `packages/shared` exports the new types; `apps/api` consumes them.
  - [x] `decisions.md` updated with ADR-008 (umzug-direct, was-bcrypt-cost slot moved), ADR-009 (types-in-shared), ADR-010 (bcrypt cost 10), ADR-011 (JWT shape/expiry).
- Recommendations for devops (SHIP):
  - CI workflow MUST `CREATE DATABASE campaign_test` (or use `services.postgres` with `POSTGRES_DB: campaign_test`) BEFORE invoking `yarn workspace @app/api test`. Tester noted this — local Postgres bootstrap was manual.
  - Set `DATABASE_URL_TEST` in CI env to point at the test DB; the env loader exits if missing while `NODE_ENV=test`.
  - Run `yarn workspace @app/api migrate` is NOT needed in CI — `globalSetup` runs migrations against the test DB itself. CI just needs the DB to exist and be reachable.
- Recommendations for finalize:
  - README "How I used Claude Code" section should explicitly mention the multi-agent flow (architect → backend → integration-tester → code-reviewer → devops) and the ADR ledger.
  - Document the F2 known limitations: 24h JWT no refresh, no login rate-limit, no password reset, no `/auth/logout` endpoint, no email verification — all per `spec-auth.md` §"Out of Scope".
  - README quick-start: list the test DB bootstrap command (`createdb campaign_test`) in case the reviewer doesn't use Docker.
- tech-debt.md additions:
  - MEDIUM: rate-limit on `/auth/*` (login brute-force).
  - MEDIUM: env-loader should regex-validate `JWT_EXPIRES_IN` against the `vercel/ms` format to fail-fast on malformed values.
  - MEDIUM: `errorHandler` returns full Zod `err.issues`; future Zod major upgrades should be re-audited for echoed-input issues, otherwise trim to `{ path, message }`.

### devops — F2 CI wiring

- Files modified:
  - `.github/workflows/ci.yml` — postgres service + test DB creation + test env
  - `README.md` — test setup (Option A docker / Option B host) & troubleshooting; CI stack-table row updated to note "DB-backed, Postgres service"
- CI workflow shape: install -> lint -> create campaign_test DB -> write apps/api/.env.test inline -> `yarn test` (runs api jest + web vitest).
- Env vars added in workflow (test step + .env.test heredoc): `NODE_ENV=test`, `DATABASE_URL=postgresql://campaign:campaign@localhost:5432/campaign`, `DATABASE_URL_TEST=postgresql://campaign:campaign@localhost:5432/campaign_test`, `JWT_SECRET=ci-test-secret-do-not-use-in-prod-aaaaaaaa` (40 chars, satisfies the >=32 production-policy boundary even though tests don't run as production), `JWT_EXPIRES_IN=1h`, `CORS_ORIGINS=http://localhost:5173`, `PORT=4001`. All plain workflow env, NOT GitHub secrets — they're scoped to an ephemeral postgres service container that the runner tears down at job-end. No production blast radius. Documented in the workflow header comment so a future maintainer doesn't second-guess and "promote" them.
- Postgres image + version: `postgres:16-alpine` (matches `docker-compose.yml`).
- Service-container healthcheck: `pg_isready -U campaign -d campaign` (interval 5s, timeout 3s, retries 10) — same as compose. The runner's job blocks on this before any step executes, so the test DB creation step can't race initdb.
- Test DB creation strategy: `psql -c 'CREATE DATABASE campaign_test OWNER campaign'` against the postgres service container's default `postgres` admin DB. Run via `docker run --rm postgres:16-alpine psql ...` to avoid apt-installing postgresql-client on the runner. Multi-DB init scripts (`POSTGRES_MULTIPLE_DATABASES`) would have been a custom entrypoint hack — the explicit psql step is shorter and self-documenting. Code-reviewer's recommendation for SHIP was implemented as written.
- `.env.test` strategy in CI: option (a) per task brief — workflow writes `apps/api/.env.test` inline via heredoc BEFORE the test step. The local `.env.test` is gitignored (verified — line `.env.test` in `.gitignore` "Env" block, file is not tracked), so CI cannot import it. The api test infra (`tests/helpers/setup-env.ts`, `setup-global.ts`, `teardown-global.ts`) all dotenv-load `apps/api/.env.test` at a fixed relative path; mirroring the file inline is the smallest-diff fix and keeps the test source untouched (option (b) — making setup-env.ts skip dotenv when env is already set — would have rippled into the test infra and required a re-verify pass).
- Lint ordering: lint runs BEFORE test (per task brief and good CI hygiene — fast feedback on style errors, no point booting Postgres + running 24 integration tests if ESLint is going to fail anyway).
- Verified locally: yes — re-ran `yarn workspace @app/api test` after the README edit; still 24/24 passing in ~1.9s. Static structural check on the YAML via `js-yaml` parsed cleanly; manually validated step ordering, service options, and ports mapping. CI workflow itself was NOT executed against GitHub Actions (no push made; that's finalize's job).
- `--frozen-lockfile` retained on `yarn install` — not relaxed; yarn.lock is committed and architect/backend already ran installs that updated it.
- jest.config.js sanity check: no path quirks. `roots: <rootDir>/tests`, `testMatch: '**/*.test.ts'`, `testPathIgnorePatterns` excludes `tests/helpers/`. Works identically on Linux runner as on macOS dev machine.
- Did NOT do (per task constraints): no Redis service (F3 decision), no separate test-stage Dockerfile, no `--frozen-lockfile` skip, no edit of `.env.test`, no edit of any test source file or root config.
- Notes for finalize:
  - Consider adding a CI status badge to the README header (e.g. `![CI](https://github.com/<owner>/mini-campaign-manager/workflows/CI/badge.svg)`) — needs the actual repo URL once it's pushed.
  - The "How I used Claude Code" F2 retrospective should mention that devops shipped CI as a separate phase (SHIP) AFTER VERIFY — the test-DB workflow is wired only after the tests it serves actually exist.
  - F3 will need to revisit this CI: when campaigns/recipients/sends migrations land, `truncateAll()` in tests/helpers must extend its TRUNCATE to cover those tables. The current TRUNCATE is `users` only.


---

## Summary (finalize)

Closed: 2026-05-07.

**Outcome:** F2 auth complete and verified end-to-end. 24/24 integration tests
passing against real Postgres. CI extended with Postgres service container.
Two BLOCKERs caught and fixed during code-review (algorithm pinning + body
size limit). 3 MEDIUM tech-debt items recorded for F3+.

**Definition of Done — final state:**
- [x] `yarn workspace @app/api migrate` runs the User migration cleanly (umzug)
- [x] `yarn workspace @app/api test` passes 24 tests, all hitting real DB
- [x] register → 201 with User (no password_hash)
- [x] login → 200 `{ token, user }`
- [x] middleware 401 on no/bad token
- [x] `yarn lint` exits 0 (only pre-existing architect no-console warning)
- [x] CI runs DB-backed tests successfully (postgres service container in workflow)
- [x] No secrets in committed code; `.env.example` updated; `.env.test` gitignored
- [x] `packages/shared` exports new types; `apps/api` consumes them
- [x] decisions.md updated with ADR-008 (umzug), ADR-009 (types-in-shared), ADR-010 (bcrypt 10), ADR-011 (JWT shape)

**Files touched in finalize:**
- `README.md` — updated status line + roadmap (F2 ✅ done), reorganized "How I Used Claude Code" with F1+F2 retrospectives in clean parallel structure
- `.hody/knowledge/spec-auth.md` — status: confirmed → implemented
- `.hody/state.json` — status: verified → completed

**Carry-forward to F3 (Campaigns + Recipients):**
- Mount `requireAuth` on every `/campaigns/*` and `/recipients/*` route
- All campaign queries scoped by `created_by = req.user.id` (tenancy via 404, not 403, to avoid existence leak)
- Add Campaign, Recipient, CampaignRecipient migrations as 0002, 0003, 0004
- Extend `truncateAll()` test helper to handle the new tables
- Reuse `AppError` hierarchy + `errorHandler` (already wired)
- Reuse zod env loader pattern for any new env vars
- Address MEDIUM tech-debt before F4: `JWT_EXPIRES_IN` regex validation (small fix)
- Resolve ADR-002 (async send) and ADR-003 (JWT storage on client) from "proposed" to "accepted" before F4

**Surface area added in F2 (for code-reviewer F3 reference):**
- 7 new files in `apps/api/src/{auth,db,errors,schemas,types}/`
- 1 migration file
- 4 test files (helpers + 3 auth suites)
- 5 new env vars: JWT_SECRET, JWT_EXPIRES_IN, CORS_ORIGINS, DATABASE_URL_TEST, (PORT existed before)
- 1 new dep: umzug (^3.8.2)
