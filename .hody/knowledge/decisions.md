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

- **Date**: 2026-05-06
- **Status**: proposed (architect to confirm)
- **Context**: `POST /campaigns/:id/send` must be **asynchronous** per brief.
  Two reasonable approaches given a 4–8h budget.
- **Decision (proposed):** Use in-process background work via `setImmediate` +
  promise chain. Endpoint responds 202 Accepted immediately; worker writes
  CampaignRecipient rows and flips Campaign.status=sent when done.
- **Alternatives:**
  - **BullMQ + Redis**: production-grade, "nice-to-have" per JD. Adds Redis to
    docker-compose. Worth it only if remaining time allows.
- **Consequences:**
  - Simpler infra (postgres only).
  - Loses jobs if process crashes mid-send — acceptable for assignment but
    must be called out in README.
  - Easy to swap to BullMQ later — encapsulate in a `sender.service.ts` interface.

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
