---
tags: [architecture, system-design, planned]
created: 2026-05-06
author_agent: human
status: planned
---

# Architecture

> **Status:** Greenfield. No code exists yet — this document captures the *planned* architecture
> derived from `ASSIGNMENT.md`. The architect agent should refine this before implementation.

## System Overview

**Mini Campaign Manager** — a simplified MarTech web app for creating, scheduling, and
tracking email campaigns. Single-tenant, single-user-context (each user owns their
campaigns; auth via JWT).

Two primary actors:
- **Marketer (authenticated user):** creates campaigns, attaches recipients, schedules/sends, views stats.
- **Recipient (data only — no login):** receives email (simulated) and may "open" it.

## Component Diagram

```
┌──────────────────────────────────────────────────────────┐
│                    apps/web (React + Vite)               │
│  pages: /login, /campaigns, /campaigns/new, /campaigns/:id│
│  state: zustand (auth, ui)                               │
│  data:  react-query (server state)                       │
└───────────────────────┬──────────────────────────────────┘
                        │ HTTPS / JSON (JWT in header)
                        ▼
┌──────────────────────────────────────────────────────────┐
│                  apps/api (Express)                      │
│  ┌────────────────────────────────────────────────────┐  │
│  │ middleware: cors, json-parser, auth(jwt), validate │  │
│  └────────────────────────────────────────────────────┘  │
│  routes/                                                 │
│   ├── auth.routes.ts        → controllers/auth          │
│   ├── campaigns.routes.ts   → controllers/campaigns     │
│   └── recipients.routes.ts  → controllers/recipients    │
│  services/                                               │
│   ├── campaign.service.ts   (business rules)            │
│   ├── sender.service.ts     (async send simulation)     │
│   └── stats.service.ts                                  │
│  models/  (Sequelize)                                   │
│   ├── User, Campaign, Recipient, CampaignRecipient      │
└───────────────────────┬──────────────────────────────────┘
                        │
                        ▼
                ┌───────────────┐
                │  PostgreSQL   │
                └───────────────┘
```

## Data Flow

**Auth flow:**
`POST /auth/register` → hash password → insert User → return user.
`POST /auth/login` → verify password → sign JWT (HS256, short-lived) → return token.
Web stores JWT in memory (zustand) or httpOnly cookie (decision pending).

**Create campaign flow:**
`POST /campaigns` (with body: name, subject, body, recipients[]) →
validate (zod) → start tx → insert Campaign(status=draft) →
upsert Recipients by email → insert CampaignRecipient rows (status=pending) → commit.

**Schedule flow:**
`POST /campaigns/:id/schedule` → guard(status=draft) → guard(scheduled_at > now) →
update status=scheduled, scheduled_at=…

**Send flow (async simulation):**
`POST /campaigns/:id/send` → guard(status in {draft, scheduled}) →
update status=sending → enqueue background job (setImmediate) →
job iterates CampaignRecipient rows, randomly marks each `sent` or `failed`,
sets sent_at, then transitions Campaign.status=sent.
Response is 202 Accepted — client polls `GET /campaigns/:id` for stats.

**Open tracking (out of scope for HTTP — seeded/simulated):**
A demo script or hidden endpoint can stamp `opened_at` on a subset of `sent` recipients
to make `open_rate` non-zero during demo.

## Tech Stack Rationale

| Layer       | Choice                          | Why                                                          |
|-------------|---------------------------------|--------------------------------------------------------------|
| Backend     | Node.js + **Express** + TS      | Required by brief.                                           |
| ORM         | **Sequelize**                   | Required by brief. Has migrations + transactions + hooks.    |
| DB          | **PostgreSQL**                  | Required by brief. Good fit for relational stats queries.    |
| Validation  | **zod**                         | TypeScript-first; can derive types from schemas.             |
| Auth        | JWT (HS256)                     | Required by brief; simplest for a single-service app.        |
| Frontend    | React 18 + TS + **Vite**        | Required by brief.                                           |
| Data fetch  | **@tanstack/react-query**       | Required by brief; gives loading/error/cache for free.       |
| State       | **zustand**                     | Required by brief; lighter than Redux for this scope.        |
| UI kit      | TBD (shadcn/Chakra/MUI/Tailwind)| Pick fastest-to-ship that supports a11y + skeletons.         |
| Monorepo    | **yarn workspaces**             | Required by brief; share `types/` between apps/api + apps/web.|
| Tests       | jest + supertest (api), vitest (web) | Standard pairings; supertest hits real Express app.    |
| Local dev   | docker-compose (postgres + api) | Brief requests `docker compose up`. Web runs via vite dev.   |

## Open Architecture Questions (for architect agent to resolve)

1. JWT storage: in-memory (lose on refresh) vs. httpOnly cookie (CSRF concerns) — pick one and justify.
2. Background sending: pure `setImmediate` vs. BullMQ + Redis — BullMQ is nice-to-have but adds infra.
3. UI library choice — pick one and stick with it; don't mix.
4. Recipient association on campaign create: dedupe by email (upsert) vs. fail on duplicate — brief is silent.
5. `/stats` endpoint shape — brief shows JSON but doesn't say if it's a dedicated endpoint or part of `GET /campaigns/:id`. Default: nest stats inside campaign detail.

---

## F1 Scaffold — Locked Decisions

> Author: architect (THINK phase, F1). Date: 2026-05-06.
> Scope: only the root-level toolchain. Workspace internals (apps/api, apps/web)
> are decided by the BUILD agents per spec.

