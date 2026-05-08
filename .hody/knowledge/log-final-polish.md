---
tags: [log, polish, seed, readme]
date: 2026-05-08
author-agent: start-feature
status: completed
---

# Feature Log: F6 — Seed + final README + spec-verify

Type: new-feature (polish)
Started: 2026-05-08
Mode: auto

## Spec
-> spec-final-polish.md

## Agent Work

### backend — F6 seed script

**Summary**

Wrote `apps/api/src/db/seed.ts` — an idempotent demo seed that populates the
dev DB with everything the reviewer needs to log in and see a polished UI in
under five seconds. Added a `seed` script to `apps/api/package.json` so it
runs via `yarn workspace @app/api seed`.

**Files created**

- `apps/api/src/db/seed.ts` — idempotent seeder. Pings the DB, runs umzug
  migrations (no-ops if already applied), upserts the demo user + 15 shared
  recipients, then wipes and re-creates the demo user's 4 campaigns inside
  one transaction.

**Files modified**

- `apps/api/package.json` — added `"seed": "tsx src/db/seed.ts"` next to
  the `migrate` scripts.

**Idempotency strategy**

- **User**: `User.findOrCreate` keyed by `email='demo@example.com'` — the
  demo password hash is computed every run but only inserted on the first
  run. Re-runs reuse the same row + same id.
