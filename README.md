# Mini Campaign Manager

A simplified MarTech tool for marketers to create, manage, and track email campaigns.
Take-home assignment — see [`ASSIGNMENT.md`](./ASSIGNMENT.md) for the brief.

> **Status:** F1 scaffold complete (this commit). Auth + Campaign CRUD + Schedule/Send + Frontend pages land in subsequent feature passes (F2 → F4).

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
| CI          | GitHub Actions — install + lint + test                              |

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
| F1   | Monorepo scaffold + dev env (this commit)             | ✅ done |
| F2   | Auth (User model, register/login, JWT middleware)     | next   |
| F3   | Campaigns + Recipients CRUD + state machine           | —      |
| F4   | Schedule + Send (async simulation) + Stats endpoint   | —      |
| F5   | Frontend pages + UX polish (loading/error states)     | —      |
| F6   | Seed script + final README pass + tests round-up      | —      |

Acceptance criteria for each pass live in `.hody/knowledge/spec-*.md`.

---

## How I Used Claude Code

> This section is a non-negotiable part of the assignment grading. The full
> retrospective is filled out at the end of the project (after F5). What's
> below is the **F1-only** account; F2 → F5 will append.

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

### Two real prompts I used

The full prompts are committed in the conversation history but the shapes were:

> **(architect)** "Your job is to lock the root-level architecture artifacts so the BUILD agents can work in parallel without colliding. Write `tsconfig.base.json` + `.eslintrc.cjs` + `.prettierrc` + `.editorconfig` + `.nvmrc` + root `package.json` + `packages/shared` scaffold. **DO NOT scaffold `apps/api/` or `apps/web/`** — those are the next agents' jobs. Pin exact versions, no `latest`. ESLint 9 has flat-config breaking changes — pick 8.x to avoid burning time."

> **(unit-tester)** "Run `yarn install` (the only install in this workflow). Then `yarn lint` → fix iff genuine. Then both workspace tests. Then both builds. **Do NOT install new packages opportunistically.** **Do NOT modify root locked configs** (flag loudly if you must). **Do NOT skip a failing test by editing it to pass trivially — fix the root cause.**"

The pattern that made this work was **negative scope**: explicitly stating what
each agent MUST NOT do is at least as load-bearing as what it should do.
Otherwise the model trends toward "complete" — pulling in F2 work, adding tests
beyond spec, opportunistically refactoring.

### Where Claude Code was wrong / needed correction

- The backend agent initially wrote `jest.config.ts`. That's idiomatic but jest
  needs `ts-node` to load a TS config file — adding a dep just to read a config
  file would be silly. The unit-tester agent caught it during execution and
  converted to `.js`. The right fix isn't adding a dep; it's a one-line file
  rename.
- The frontend agent set `noEmit: true` on `tsconfig.node.json` while also
  declaring `composite: true`. TypeScript rejects this combination (TS6310).
  Caught during `yarn workspace @app/web build`. Fix: switch to
  `emitDeclarationOnly: true` + `outDir`. This is a textbook small TS pitfall
  the model knows in isolation but missed in the larger context — exactly the
  kind of thing a verify-phase agent is for.
- A third issue surfaced from yarn 1's hoisting model: `@testing-library/jest-dom`
  was hoisted to root `node_modules` while `vitest` (its peer) stayed in the
  workspace, and `jest-dom/vitest`'s ESM entry couldn't resolve `vitest`. Cure:
  `"workspaces": { "packages": [...], "nohoist": ["**/@testing-library/jest-dom"] }`.
  This is the kind of thing that's only debuggable by actually running the
  install — emphasizing the value of a separate execute-and-verify step.

### What I would NOT let Claude Code do

- **Decide the schema or business rules without me ratifying first.** The spec
  in `.hody/knowledge/business-rules.md` was written by hand, sourced directly
  from `ASSIGNMENT.md`, and is the contract every agent reads. I do not delegate
  the part where the contract gets defined.
- **Run destructive commands without asking** — e.g. `yarn upgrade --latest`,
  `git reset --hard`, `rm -rf node_modules`. Agents in this workflow are
  scoped to file writes + scoped command execution; destructive ops require
  explicit user approval.
- **Skip tests to ship faster.** Verify-phase agents are instructed in their
  prompts: "Do NOT skip a failing test by editing it to pass trivially. Fix
  the root cause."
- **Pick `latest` for anything.** Pinning is a hard requirement in every
  agent's brief — this is what made `yarn install` reproducible on the first
  try (no version drift across the dep graph).

---

## License

Private — submission for take-home assignment evaluation.
