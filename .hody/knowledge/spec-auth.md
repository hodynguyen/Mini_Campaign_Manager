---
tags: [spec, api-endpoint, auth, security]
date: 2026-05-06
author-agent: start-feature
status: implemented
---

# Spec: F2 — Auth (User model, register, login, JWT middleware)

**Type:** api-endpoint
**Priority:** high (blocks F3 campaigns/recipients which require `requireAuth`)
**Time budget within F2:** ~1.5 hours

## Summary

Wire the database, ship the User model + first migration, expose
`POST /auth/register` + `POST /auth/login`, and provide a `requireAuth`
JWT middleware that subsequent feature passes will mount on protected
routes. Tighten the API's error handling and CORS while we're here.

## Requirements

1. Sequelize bootstraps from `DATABASE_URL`; the API fails fast on bad
   connection (`sequelize.authenticate()` at boot).
2. **Migration #1** creates the `users` table per ASSIGNMENT.md schema
   (`id`, `email`, `name`, `created_at`) plus `password_hash`,
   `updated_at`. Sequelize-cli migration tooling installed and wired.
3. **`POST /auth/register`** — body `{ email, name, password }`, validates
   via zod, hashes password via bcrypt, inserts, returns `User` (no token,
   no password_hash). 201 on success, 400 invalid, 409 email taken.
4. **`POST /auth/login`** — body `{ email, password }`, verifies, returns
   `{ token, user }` (JWT HS256, 24h expiry). 200 on success, 401 on bad
   credentials (do NOT leak which of email/password was wrong).
5. **`requireAuth(req, res, next)`** middleware — reads
   `Authorization: Bearer <jwt>`, verifies, attaches `req.user = { id, email }`.
   401 on missing/invalid/expired token. **Not mounted on any routes in F2**;
   F3 will use it.
6. Typed global error handler: `ZodError` → 400 with structured field errors,
   `UniqueConstraintError` → 409, `JsonWebTokenError`/`TokenExpiredError` →
   401, anything else → 500 with generic message (do NOT leak stack traces).
7. CORS locked to env-driven allowlist (default: `http://localhost:5173`).
8. `GET /health` extended to ping the DB (`SELECT 1`); returns
   `{ ok: true, db: 'up' }` or 503 with `{ ok: false, db: 'down' }`.
9. **≥5 meaningful integration tests** covering: register happy, register
   duplicate email, register invalid input, login happy, login wrong
   password, middleware reject-missing-token, middleware reject-bad-token.
10. CI extended with a Postgres service container so tests run in GitHub
    Actions.

## Technical Design

### Data model

```sql
-- migration 0001-create-users.{ts|sql}
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT NOT NULL UNIQUE,                -- case-insensitive
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- pg extension prerequisite — enable in same migration
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for gen_random_uuid()
```

Index notes:
- Unique constraint on `email` already gives an index — explain in code-review.
- No additional index needed on `users` for F1/F2 access patterns.

### File map (apps/api delta)

```
apps/api/
├── src/
│   ├── db/
│   │   ├── sequelize.ts       # singleton Sequelize instance from env.DATABASE_URL
│   │   └── models/
│   │       └── User.ts        # Sequelize model + associations placeholder
│   ├── auth/
│   │   ├── routes.ts          # POST /register, POST /login
│   │   ├── controller.ts      # request handlers
│   │   ├── service.ts         # business logic: hashPassword, verifyPassword, createUser, signToken
│   │   └── middleware.ts      # requireAuth
│   ├── errors/
│   │   ├── AppError.ts        # base class
│   │   └── handler.ts         # global Express error handler
│   ├── schemas/
│   │   └── auth.schema.ts     # zod schemas: registerSchema, loginSchema
│   ├── routes/
│   │   └── health.ts          # extended with DB ping
│   ├── app.ts                 # mount /auth + global handler + CORS allowlist
│   └── config/env.ts          # add JWT_SECRET, JWT_EXPIRES_IN, CORS_ORIGINS
├── migrations/
│   └── 0001-create-users.ts   # sequelize-cli umzug-style TS migration
├── .sequelizerc               # tell sequelize-cli where migrations live
└── tests/
    ├── helpers/
    │   ├── db.ts              # truncate-all helper for afterEach
    │   └── server.ts          # boot createApp() + sequelize for tests
    ├── auth.register.test.ts
    ├── auth.login.test.ts
    └── auth.middleware.test.ts
```

### `packages/shared` delta

