---
tags: [spec, polish, seed, readme, spec-verify]
date: 2026-05-08
author-agent: start-feature
status: implemented
---

# Spec: F6 — Seed + final README + spec-verify

**Type:** new-feature (light — polish only)
**Priority:** high (assignment submission gating)
**Time budget within F6:** ~1 hour

## Summary

The submission round-up: a deterministic seed script for a polished demo,
final "How I Used Claude Code" retrospective in the README covering all 5
feature passes, address quick UX nits flagged by F5 code-reviewer, and a
final pass that verifies every requirement in `ASSIGNMENT.md` is satisfied.

## Requirements

1. **Seed script** at `apps/api/src/db/seed.ts` (run via `yarn workspace @app/api seed`):
   - Creates demo user `demo@example.com` / `demo1234` (idempotent — uses upsert by email).
   - Creates ~15 recipients with realistic-ish names + emails.
   - Creates 4 sample campaigns owned by the demo user, one in each state:
     - 1 `draft` (no recipients yet, just template content for the marketer to add later) — actually, for richer demo, attach 5 recipients in pending.
     - 1 `scheduled` for 7 days from now, 8 recipients.
     - 1 `sent` already, 10 recipients with realistic stats: 8 sent + 2 failed, 5 of the sent rows have `opened_at` stamped → produces non-zero open_rate.
     - 1 additional `draft` to test PATCH/DELETE flow in the UI.
   - Idempotent — re-running doesn't double-create.
   - Document in README quick-start.

2. **Address F5 MEDIUM/LOW carry-forward** (cheap fixes only):
   - `apps/web/src/components/CampaignActions.tsx`: rename `destroyOnClose` → `destroyOnHidden` (AntD v5 deprecation).
   - `apps/web/src/lib/api.ts`: change 401 loop-guard from `startsWith('/login')` to `=== '/login'`.
   - **Skip** the `App.useApp().notification` refactor (more invasive — log as known limitation).
   - **Skip** the extract-error util refactor (touches 5 files for a small DRY win).

3. **README final pass:**
   - Add CI status badge (`![CI](https://github.com/hodynguyen/Mini_Campaign_Manager/actions/workflows/ci.yml/badge.svg)`).
   - Full demo walkthrough: seed → boot → register/login → see seeded campaigns → click sent campaign to see stats → create new → schedule → send → watch sending → see sent.
   - Final "How I Used Claude Code" with F1-F5 retrospective consolidated (the F1+F2 content stays; add F3, F4, F5 sections in same parallel structure).
   - "Known limitations" section covering: in-memory JWT (logout on refresh), no rate-limiting, in-process worker (jobs lost on crash), 24h JWT no refresh.
   - Architecture overview: a small ASCII or Mermaid diagram pointing to the key directories.
   - Submission walkthrough summary at the very top.

4. **spec-verifier final audit:**
   - Walk through ASSIGNMENT.md Part 1 (backend), Part 2 (frontend), Part 3 (AI section), Evaluation criteria, Submission instructions.
   - For each line item, produce a ✅/⚠️/❌ + 1-line evidence (file path or commit).
   - Result published to `.hody/knowledge/submission-checklist.md`.

5. **Final test count:** 78 backend + ≥8 frontend = ≥86. Confirm via `yarn test` at root.

## File map

```
apps/api/
└── src/db/
    └── seed.ts              # NEW — idempotent seed via raw Sequelize calls
apps/api/package.json        # add `seed` script
apps/web/src/
├── components/CampaignActions.tsx   # destroyOnClose → destroyOnHidden
└── lib/api.ts               # loop-guard fix
README.md                    # final pass with CI badge, full retrospective, demo flow
.hody/knowledge/
└── submission-checklist.md  # NEW — spec-verifier output
```

## Out of Scope (intentional)

- Adding new endpoints / models / pages.
- Refactoring extract-error util.
- AntD `<App>` wrapper for notification theming.
- E2E tests (Playwright).
- Production deploy / Dockerfile for api/web.

## Agent Workflow

```
THINK:  (skip — spec is concrete enough)
BUILD:  backend              (seed script + apps/api/package.json script entry)
        frontend             (2 small nits: destroyOnClose + loop-guard)
VERIFY: spec-verifier        (walks ASSIGNMENT.md → submission-checklist.md)
SHIP:   (handled by finalize step — not a separate agent)
```

**Agents:** 3 (backend → frontend → spec-verifier). Plus my own finalize.

## Definition of Done

- [ ] `yarn workspace @app/api seed` creates demo user + 4 campaigns + 15 recipients idempotently
- [ ] Seed re-runs without duplicates (confirmed by running twice)
- [ ] Frontend UI shows seeded campaigns after login as `demo@example.com / demo1234`
- [ ] At least one `sent` campaign in seed has `open_rate > 0`
- [ ] AntD `destroyOnClose` deprecation gone
- [ ] 401 loop-guard fixed
- [ ] CI badge in README
- [ ] Full "How I Used Claude Code" retrospective (F1-F5)
- [ ] Known limitations section
- [ ] `submission-checklist.md` ✅ on every ASSIGNMENT.md requirement OR explains the ⚠️
- [ ] All tests still pass (≥86 total)
- [ ] `yarn lint` clean
- [ ] Final commit + push
