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
