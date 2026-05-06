---
tags: [runbook, operations, dev]
created: 2026-05-06
author_agent: human
status: planned
---

# Runbook

> **Status:** Planned commands. None of these scripts exist yet — they will be
> wired up during scaffolding. This doc is the target shape so devops/setup
> work can converge here.

## Local Development (target)

```bash
# 1. Boot infra
docker compose up -d        # postgres (and redis if BullMQ adopted)

# 2. Install deps (yarn workspaces)
yarn install

# 3. Run migrations + seed
yarn workspace @app/api db:migrate
yarn workspace @app/api db:seed       # creates demo user + campaigns + recipients

# 4. Start backend (port 4000)
yarn workspace @app/api dev

# 5. Start frontend (port 5173)
yarn workspace @app/web dev
```

Demo account from seed:
- email: `demo@example.com`
- password: `demo1234`

## Common dev commands (target)

| Command                                  | What it does                          |
|------------------------------------------|---------------------------------------|
| `yarn workspace @app/api test`           | Run jest + supertest                  |
| `yarn workspace @app/api db:migrate`     | Apply Sequelize migrations            |
| `yarn workspace @app/api db:migrate:undo`| Roll back last migration              |
| `yarn workspace @app/api db:seed`        | Run seed (idempotent)                 |
| `yarn workspace @app/web build`          | Production frontend build             |
| `yarn lint`                              | Lint all workspaces                   |

## Environment variables (target)

`apps/api/.env`:
```
DATABASE_URL=postgres://campaign:campaign@localhost:5432/campaign
JWT_SECRET=change-me-in-prod
PORT=4000
NODE_ENV=development
```

`apps/web/.env`:
```
VITE_API_BASE_URL=http://localhost:4000
```

## Deployment

Out of scope for the assignment — the brief only requires local `docker compose up`.

## Common Issues (anticipated)

- **Port conflicts:** 4000 (api), 5173 (vite), 5432 (postgres). Override via env if needed.
- **Sequelize migration drift:** always run `db:migrate` after pulling — never edit a committed migration; create a new one.
- **JWT decode fails after restart:** in-memory token store loses on refresh by design (see ADR-003).

## Monitoring & Alerts

N/A — assignment scope.
