---
tags: [spec, new-feature, scaffold, devops, monorepo]
date: 2026-05-06
author-agent: start-feature
status: implemented
---

# Spec: F1 — Scaffold & Dev Environment

**Type:** new-feature (initial scaffold)
**Priority:** high (blocks all subsequent features)
**Time budget within F1:** ~1 hour

## Summary

Stand up the empty monorepo skeleton: yarn workspaces with `apps/api`
(Express + TS + Sequelize), `apps/web` (Vite + React + TS + Ant Design),
`packages/shared` (shared TS types), `docker-compose.yml` for Postgres,
shared lint/format config, and one smoke test per app. **No business logic,
no auth, no models** — only "everything turns on" with `docker compose up`
+ `yarn dev`.

## Requirements

1. `yarn install` succeeds at the repo root, hoists into all workspaces.
2. `docker compose up -d` brings up Postgres on `localhost:5432`.
3. `yarn workspace @app/api dev` starts Express on `:4000` with `GET /health → 200 {ok:true}`.
4. `yarn workspace @app/web dev` starts Vite on `:5173`, page renders an Ant Design `<Result>` with "Mini Campaign Manager" title.
5. `yarn workspace @app/api test` runs ≥1 supertest hitting `/health`.
6. `yarn workspace @app/web test` runs ≥1 vitest rendering `<App />`.
7. `yarn lint` runs eslint on all workspaces and exits 0 on a clean tree.
8. `.env.example` exists in `apps/api/`; `apps/api/.env` is gitignored.
9. README at root explains: prerequisites → `docker compose up -d` → `yarn install` → `yarn dev`.

## Technical Design

### Monorepo layout

```
mini-campaign-manager/
├── apps/
│   ├── api/                      # Express backend
│   │   ├── src/
│   │   │   ├── index.ts          # bootstrap + listen
│   │   │   ├── app.ts            # express() factory (testable)
│   │   │   ├── config/
│   │   │   │   └── env.ts        # zod-parsed env loader
│   │   │   └── routes/
│   │   │       └── health.ts
│   │   ├── tests/
│   │   │   └── health.test.ts    # supertest smoke
│   │   ├── .env.example
│   │   ├── jest.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── web/                      # React + Vite frontend
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   └── App.test.tsx      # vitest smoke
│       ├── index.html
│       ├── vite.config.ts        # also wires vitest
│       ├── tsconfig.json
│       └── package.json
├── packages/
│   └── shared/                   # @app/shared — shared types/DTOs
│       ├── src/index.ts          # placeholder export
│       ├── tsconfig.json
│       └── package.json
├── .github/workflows/
│   └── ci.yml                    # install + lint + test on PR
├── docker-compose.yml            # postgres 16 only (F1)
├── .editorconfig
├── .eslintrc.cjs                 # shared base config
├── .prettierrc
├── .nvmrc                        # "20"
├── .gitignore                    # already exists, extend if needed
├── tsconfig.base.json            # extends across workspaces
├── package.json                  # workspaces root
├── yarn.lock                     # generated
└── README.md                     # rewritten
```

### Locked tech decisions (made by AI per user delegation)

| Area | Decision | Rationale |
|---|---|---|
| Package manager | **yarn 1.22 (classic)** | Workspaces first-class via `"workspaces"` field, no `.yarnrc.yml` complexity, matches confirmed local version |
| Node | **20 LTS** (`.nvmrc=20`, `engines.node=">=20"`) | Current LTS, supports `--env-file` natively |
| Backend dev runner | **`tsx watch`** | Fast esbuild-based, single dep, no `ts-node-dev` legacy |
| Backend build | **`tsc`** to `dist/` | Standard, deterministic |
| Express version | **4.x** | Stable; Express 5 still beta-ish |
| ORM | Sequelize **6** + `sequelize-cli` | Per ASSIGNMENT.md (locked) |
| Validation | **zod** | TS-first, derive types from schemas (per ADR-001) |
| Env loading | **`dotenv` + zod parse at boot** | Fail fast on missing/invalid env |
| Frontend bundler | **Vite 5** + React 18 + TS | Per ASSIGNMENT.md |
| UI kit | **Ant Design v5** | User has prior pattern (CV: EMDDI Admin) — fastest path to polished UX |
| Data fetch | `@tanstack/react-query` v5 | Per ASSIGNMENT.md |
| Client state | `zustand` v4 | Per ASSIGNMENT.md |
| HTTP client | `axios` | Standard interceptor pattern for JWT injection later |
| Routing | `react-router-dom` v6 | De facto |
| API tests | **jest 29 + supertest 6 + ts-jest** | Mature, fast |
| Web tests | **vitest + @testing-library/react + jsdom** | Vite-native, no separate config |
| Lint | **eslint 8 + @typescript-eslint + eslint-config-prettier** | Standard |
| Format | **prettier 3** | Standard |
| Husky / lint-staged | **NOT installed** | Out of time budget; trust CI instead |
| Postgres | **postgres:16-alpine** in docker-compose | Latest stable, small image |
| Redis | **deferred to F3** if BullMQ adopted | Don't over-engineer F1 |
| CI | minimal `.github/workflows/ci.yml` (install + lint + test, ubuntu-latest, node 20) | Demonstrates craftsmanship without bloat |

### Root `package.json` shape (planned)

```json
{
  "name": "mini-campaign-manager",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "engines": { "node": ">=20" },
  "scripts": {
    "dev":        "yarn workspaces run dev",
    "build":      "yarn workspaces run build",
    "test":       "yarn workspaces run test",
    "lint":       "eslint . --ext .ts,.tsx",
    "format":     "prettier --write .",
    "db:up":      "docker compose up -d",
    "db:down":    "docker compose down"
  },
  "devDependencies": { "eslint", "prettier", "typescript", "@typescript-eslint/*" }
}
```

### docker-compose.yml shape (planned)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: campaign
      POSTGRES_PASSWORD: campaign
      POSTGRES_DB: campaign
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "campaign"]
      interval: 5s
      retries: 5
volumes:
  pgdata:
```

### Smoke tests (acceptance criteria)

- **apps/api**: supertest hits `GET /health` → expect status 200 and `{ ok: true }`.
- **apps/web**: vitest renders `<App />` and asserts text "Mini Campaign Manager" present.

## Out of Scope

- Auth (User model, register/login, JWT middleware) → **F2**
- Campaigns, Recipients, CampaignRecipient models → **F2**
- Sequelize models, migrations, seeds → **F2** (only install deps in F1)
- Schedule/send/stats endpoints → **F3**
- All frontend pages beyond a placeholder home → **F4**
- Husky pre-commit hooks
- Redis / BullMQ
- Production Dockerfile for the api/web (only postgres in compose)

## Agent Workflow

```
THINK:  architect          (lock root configs, justify deviations from spec if any)
BUILD:  backend + frontend (parallel — apps/api and apps/web scaffolds)
        devops             (docker-compose, env files, CI workflow, root scripts)
VERIFY: unit-tester        (smoke tests pass for both apps)
        code-reviewer      (final sanity sweep)
```

**Agents:** 5 total (architect, backend, frontend, devops, unit-tester, code-reviewer = 6, but backend/frontend run concurrently → 5 sequential steps).

## Definition of Done

- [ ] Fresh clone → `nvm use && docker compose up -d && yarn install && yarn dev` works without manual edits
- [ ] `yarn test` exits 0 across both apps
- [ ] `yarn lint` exits 0
- [ ] CI workflow exists and would pass on the same checks
- [ ] README has a "Quick start" section
- [ ] No secrets committed; `.env.example` documents required vars