### Pinned versions (no `latest`)
| Tool | Version | Why |
|---|---|---|
| TypeScript | **5.4.5** | Stable; supports `moduleResolution: bundler`; works with @typescript-eslint 7.x. |
| ESLint | **8.57.1** | Last legacy-config 8.x. Avoids ESLint 9 flat-config migration cost (would burn 1-2h). |
| @typescript-eslint/parser | **7.18.0** | Officially supports ESLint 8.57 + TS 5.4. |
| @typescript-eslint/eslint-plugin | **7.18.0** | Same as parser. |
| eslint-config-prettier | **9.1.0** | Disables ESLint rules that conflict with Prettier. |
| Prettier | **3.3.3** | Current stable. |
| Yarn | **1.22.22 (classic)** | Per spec; workspaces first-class; no Berry complexity. |
| Node | **20 LTS** | `.nvmrc=20`, `engines.node=">=20"`. |

### tsconfig.base.json — locked options
- `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`.
- **Why `bundler`** (not `node16`): TS 5.0+ adds the `bundler` mode which matches how both `tsx` (backend dev) and Vite (frontend) actually resolve modules — no `.js` extension juggling on imports. Both BUILD targets handle it cleanly. If the backend agent hits a runtime resolution snag with `tsx`, they can override `moduleResolution: node16` in `apps/api/tsconfig.json` only.
- Strictness: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
- Interop: `esModuleInterop`, `allowSyntheticDefaultImports`, `resolveJsonModule`, `isolatedModules`, `skipLibCheck`.
- **No project references / no `composite`** — keeps the build graph trivial for a 4-8h assignment. `@app/shared` is consumed as TS source via Yarn workspaces hoisting; api/web compile their own trees.

### .eslintrc.cjs — root only
- Extends `eslint:recommended`, `plugin:@typescript-eslint/recommended`, `prettier`.
- Tightening: `no-unused-vars` (with `_` prefix escape), `no-explicit-any: warn`, `consistent-type-imports`, `eqeqeq`, `prefer-const`, `no-console: warn` (allow `warn|error|info`).
- React/JSX rules deliberately NOT here — they live in `apps/web/.eslintrc.cjs` so the root config stays portable.
- Jest/vitest globals also NOT here — workspace-local.

### .prettierrc
- `singleQuote`, `semi: true`, `trailingComma: "all"`, `printWidth: 100`, `tabWidth: 2`, `endOfLine: "lf"`.

### Root scripts
- `dev`/`build`/`test` use `yarn workspaces run <script>` — fans out to each workspace.
- `lint`/`format` run from root across the whole tree (single eslint/prettier process is faster than per-workspace).
- `db:up`/`db:down` thin wrappers over `docker compose` (devops will write the compose file).

### Deviations from spec-scaffold-and-dev-env.md
None. All choices match the spec's "Locked tech decisions" table. The spec listed eslint 8 + @typescript-eslint and prettier 3 — I pinned exact patch versions and chose `moduleResolution: bundler` (spec didn't specify; this matches Vite + tsx ergonomics).

---

## F2 Auth — Locked Decisions

> Author: architect (THINK phase, F2). Date: 2026-05-06.
> Scope: tooling + scaffold contracts that BUILD must follow without redeciding.
> Spec: `.hody/knowledge/spec-auth.md`.

### File map (apps/api delta — created by THINK as skeletons; BUILD fills bodies)

```
apps/api/
├── .sequelizerc                          [THINK] CLI helper paths only — runtime
│                                                  uses umzug-direct (NOT sequelize-cli).
├── migrations/
│   └── 0001-create-users.ts              [BUILD] CREATE EXTENSION citext + pgcrypto;
│                                                  CREATE TABLE users (...). Spec §"Data model".
├── src/
│   ├── db/
│   │   ├── sequelize.ts                  [THINK] Singleton + pingDatabase().
│   │   ├── migrate.ts                    [THINK] Umzug-direct CLI runner.
│   │   └── models/
│   │       └── User.ts                   [BUILD] Sequelize model. underscored:true.
│   ├── auth/
│   │   ├── routes.ts                     [BUILD] Express Router; mounts /register, /login.
│   │   ├── controller.ts                 [BUILD] Thin: parse(zod) -> service -> 201/200.
│   │   ├── service.ts                    [BUILD] hashPassword/verifyPassword/createUser/
│   │   │                                          signToken/findByEmailLower.
│   │   └── middleware.ts                 [BUILD] requireAuth(req,res,next). Not mounted in F2.
│   ├── errors/
│   │   ├── AppError.ts                   [THINK] Base + 5 subclasses (400/401/403/404/409).
│   │   └── handler.ts                    [THINK] Express error handler — full dispatch table.
│   ├── schemas/
│   │   └── auth.schema.ts                [BUILD] zod registerSchema, loginSchema. z.infer types.
│   ├── routes/
│   │   └── health.ts                     [BUILD-EDIT] Add DB ping; 200 {ok:true,db:'up'}
│   │                                                  | 503 {ok:false,db:'down'}.
│   ├── app.ts                            [BUILD-EDIT] Lock cors() to env.CORS_ORIGINS;
│   │                                                  mount /auth; replace generic 500
│   │                                                  with errors/handler.ts.
│   └── config/env.ts                     [THINK] Added JWT_SECRET, JWT_EXPIRES_IN,
│                                                  CORS_ORIGINS (CSV->string[]),
│                                                  DATABASE_URL_TEST (required when test).
└── tests/
    ├── helpers/
    │   ├── db.ts                         [BUILD] truncate-all helper for afterEach.
    │   └── server.ts                     [BUILD] boot createApp() + run migrations once.
    ├── auth.register.test.ts             [TEST]  register happy / dup / invalid.
    ├── auth.login.test.ts                [TEST]  login happy / wrong password.
    └── auth.middleware.test.ts           [TEST]  requireAuth missing/bad token.

packages/shared/src/index.ts              [THINK] Pure-type exports: User,
                                                  RegisterRequest, LoginRequest,
                                                  AuthResponse, ApiError.
```