```ts
// packages/shared/src/index.ts — F2 adds:
export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;  // ISO 8601
}

export interface RegisterRequest {
  email: string;
  name: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}
```

Type-only exports — no runtime code, so it works under both ESM (web) and
CJS (api) without ceremony.

### Locked tech decisions

| Area | Decision | Rationale |
|---|---|---|
| Password hashing | **bcrypt cost 10** | Cost 12 doubles every hash; 10 is the OWASP "default for typical apps". Document in ADR-008. |
| JWT signing | **HS256**, 24h expiry, payload `{ sub: userId, email }` | HS256 = single-service, no key distribution. 24h fits assignment without refresh-token complexity. |
| `JWT_SECRET` | Env var, ≥32 chars in non-dev — schema enforces in zod env loader | Fail-fast on weak secret. |
| Migrations | **sequelize-cli** with TS migrations + `.sequelizerc` | Spec says "SQL files or knex migrations" — sequelize-cli is the Sequelize-native equivalent. |
| Validation | **zod** schemas; `safeParse` in handlers | Keeps controllers thin, schema is the source of truth for both validation AND TS types via `z.infer`. |
| Test DB strategy | Separate `DATABASE_URL_TEST` env, truncate all tables in `afterEach`, run migrations once in global setup | Real DB, not mocks (per JD craftsmanship signal — and Sequelize raw SQL behavior differs from mocks). |
| CORS | **`cors-origins` env (CSV)** | Default `http://localhost:5173` for dev. Multiple origins supported for staging/prod. |
| Error response shape | `{ error: { code, message, details? } }` | Matches `ApiError` in shared. Codes are SCREAMING_SNAKE strings (e.g. `EMAIL_TAKEN`, `INVALID_CREDENTIALS`). |
| User model — soft delete? | **No** | Out of scope for assignment. |
| Refresh tokens? | **No** | 24h JWT, re-login on expiry. Documented limitation. |

### Key business rules to enforce

- Email lowercased & trimmed before hash/lookup (CITEXT type also handles
  case-insensitivity, but normalize input too for safety in non-Postgres
  test contexts).
- `name` 1–80 chars after trim.
- `password` 8–72 chars (bcrypt's 72-byte hard limit).
- Login does NOT distinguish between "no such email" and "wrong password" —
  both return 401 `INVALID_CREDENTIALS`. Prevents enumeration.

## Out of Scope

- Email verification flow.
- Password reset / forgot password.
- OAuth providers.
- Login attempt rate limiting (could note as MEDIUM tech debt).
- Refresh tokens / token revocation.
- Login/logout audit logging.
- Frontend login page → F4.
- `/users/me` endpoint (not in brief; add iff F3 needs it).

## Agent Workflow

```
THINK:  architect            (lock concrete file structure, migration tool wiring, cors strategy)
BUILD:  backend              (User model, /auth routes, middleware, error handler, migration, packages/shared types, CORS lock, /health DB ping)
VERIFY: integration-tester   (≥5 tests against real DB; install pg-mem OR use the docker postgres)
        code-reviewer        (security review: bcrypt cost, JWT secret handling, error leaks, SQL injection surface, timing attack on login)
SHIP:   devops               (extend ci.yml with postgres service + DATABASE_URL_TEST)
```

**Agents:** 5 total (architect → backend → integration-tester → code-reviewer → devops).

Note: I'm bumping devops into SHIP for this feature because the CI change
is a deployment/infra change, not part of the feature build. devops runs
LAST so the test DB workflow is wired only after the tests it serves
actually exist.

## Definition of Done

- [ ] `yarn workspace @app/api migrate` runs the User migration cleanly
- [ ] `yarn workspace @app/api test` passes ≥5 tests, all hitting the real DB
- [ ] `curl -X POST localhost:4000/auth/register -d '{...}'` returns 201 with user (no password_hash)
- [ ] `curl -X POST localhost:4000/auth/login` returns 200 with `{ token, user }`
- [ ] Hitting a fake protected route with no/bad token via `requireAuth` returns 401
- [ ] `yarn lint` exits 0
- [ ] CI runs DB-backed tests successfully (postgres service container in workflow)
- [ ] No secrets in committed code; `JWT_SECRET` in `.env.example` is `change-me-please-use-32-chars-min`
- [ ] `packages/shared` exports the new types; `apps/api` consumes them
- [ ] decisions.md updated with ADR-008 (bcrypt cost) and ADR-009 (JWT shape/expiry)