- **Recipients**: `Recipient.findOrCreate` keyed by email per fixture.
  Recipients are tenant-shared (ADR-012), so the seed must NEVER delete them
  (other tenants' campaigns may reference them in a multi-user demo).
- **Campaigns**: `Campaign.destroy({ where: { createdBy: demoUserId } })`
  followed by re-creation. Cascade on `campaigns -> campaign_recipients`
  clears the CR rows automatically. This makes the seed the source of truth
  for the demo campaign content — easier to evolve than findOrCreate-by-name
  when copy changes.
- **Transaction**: campaign + CR creation runs in one `sequelize.transaction`
  so a failure leaves the demo user's slate clean (post-clear, pre-create).

Re-running the script yields the exact same final state every time:
1 demo user, 15 recipients, 4 campaigns, 23 CR rows.

**Demo content**

- Login: `demo@example.com` / `demo1234`
- 4 campaigns owned by the demo user:
  - **Welcome series — email 1** — `draft`, 5 pending CRs.
  - **Newsletter template** — `draft`, 0 CRs (gives the reviewer a campaign
    they can attach recipients to / delete in the UI).
  - **Spring sale launch** — `scheduled`, 8 pending CRs, `scheduled_at` =
    now + 7 days.
  - **Q4 product update** — `sent`, 10 CRs (8 sent + 2 failed; 5 of the
    sent rows have `opened_at` stamped → open_rate = 62.5%, satisfies the
    spec's "non-zero open rate" requirement).

**Run results**

```
$ yarn workspace @app/api seed   # first run
Seed complete.
  Login:      demo@example.com / demo1234
  Recipients: 15
  Campaigns:  4 (1 draft+5 / 1 draft+0 / 1 scheduled+8 / 1 sent+10)

$ yarn workspace @app/api seed   # second run — no errors, no duplicates
(same output)
```

DB verification (host postgres on `localhost:5432`):

```
users         WHERE email='demo@example.com'  -> 1
recipients                                    -> 15
campaigns     WHERE created_by = demo         -> 4
opened CRs    on 'Q4 product update'          -> 5
```

CR breakdown matches spec exactly: `Welcome series` has 5 pending,
`Spring sale launch` has 8 pending, `Q4 product update` has 8 sent + 2 failed.

**Test compatibility**

`yarn workspace @app/api test` after seeding the dev DB → **78 of 78 pass**
(unchanged from F5). The test DB (`campaign_test`) is a separate database
on the same Postgres instance and the seed never touches it. Tests truncate
their own DB in `tests/helpers` so there's no cross-contamination either way.

**Build / lint status**

- `yarn workspace @app/api build` — clean (`tsc -p tsconfig.json` exits 0).
- `yarn workspace @app/api lint` — clean (1 pre-existing warning in
  `sequelize.ts`, unchanged).

**Known limitations / non-goals**

- No `seed:undo` — out of scope per spec.
- The seed hits whatever `DATABASE_URL` resolves to. The `.env.example`
  default points at `localhost:5432` — in this dev box that resolves to a
  host postgres, not the docker-compose container. The seed itself is
  agnostic; it'll work against whichever Postgres `DATABASE_URL` reaches.

**KB files updated**

- `.hody/knowledge/log-final-polish.md` (this entry).

### frontend — F6 polish nits

**Summary**

Two surgical edits to silence the AntD v5 deprecation warning and tighten the
401 redirect-loop guard. No new files, no behavior change beyond the intent
documented in the F5 code-reviewer findings (LOW items). All build / lint /
test gates remain green; the AntD `destroyOnClose` deprecation warning that
surfaced in the F5 send-flow test output is now gone.

**Files modified**

- `apps/web/src/components/CampaignActions.tsx` (line 213) — Schedule
  `<Modal>` prop renamed.

  *Before:*
  ```tsx
  destroyOnClose
  ```

  *After:*
  ```tsx
  destroyOnHidden
  ```

  Per AntD v5 stable docs, `destroyOnClose` is deprecated; `destroyOnHidden`
  is the supported replacement. No other Modal prop touched.

- `apps/web/src/lib/api.ts` (lines 52–58, response interceptor 401 branch) —
  loop-guard tightened from `startsWith('/login')` to exact equality, and
  extended to also skip `/register`.

  *Before:*
  ```ts
  // Avoid a redirect loop while already on /login.
  if (
    typeof window !== 'undefined' &&
    !window.location.pathname.startsWith('/login')
  ) {
    window.location.href = '/login';
  }
  ```

  *After:*
  ```ts
  // Avoid a redirect loop while already on /login or /register (the two
  // public routes). Use exact equality so paths like `/login-foo` still
  // redirect.
  if (typeof window !== 'undefined') {
    const pathname = window.location.pathname;
    if (pathname !== '/login' && pathname !== '/register') {
      window.location.href = '/login';
    }
  }
  ```

  **Why extend to `/register`:** `/register` is the second public route in
  the F5 routing shell (`apps/web/src/App.tsx`). Without the extension, a
  401 fired during the auto-login leg of the register flow (e.g. token
  rejected for any reason) would hard-redirect the user away from
  `/register` to `/login` mid-form, losing their input. Extending the guard
  matches the symmetry of the two public routes and costs nothing — any
  truly-public endpoint by definition shouldn't trigger 401-driven
  navigation. The `/login-foo`-style false-prefix risk that motivated the
  exact-equality change is also satisfied by `===`.

**Files NOT touched** (out of F6 scope per spec):
- The AntD `<App>` wrapper / `App.useApp().notification` refactor.
- The `extract-error` util consolidation across the 5 pages.
- Any other source under `apps/web/`.

**Build / lint / test status**

- `yarn workspace @app/web build` — clean. tsc -b 0 errors. Vite output
  unchanged at 1.31 MB / 413.43 kB gzip.
- `yarn lint` — 0 errors, 1 pre-existing unrelated warning in
  `apps/api/src/db/sequelize.ts` (carried from F1).
- `yarn workspace @app/web test` — **8/8 pass** across 5 files in ~4.0s.
  Confirmed: the AntD `destroyOnClose` deprecation warning that the F5
  unit-tester noted in the send-flow test output is no longer emitted.

**Tech-debt audit trail**

Marked the two resolved entries in `.hody/knowledge/tech-debt.md` with a
`RESOLVED IN F6` annotation (kept entries in place — not deleted — for the
audit trail). The F5 MEDIUM (`<App>` wrapper) and the per-page error-helper
LOW remain `active` per spec out-of-scope decision.

**KB files updated**

- `.hody/knowledge/log-final-polish.md` (this entry).
- `.hody/knowledge/tech-debt.md` (RESOLVED-IN-F6 annotations on the two
  shipped fixes).

### spec-verifier — F6 final audit

**Summary**

Walked every line of `ASSIGNMENT.md` (Part 1 backend, Part 2 frontend, Part 3
AI showcase, Evaluation criteria, Submission instructions) against the
codebase. Result published to `.hody/knowledge/submission-checklist.md`.

**Counts**

- Total items audited: **64**
- ✅ Met: **56**
- ⚠️ Partial: **8** — all are README/finalize-step deferrals already
  enumerated in `spec-final-polish.md` and explicitly out-of-scope for the
  backend + frontend work that has shipped. No code-level gaps.
- ❌ Unmet: **0**
- Final test count: **78 backend + 8 frontend = 86 total** (verified by
  re-running `yarn workspace @app/api test` and `yarn workspace @app/web test`
  during the audit).

**1-line summary per ⚠️**

1. README "How I Used Claude Code" — F1+F2 retrospective only; needs F3+F4+F5
   sections (deferred to finalize step per spec line 43).
2. README CI status badge — not yet present (deferred to finalize step per
   spec line 41).
3. README "Known limitations" section — not yet present (deferred per spec
   line 44).
4. README architecture overview diagram — not yet present (deferred per spec
   line 45).
5. README submission walkthrough summary at the top — not yet present
   (deferred per spec line 46).
6. README quick-start should reference `yarn workspace @app/api seed` —
   the seed exists and works idempotently; just needs a 1-line callout.
7. README should call out the `POST /recipient` (singular brief) →
   `POST /recipients` (plural shipped) deviation — already documented in
   `api-contracts.md:131-132` and `decisions.md` ADR-012, just needs surface
   in the README so the reviewer sees it without reading the KB.
8. `POST /recipients` deviation — same item viewed from the deviation
   register; collapses with #7.

**Top 3 PRAISE items**

- Atomic SQL state-machine guards in `apps/api/src/campaigns/service.ts:357-417`
  (`ATOMIC_SCHEDULE_SQL`, `ATOMIC_SEND_SQL`, `ATOMIC_OPEN_TRACK_SQL`) —
  closes the find-then-update race by making the state guard a SQL-level
  invariant. Three constants, each with `WHERE status IN (...)` clauses;
  worth highlighting in any README walkthrough.
- DB-backed test suite (no mocked SQL) covering tenancy 404 (no existence
  leak), constant-time-ish login, JWT algorithm pinning, atomic worker
  race-freeness, idempotent open-tracking. 86 tests, ~12s on the api side.
- The `.hody/` folder itself — 6 feature-pass workflows, 12 ADRs, tech-debt
  ledger, spec→build→verify gates per pass. This is the AI-collaboration
  audit trail and is the strongest single answer to the "judgment +
  transparency" evaluation criterion.

**Files NOT touched**

- No source code, tests, or specs modified during this audit. Only created
  `.hody/knowledge/submission-checklist.md` and updated this log.

**KB files updated**

- `.hody/knowledge/submission-checklist.md` (created).
- `.hody/knowledge/log-final-polish.md` (this entry).