### Error class hierarchy

```
AppError(status, { code, message, details? })
 ├── ValidationError    -> 400
 ├── UnauthorizedError  -> 401
 ├── ForbiddenError     -> 403
 ├── NotFoundError      -> 404
 └── ConflictError      -> 409
```

Mapping table in `errors/handler.ts`:

| Source                        | HTTP | code (default)        | Notes                                           |
|-------------------------------|------|-----------------------|-------------------------------------------------|
| `ZodError`                    | 400  | `VALIDATION_ERROR`    | `details` = `err.issues` (BUILD trims to {path,message}). |
| `AppError` subclass           | own  | own                   | `err.code`/`err.message`/`err.details`.         |
| `UniqueConstraintError`       | 409  | `UNIQUE_CONSTRAINT`   | Service layer should catch & rethrow as `ConflictError({code:'EMAIL_TAKEN'})`. |
| `TokenExpiredError`           | 401  | `TOKEN_EXPIRED`       | Lets clients distinguish from invalid token.    |
| `JsonWebTokenError`           | 401  | `INVALID_TOKEN`       |                                                 |
| anything else                 | 500  | `INTERNAL`            | Logs internally; never leaks `err.message`.     |

### Migration tooling — umzug-direct, NOT sequelize-cli

**Decision:** Run migrations through a small `src/db/migrate.ts` script that wraps `umzug` directly. Wired via:

```
yarn workspace @app/api migrate          # umzug.up()
yarn workspace @app/api migrate:undo     # umzug.down() (last only)
yarn workspace @app/api migrate:status   # list executed/pending
```

**Why over the spec's "sequelize-cli with TS migrations":**

