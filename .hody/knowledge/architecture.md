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