1. We're CommonJS in `apps/api`. `sequelize-cli` + TS migrations needs either
   `sequelize-cli-typescript` (community fork, sporadic upkeep) or a `babel-register`
   hook in `.sequelizerc`. Both add fragility BUILD can't iterate on without
   running code (same constraint that drove F1's CJS-over-ESM choice).
2. `umzug` is what `sequelize-cli` wraps internally. Calling it directly with
   `tsx src/db/migrate.ts` skips the CLI's config-loader gymnastics — `.ts`
   files load as-is, no babel.
3. We still ship `.sequelizerc` so contributors who run `sequelize-cli migration:generate`
   for ad-hoc scaffolding land files in the right folder. Just not as the runtime.

The deviation is documented as **ADR-008** in decisions.md.

### Schemas-vs-types split — types in shared, schemas in api (Option B)

**Decision:** Pure TS interfaces (no zod) in `packages/shared/src/index.ts`.
Zod schemas live in `apps/api/src/schemas/auth.schema.ts` and validate inputs
inside the api workspace only.

**Why over Option A (zod schemas in shared, `z.infer` re-exported):**

- `@app/shared` would have to ship `zod` as a runtime dependency. The web app
  would then drag zod into its bundle just to read types — wasteful.
- Shared is currently consumed as TS source (no build step). Adding a runtime
  import means we either build shared (more tooling) or accept the bundler
  pulling zod into `apps/web` (bigger bundle).
- Hand-keeping interfaces and zod schemas in sync is cheap for this surface
  (5 types, 2 schemas in F2). The integration tests catch any drift —
  `auth.register.test.ts` exercises the registerSchema + the User type both,
  through the wire.

The deviation is documented as **ADR-010** in decisions.md.

### JWT payload shape (locked)

```ts
// signed in apps/api/src/auth/service.ts via jsonwebtoken@9
{
  sub:   string,   // User.id (uuid)
  email: string    // User.email — not strictly needed but lets requireAuth
                   //              attach req.user without a DB round-trip.
}
// Algo:    HS256
// Secret:  env.JWT_SECRET (>=32 chars in production)
// ExpIn:   env.JWT_EXPIRES_IN (default '24h')
```

`requireAuth` in `apps/api/src/auth/middleware.ts`:
- Reads `Authorization: Bearer <jwt>`.
- Verifies with `jsonwebtoken.verify(token, env.JWT_SECRET)`.
- On success: `req.user = { id: payload.sub, email: payload.email }` and `next()`.
- On missing/invalid/expired: throw `UnauthorizedError({ code: 'UNAUTHORIZED' })`
  for missing header — let `JsonWebTokenError`/`TokenExpiredError` from `verify`
  propagate so `errors/handler.ts` maps them per the table above.
- BUILD adds the `req.user` typing via a module augmentation file (e.g. `src/types/express.d.ts`).
- Not mounted on any route in F2 — F3 will use it on `/campaigns/*` and `/recipients/*`.

### env.ts schema additions (locked)

| Var                  | Type                | Default                   | Required when      |
|----------------------|---------------------|---------------------------|--------------------|
| `JWT_SECRET`         | string (>=32 in prod) | —                       | always             |
| `JWT_EXPIRES_IN`     | string              | `'24h'`                   | optional           |
| `CORS_ORIGINS`       | string[] (CSV)      | `['http://localhost:5173']` | optional         |
| `DATABASE_URL_TEST`  | string              | —                         | NODE_ENV=test only |

The CSV transform happens in zod (`.transform`) so consumers always read
`env.CORS_ORIGINS` as `string[]`, never split it themselves.

### Test DB strategy (heads-up for integration-tester)

- `NODE_ENV=test` switches `sequelize.ts` to use `DATABASE_URL_TEST`.
- Global setup (`tests/helpers/server.ts`) calls `runMigrations()` once.
- `afterEach` truncates all tables (helper in `tests/helpers/db.ts`) — preserves the schema, wipes rows.
- CI gets a `services.postgres` block in `.github/workflows/ci.yml` (devops's job).

### Deviations from spec-auth.md

- **Migration tooling**: spec said sequelize-cli; I ship umzug-direct. Reason
  in ADR-008. The acceptance criterion "yarn migrate runs the User migration
  cleanly" still holds — only the runner under the hood changed.
- **Schemas vs types**: spec hints both options without picking; I pick Option B
  (types-in-shared, schemas-in-api) for bundle hygiene. ADR-010.
- Everything else matches spec exactly.

---

## F3 Campaigns CRUD — Locked Decisions

> Author: architect (THINK phase, F3). Date: 2026-05-08.
> Scope: tooling + scaffold contracts that BUILD must follow without redeciding.
> Spec: `.hody/knowledge/spec-campaigns-crud.md`.

### File map (apps/api delta — created by THINK as skeletons; BUILD fills bodies)

```
apps/api/
├── migrations/
│   ├── 0002-create-campaigns.ts              [THINK] CREATE TYPE campaign_status,
│   │                                                  CREATE TABLE campaigns + 2 indexes.
│   ├── 0003-create-recipients.ts             [THINK] CREATE TABLE recipients (CITEXT email UNIQUE).
│   └── 0004-create-campaign-recipients.ts    [THINK] CREATE TYPE + join table + FK constraints.
├── src/
│   ├── db/
│   │   ├── models/
│   │   │   ├── Campaign.ts                   [THINK] init() + types only.
│   │   │   ├── Recipient.ts                  [THINK] init() + types only.
│   │   │   └── CampaignRecipient.ts          [THINK] init() + types only.
│   │   └── associations.ts                   [THINK] All hasMany/belongsTo wired here.
│   ├── campaigns/
│   │   ├── schema.ts                         [THINK] zod create/update/list schemas.
│   │   ├── service.ts                        [THINK] Function signatures + TODO bodies.
│   │   ├── stats.ts                          [THINK] STATS_SQL constant + TODO compute fn.
│   │   ├── controller.ts                     [BUILD] Thin: parse(zod) -> service -> JSON.
│   │   └── routes.ts                         [BUILD] Router. requireAuth ALL routes.
│   ├── recipients/
│   │   ├── schema.ts                         [THINK] zod create/list schemas.
│   │   ├── service.ts                        [THINK] Function signatures + TODO bodies.
│   │   ├── controller.ts                     [BUILD]
│   │   └── routes.ts                         [BUILD]
│   ├── app.ts                                [BUILD-EDIT] Mount /campaigns + /recipients
│   │                                                       behind requireAuth (see "Mount order").
│   └── index.ts                              [BUILD-EDIT] Add side-effect import
│                                                       of './db/associations'.
└── tests/
    └── helpers/server.ts                     [THINK-EDIT] Side-effect imports for new
                                                       models + associations; truncate()
                                                       extended to wipe new tables.

packages/shared/src/index.ts                  [THINK-EDIT] Type-only exports added: Campaign,
                                                       CampaignStatus, CampaignRecipientStatus,
                                                       Recipient, CampaignRecipientRow,
                                                       CampaignStats, CampaignDetail,
                                                       CreateCampaignRequest,
                                                       UpdateCampaignRequest, PaginatedList<T>.
```

### Model relationship graph

```
                ┌────────────┐
                │   users    │  (F2)
                └─────┬──────┘
                      │ 1
                      │
                      │ N
                ┌─────▼──────┐
                │ campaigns  │
                │  (F3)      │
                └─────┬──────┘
                      │ 1
                      │
                      │ N
            ┌─────────▼─────────┐
            │ campaign_         │
            │  recipients       │   (M:N with status / sent_at / opened_at)
            │  (F3, join)       │
            └─────────┬─────────┘
                      │ N
                      │
                      │ 1
                ┌─────▼──────┐
                │ recipients │  (F3, tenant-shared per ADR-012)
                └────────────┘

FK constraints:
  campaigns.created_by             -> users.id           ON DELETE CASCADE
  campaign_recipients.campaign_id  -> campaigns.id       ON DELETE CASCADE
  campaign_recipients.recipient_id -> recipients.id      ON DELETE RESTRICT
```

Sequelize associations (in `src/db/associations.ts`):

| From → To                              | Relation       | FK              | Alias (`as`)             |
|----------------------------------------|----------------|-----------------|--------------------------|
| User → Campaign                        | hasMany        | created_by      | `campaigns`              |
| Campaign → User                        | belongsTo      | created_by      | `creator`                |
| Campaign → CampaignRecipient           | hasMany        | campaign_id     | `campaignRecipients`     |
| CampaignRecipient → Campaign           | belongsTo      | campaign_id     | `campaign`               |
| Recipient → CampaignRecipient          | hasMany        | recipient_id    | `campaignRecipients`     |
| CampaignRecipient → Recipient          | belongsTo      | recipient_id    | `recipient`              |
| Campaign ↔ Recipient (M:N via CR)      | belongsToMany  | through CR      | `recipients` / `campaigns` |

### Stats query (single SQL, no N+1)

Constant lives at `src/campaigns/stats.ts` as `STATS_SQL`:

```sql
SELECT
  COUNT(*)::int                                          AS total,
  COUNT(*) FILTER (WHERE status = 'sent')::int           AS sent,
  COUNT(*) FILTER (WHERE status = 'failed')::int         AS failed,
  COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int     AS opened
FROM campaign_recipients
WHERE campaign_id = :campaignId;
```

Bound via:

```ts
const rows = await sequelize.query<StatsRow>(STATS_SQL, {
  replacements: { campaignId },
  type: QueryTypes.SELECT,
});
```

Then in TS:

```ts
const send_rate = total > 0 ? sent / total : 0;
const open_rate = sent  > 0 ? opened / sent : 0;
```

Why this shape:
- `FILTER (WHERE ...)` is Postgres-native — one pass over the table.
- `::int` cast prevents COUNT-as-bigint coming back as a string.
- `:campaignId` is bind-bound, never interpolated → SQL-injection-safe.
- Tenancy is enforced UPSTREAM in `service.getCampaignDetail` — this function
  trusts the caller. NEVER call it without a prior `findOne({ where: { id, created_by: userId } })`.

### List query shape (paginated, tenant-scoped)

```sql
SELECT *
FROM campaigns
WHERE created_by = :userId
  AND ($status::campaign_status IS NULL OR status = $status)
ORDER BY updated_at DESC
LIMIT :limit OFFSET :offset;
```

`offset = (page - 1) * limit`. Backend may use `Campaign.findAndCountAll`
(Sequelize gives both rows + total in one call) instead of writing the SQL
by hand — both produce the same result.

### Index plan

| Index                                                      | Where it helps                                              |
|------------------------------------------------------------|-------------------------------------------------------------|
| `campaigns(created_by, updated_at DESC)`                   | `GET /campaigns` filter + sort.                             |
| `campaigns(status, scheduled_at) WHERE status='scheduled'` | F4 worker scans due-soon scheduled campaigns; partial = small. |
| `recipients(email) UNIQUE`                                 | Upsert-by-email + duplicate detection.                      |
| `campaign_recipients(campaign_id, recipient_id) UNIQUE`    | Prevents same recipient attached twice to same campaign.    |
| `campaign_recipients(campaign_id)`                         | Stats aggregate `WHERE campaign_id = :id`.                  |

### Mount order in app.ts (BUILD must add)

After existing `/auth` mount, BEFORE `errorHandler`:

```ts
import campaignsRouter from './campaigns/routes';
import recipientsRouter from './recipients/routes';
import { requireAuth } from './auth/middleware';

// ...
app.use('/auth', authRouter);
app.use('/campaigns', requireAuth, campaignsRouter);   // NEW
app.use('/recipients', requireAuth, recipientsRouter); // NEW
app.use('/health', healthRouter);

app.use(errorHandler); // must remain LAST
```

`requireAuth` is mounted at the router level so EVERY route under `/campaigns`
and `/recipients` is protected. Individual route handlers don't need to
re-apply it. `req.user.id` is the source of `userId` for service calls.

### Deviations from spec-campaigns-crud.md

- None. All file paths, schema shapes, and API contracts match the spec.
- Added `id` UUID PK on `campaign_recipients` (spec implies it but doesn't
  enforce it). The composite (campaign_id, recipient_id) remains UNIQUE at
  the table level. Reason: simplifies row-level operations from JS land
  (e.g. F4 open-tracking endpoint can `findByPk`).

---

## F4 Schedule/Send — Locked Decisions

> Author: architect (THINK phase, F4). Date: 2026-05-08.
> Scope: tooling + scaffold contracts that BUILD must follow without redeciding.
> Spec: `.hody/knowledge/spec-schedule-send.md`.

### File map (apps/api delta — created/modified by THINK as skeletons; BUILD fills bodies)

```
apps/api/
├── src/
│   ├── campaigns/
│   │   ├── schema.ts           [THINK-EDIT] + scheduleSchema, openTrackParamsSchema.
│   │   ├── service.ts          [THINK-EDIT] + ATOMIC_*_SQL constants,
│   │   │                                       scheduleCampaign(), sendCampaign(),
│   │   │                                       trackOpen() — TODO bodies.
│   │   ├── worker.ts           [THINK-NEW]  runSendWorker + runSendWorkerForTests
│   │   │                                     — TODO bodies; awaitable test variant.
│   │   ├── controller.ts       [THINK-EDIT] + scheduleCampaign / sendCampaign /
│   │   │                                       trackOpen handler skeletons (TODO).
│   │   └── routes.ts           [THINK-EDIT] + 3 new POST routes (order locked below).
│   ├── config/env.ts           [THINK-EDIT] + SEND_SUCCESS_RATE, SEND_WORKER_DELAY_MS.
│   └── (no changes to app.ts — /campaigns is already mounted; new routes attach to the same router)
└── .env.example                [THINK-EDIT] + SEND_SUCCESS_RATE, SEND_WORKER_DELAY_MS docs.

packages/shared/src/index.ts    [THINK-EDIT] + ScheduleCampaignRequest, SendCampaignResponse.
```

### Atomic UPDATE SQL constants (kept in `service.ts`)

These are the LOAD-BEARING decision of F4. The `WHERE ... AND status IN (...)`
clause is the state-machine guard at the SQL level — there is NO read-modify-
write window where a concurrent transition could slip in. Closes the F3
carry-forward MEDIUM ("find-then-update race", documented in tech-debt.md).

```sql
-- ATOMIC_SCHEDULE_SQL
UPDATE campaigns
   SET status='scheduled', scheduled_at=:scheduledAt, updated_at=NOW()
 WHERE id=:id AND created_by=:userId AND status='draft';

-- ATOMIC_SEND_SQL
UPDATE campaigns
   SET status='sending', updated_at=NOW()
 WHERE id=:id AND created_by=:userId AND status IN ('draft','scheduled');

-- ATOMIC_OPEN_TRACK_SQL
UPDATE campaign_recipients cr
   SET opened_at=NOW()
  FROM campaigns c
 WHERE cr.campaign_id=c.id
   AND c.id=:campaignId AND c.created_by=:userId
   AND cr.recipient_id=:recipientId
   AND cr.status='sent' AND cr.opened_at IS NULL;
```

Bind-pattern: every variable comes through Sequelize `replacements:` named
binds — never string-interpolated. SQL-injection-safe.

After UPDATE the service inspects `affectedRows`:
- `=== 1` → success (re-fetch + return DTO for schedule; return synthetic `{ id, status: 'sending' }` for send; no-op for open-track).
- `=== 0` → run a follow-up `Campaign.findOne({ where: { id, createdBy: userId } })` to distinguish:
  - missing → 404 `CAMPAIGN_NOT_FOUND` (covers genuine miss + foreign tenancy; same body, no existence leak).
  - present → 409 `CAMPAIGN_NOT_SCHEDULABLE` / `CAMPAIGN_NOT_SENDABLE`.

### Worker design — bucket + bulk-update + atomic flip

Two exports, one body (see `worker.ts`):
- `runSendWorker(campaignId)` — production. NEVER throws. Wraps the body in
  try/catch + `console.error('[send-worker]', ...)`. Called via
  `setImmediate(() => runSendWorker(id).catch(...))` from the controller
  AFTER `res.status(202).json(...)`.
- `runSendWorkerForTests(campaignId)` — test mode. Same body, throws on
  error so tests can assert the failure path. Tests `await` it directly.

Worker steps:
1. `CampaignRecipient.findAll({ where: { campaignId, status: 'pending' } })`.
   The `status='pending'` filter makes a partial retry safe — re-running
   the worker only touches still-pending rows.
2. Bucket each row into `sentIds` / `failedIds` via
   `Math.random() < env.SEND_SUCCESS_RATE`.
3. At most TWO bulk UPDATEs (skip the bucket if empty):
   - `UPDATE campaign_recipients SET status='sent',   sent_at=NOW() WHERE id IN (:sentIds)`
   - `UPDATE campaign_recipients SET status='failed', sent_at=NOW() WHERE id IN (:failedIds)`
   `sent_at` is stamped on BOTH outcomes — represents "attempted at" per
   business-rules.md.
4. (Optional) `await sleep(env.SEND_WORKER_DELAY_MS)` so tests can observe
   the `sending` intermediate state via polling. Default 0 in production.
5. Atomic flip — only when still `'sending'`:
   ```sql
   UPDATE campaigns SET status='sent', updated_at=NOW()
    WHERE id=:campaignId AND status='sending';
   ```
   Idempotent on retry; will not trample a manual fix that already moved
   the campaign.

### Error code table (F4 surface)

| Endpoint                                                         | HTTP | Code                       | When                                       |
|------------------------------------------------------------------|------|----------------------------|--------------------------------------------|
| `POST /campaigns/:id/schedule`                                   | 200  | —                          | Atomic UPDATE affected 1 row.              |
| `POST /campaigns/:id/schedule`                                   | 400  | `VALIDATION_ERROR`         | zod fail (non-ISO / extra keys).           |
| `POST /campaigns/:id/schedule`                                   | 400  | `SCHEDULED_AT_IN_PAST`     | server-clock guard (zod ok, time past).    |
| `POST /campaigns/:id/schedule`                                   | 404  | `CAMPAIGN_NOT_FOUND`       | id miss / foreign user (no existence leak).|
| `POST /campaigns/:id/schedule`                                   | 409  | `CAMPAIGN_NOT_SCHEDULABLE` | exists but status != 'draft'.              |
| `POST /campaigns/:id/send`                                       | 202  | —                          | Atomic UPDATE affected 1 row + worker kicked.|
| `POST /campaigns/:id/send`                                       | 404  | `CAMPAIGN_NOT_FOUND`       | id miss / foreign user.                    |
| `POST /campaigns/:id/send`                                       | 409  | `CAMPAIGN_NOT_SENDABLE`    | exists but status not in {draft,scheduled}.|
| `POST /campaigns/:id/recipients/:recipientId/open`               | 204  | —                          | Always on success path (idempotent no-op). |
| `POST /campaigns/:id/recipients/:recipientId/open`               | 400  | `VALIDATION_ERROR`         | non-UUID path params (zod).                |

### Response status codes

| Endpoint                          | Status | Reason                                                                  |
|-----------------------------------|--------|-------------------------------------------------------------------------|
| `POST /campaigns/:id/schedule`    | 200    | Synchronous transition; full updated `Campaign` DTO in body.            |
| `POST /campaigns/:id/send`        | 202    | Async; body is `{ id, status: 'sending' }`. Client polls `GET /:id`.    |
| `POST /campaigns/:id/recipients/:recipientId/open` | 204 | No content; idempotent silent no-op on already-opened/foreign cases. |

### Env additions (`apps/api/src/config/env.ts` + `.env.example`)

| Var                      | Type                       | Default | Why                                                          |
|--------------------------|----------------------------|---------|--------------------------------------------------------------|
| `SEND_SUCCESS_RATE`      | `number` in [0, 1]         | `0.8`   | Per-recipient sent probability. Tests override to 1.0/0.0.   |
| `SEND_WORKER_DELAY_MS`   | non-negative integer ms    | `0`     | Optional artificial delay so tests can observe `sending`.    |

### Mount order (`apps/api/src/campaigns/routes.ts`)

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

Express matches by exact path on each route, so the F4 sub-resource routes
are NOT shadowed by `:id` (which is a different path). Order is preserved
mainly for human readability + matching the spec's file map.

### Test-flow for the worker

Tests should NOT poll `GET /campaigns/:id` with timeouts unless the test is
specifically about the polling UX. The cleaner pattern:

```ts
import { runSendWorkerForTests } from '../src/campaigns/worker';
// ...
await request(app).post(`/campaigns/${id}/send`).set(authHeader).expect(202);
// Now manually drain the worker — deterministic, no setTimeout.
await runSendWorkerForTests(id);
// Assert eventual state directly:
const detail = await request(app).get(`/campaigns/${id}`).set(authHeader);
expect(detail.body.status).toBe('sent');
```

For tests that DO want to observe the `sending` intermediate state, set
`SEND_WORKER_DELAY_MS=200` in the test's env, send through the route, poll
within the delay window, then `await runSendWorkerForTests(id)` to drain.

### Deviations from spec-schedule-send.md

- None. All file paths, schema shapes, error codes, and the atomic SQL
  pattern match the spec. The `runSendWorkerForTests` awaitable variant is
  the spec's own "tests are awaited by exposing a Promise<void>" idea, just
  named explicitly so production code can never accidentally serialize a
  request behind it.

---

## F5 Frontend — Locked Decisions

> Architect THINK output for spec-frontend-pages.md. Skeleton files in
> place; frontend agent fills bodies in BUILD. Names, signatures, and the
> error/status maps below are LOCKED — frontend MUST NOT change them.

### Component / file map (apps/web/src delta)

```
apps/web/src/
├── App.tsx                            (UPDATED: 6 routes + 2 redirects)
├── lib/
│   ├── api.ts                         (UPDATED: interceptor TODOs documented)
│   └── queryClient.ts                 (unchanged from F1)
├── store/
│   └── auth.ts                        (UPDATED: { token, user, login(auth), logout() })
├── pages/                             (NEW)
│   ├── LoginPage.tsx                  TODO body
│   ├── RegisterPage.tsx               TODO body
│   ├── CampaignsListPage.tsx          TODO body
│   ├── CampaignNewPage.tsx            TODO body
│   └── CampaignDetailPage.tsx         TODO body
├── components/                        (NEW)
│   ├── ProtectedRoute.tsx             FILLED IN (small, locked)
│   ├── StatusBadge.tsx                FILLED IN (status -> Tag color/label map)
│   ├── StatsBlock.tsx                 TODO body (interface only)
│   ├── RecipientsTable.tsx            TODO body (interface only)
│   ├── CampaignActions.tsx            TODO body (interface only)
│   └── ErrorAlert.tsx                 FILLED IN (uses messageFor)
├── hooks/                             (NEW)
│   ├── useAuth.ts                     declare-only (frontend implements)
│   └── useCampaigns.ts                declare-only (frontend implements)
└── types/
    └── api-error.ts                   FILLED IN (ERROR_MESSAGES + messageFor + isApiErrorResponse)
```

### Component diagram

```
App.tsx (Routes)
├── /login              -> LoginPage         ──┐
├── /register           -> RegisterPage      ──┤ public
├── /campaigns          -> ProtectedRoute(CampaignsListPage)
├── /campaigns/new      -> ProtectedRoute(CampaignNewPage)
└── /campaigns/:id      -> ProtectedRoute(CampaignDetailPage)
                              │
                              └── header + StatusBadge + StatsBlock
                                  + RecipientsTable + CampaignActions

Cross-cutting:
  ErrorAlert       — used by every page on failed mutations / queries
  useAuthStore     — read by ProtectedRoute, axios interceptor, useLogout
  api (axios)      — single instance; interceptors injected in lib/api.ts
  queryClient      — shared react-query client (lib/queryClient.ts)
```

### Error code -> user message map (authority)

The map lives in `apps/web/src/types/api-error.ts` as `ERROR_MESSAGES` +
`messageFor(code, fallback)`. **Pages and components MUST pattern-match on
`error.code`, never on `error.message`.** Codes covered:

| Code | Source | User message |
|---|---|---|
| `VALIDATION_ERROR` | zod (any endpoint) | "The form has invalid input. Check the highlighted fields." |
| `EMAIL_TAKEN` | POST /auth/register | "An account with this email already exists." |
| `INVALID_CREDENTIALS` | POST /auth/login | "Invalid email or password." |
| `UNAUTHORIZED` / `INVALID_TOKEN` / `TOKEN_EXPIRED` | requireAuth middleware | "Your session has expired. Please log in again." |
| `CAMPAIGN_NOT_FOUND` | GET/PATCH/DELETE/schedule/send /:id | "Campaign not found." |
| `CAMPAIGN_NOT_EDITABLE` | PATCH /:id (non-draft) | "This campaign can no longer be edited (it has been scheduled or sent)." |
| `CAMPAIGN_NOT_SCHEDULABLE` | POST /:id/schedule | "This campaign cannot be scheduled (likely already scheduled or sent)." |
| `CAMPAIGN_NOT_SENDABLE` | POST /:id/send | "This campaign cannot be sent (likely already sent)." |
| `SCHEDULED_AT_IN_PAST` | POST /:id/schedule | "Schedule date must be in the future." |
| `RECIPIENT_EMAIL_TAKEN` | POST /recipients | "A recipient with this email already exists." |
| `INTERNAL` | unhandled 500 | "Something went wrong on our side. Please try again." |

Unknown codes fall back to `messageFor`'s `fallback` arg (typically
`err.response?.data?.error?.message`) and finally to a literal
`'Unknown error.'` — never blank, never a stack trace.

### Status -> AntD color/label map (authority)

`apps/web/src/components/StatusBadge.tsx` `STATUS_MAP` is canonical:

| status | AntD `Tag` color | label |
|---|---|---|
| `draft` | `default` (grey) | `Draft` |
| `scheduled` | `processing` (blue, animated dot) | `Scheduled` |
| `sending` | `warning` (orange) | `Sending…` |
| `sent` | `success` (green) | `Sent` |

The `RecipientsTable` recipient-status tag uses a parallel-but-distinct
mapping (`pending -> default`, `sent -> success`, `failed -> error`); it
is documented in that component's JSDoc.

### Polling rule (locked)

`useCampaign(id, opts?)` enables react-query `refetchInterval: 1500` ONLY
when `opts.polling === true` AND the cached `data?.status === 'sending'`.
Any other status (or `opts.polling === false`/undefined) sets
`refetchInterval: false` so polling stops immediately as soon as the
backend flips to `sent`. `refetchIntervalInBackground: false` so a
hidden tab doesn't keep hitting the API.

Why 1500ms: visible-state UX (the user is staring at the page) without
hammering the API across multiple tabs / Strict Mode double-runs in dev.

### Hook signatures (locked)

```ts
// useAuth.ts
useLoginMutation():    UseMutationResult<AuthResponse, unknown, LoginRequest>
useRegisterMutation(): UseMutationResult<User, unknown, RegisterRequest>
useLogout():           () => void   // clears store + queryClient.clear() + navigate('/login')

// useCampaigns.ts
useCampaignsList(query: ListQuery):       UseQueryResult<PaginatedList<Campaign>>
useCampaign(id, opts?: { polling?: boolean }): UseQueryResult<CampaignDetail>
useCreateCampaignMutation():   UseMutationResult<Campaign, unknown, CreateCampaignRequest>
useScheduleCampaignMutation(): UseMutationResult<Campaign, unknown, { id } & ScheduleCampaignRequest>
useSendCampaignMutation():     UseMutationResult<SendCampaignResponse, unknown, { id }>
useDeleteCampaignMutation():   UseMutationResult<void, unknown, { id }>
```

QueryKeys (locked so invalidation works across mutations):
- list page: `['campaigns', { page, limit, status }]`
- detail page: `['campaign', id]`

### Axios interceptor contract (locked; frontend implements)

Documented inline in `apps/web/src/lib/api.ts`:

- **Request**: read `useAuthStore.getState().token` (NOT the React hook —
  interceptors run outside the render tree); if non-null, set
  `config.headers.Authorization = \`Bearer ${token}\``. Always return
  `config` (don't reject on missing token — public endpoints exist).
- **Response**: on success pass through; on error if `status === 401`,
  `useAuthStore.getState().logout()` then `window.location.href =
  '/login'` (hard redirect, simpler than threading a `useNavigate`
  callback through the interceptor) then `Promise.reject(error)`.

### Routing shell

```
/login           -> LoginPage           (public)
/register        -> RegisterPage        (public)
/campaigns       -> ProtectedRoute(CampaignsListPage)
/campaigns/new   -> ProtectedRoute(CampaignNewPage)
/campaigns/:id   -> ProtectedRoute(CampaignDetailPage)
/                -> Navigate to /campaigns
*                -> Navigate to /campaigns
```

`ProtectedRoute` reads `useAuthStore(s => s.token)`; falsy -> `<Navigate
to="/login" replace />`. The 401-mid-session case is the interceptor's
responsibility (above).

### F4 carry-forward UX rules baked into the design

1. **Send is 202 + `status='sending'`** — `useSendCampaignMutation` does
   NOT assume success; the campaign detail polls (`refetchInterval:
   1500`) until status leaves `sending`. The Send button enters a
   `loading` state and CampaignActions hides further actions while
   sending.
2. **Open-tracking is silent 204** — `CampaignDetailPage` re-fetches
   `['campaign', id]` after invoking the open endpoint (or after the
   demo seed runs); there is no per-call success signal from the API.
3. **Pattern-match `error.code` ONLY** — `messageFor(err.code)` is the
   ONLY way to translate errors to UI copy. Never branch on or render
   `err.message` directly.

### Out-of-scope / explicitly deferred

- Edit campaign UI (PATCH from the frontend) — F6.
- Recipient management standalone page — F6.
- Token persistence (localStorage / cookie) — ADR-003 stays in-memory.
- E2E tests, i18n, dark mode, mobile-first.

### Deviations from spec-frontend-pages.md

- None on file/path/contract level. The store skeleton's existing
  `setAuth` / `clear` names from F1 were renamed to `login(auth)` /
  `logout()` per the spec's "Zustand store skeleton" snippet — a strict
  superset of the F1 placeholder, no other file referenced the old names.
