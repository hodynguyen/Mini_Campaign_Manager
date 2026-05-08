---
tags: [spec, ui-change, frontend, react, antd]
date: 2026-05-08
author-agent: start-feature
status: implemented
---

# Spec: F5 — Frontend pages + UX polish

**Type:** ui-change
**Priority:** high (last user-visible feature; F6 is polish only)
**Time budget within F5:** ~2 hours

## Summary

Build the four pages from `ASSIGNMENT.md` Part 2 — `/login`, `/campaigns`,
`/campaigns/new`, `/campaigns/:id` — wired to the F2-F4 backend via React
Query, with auth state in zustand, JWT injected into axios via interceptor,
and Ant Design v5 for visual polish. Loading skeletons, error Alerts,
and conditional action buttons per the assignment's UI requirements.

## Requirements

### Pages

1. **`/login`** — `Form` with email + password; on submit calls `POST /auth/login`, stores `{ token, user }` in zustand, redirects to `/campaigns`. On 401 → show inline error. Includes a "create account" link → `/register`.
2. **`/register`** *(implicit — assignment doesn't list it but `/login` needs it for first-time users)*. Same form pattern; on success redirects to `/login` (or auto-logs in — pick one). Recommend auto-login: register → login → redirect.
3. **`/campaigns`** — list with status badges (color-coded), pagination (default 20/page), "Create campaign" button. Empty state: friendly empty illustration via AntD `Empty`.
4. **`/campaigns/new`** — form (name, subject, body, recipient_emails as comma-separated input → split client-side). On success redirects to `/campaigns/:id`.
5. **`/campaigns/:id`** — detail with:
   - Header: name, status badge, subject, created_at, scheduled_at (if any).
   - **Stats block**: AntD `Progress` for send_rate + open_rate (computed values), 4 `Statistic` widgets (total, sent, failed, opened).
   - **Recipients table**: email, name, status, sent_at, opened_at. Sortable. AntD `Table`.
   - **Action buttons**: conditional on status:
     - `draft` → `Schedule`, `Send`, `Delete`, `Edit (TBD F6)` *(or just disable Edit)*.
     - `scheduled` → `Send`, `Cancel scheduled (TBD)`.
     - `sending` → polling indicator ("sending..."), no actions.
     - `sent` → just stats, no actions.

### UX requirements (from spec)

- Status badge colors: `draft = default/grey`, `scheduled = processing/blue`, `sending = warning/orange`, `sent = success/green`.
- Loading: AntD `Skeleton` placeholders during initial fetch; inline spinners on mutations.
- Errors: AntD `Alert` (or `notification.error`) with `error.code` translated to a user-readable message. **Pattern-match `error.code`, never `error.message`** — backend codes are stable; messages may not be.
- Forms: client-side validation matching server zod (length limits etc.), surface server-side errors inline.

### Tech requirements

- React 18 + TS + Vite + Ant Design 5 + react-query 5 + zustand 4 + axios + react-router 6 (all already installed F1).
- **Axios interceptor** in `apps/web/src/lib/api.ts`: read token from zustand store, inject `Authorization: Bearer <token>`. Logout on 401 (clear store + redirect /login).
- **Protected route wrapper** component: redirects to `/login` if no token.
- **react-query setup**: existing `queryClient.ts` already has good defaults. Add `onError` for 401 → logout.
- **Polling** on detail page when status='sending': `refetchInterval: 1500` until status !== 'sending', then stop.

### File map (apps/web delta)

```
apps/web/src/
├── App.tsx                     # routes: /login, /register, protected /campaigns/*
├── lib/
│   ├── api.ts                  # axios instance + JWT interceptor + 401 handler
│   └── queryClient.ts          # tighten error handling
├── store/
│   └── auth.ts                 # zustand: { token, user, login, logout }
├── pages/
│   ├── LoginPage.tsx
│   ├── RegisterPage.tsx
│   ├── CampaignsListPage.tsx
│   ├── CampaignNewPage.tsx
│   └── CampaignDetailPage.tsx
├── components/
│   ├── ProtectedRoute.tsx
│   ├── StatusBadge.tsx         # AntD Tag with color map
│   ├── StatsBlock.tsx          # Progress + 4 Statistics
│   ├── RecipientsTable.tsx
│   ├── CampaignActions.tsx     # conditional buttons
│   └── ErrorAlert.tsx          # err.code → user message map
├── hooks/
│   ├── useCampaigns.ts         # list + create + get + update + delete + schedule + send + trackOpen
│   └── useAuth.ts              # login + register + logout
└── types/
    └── api-error.ts            # ApiError type from @app/shared
```

### `packages/shared` delta

None — F2-F4 already added all DTOs.

### Locked tech decisions (auto-confirmed)

| Area | Decision | Rationale |
|---|---|---|
| Auth storage | **In-memory zustand (lost on refresh)** | ADR-003 — accept the UX papercut; assignment scope. |
| Form lib | **AntD `Form`** | Built-in validation + integration with Form.Item rules. No need for react-hook-form. |
| Routing | **react-router v6** with declarative `<Routes>` | Already installed. |
| Send polling | **react-query `refetchInterval` conditionally** | When status='sending', poll 1500ms; stop when sent/draft/scheduled. |
| Stats display | **AntD `Progress` for rates, `Statistic` for counts** | Visual + accessible defaults. |
| Recipient emails input | **`Input.TextArea` with comma/newline split** | Simple. F6 could enhance to `Tag` chips. |
| Error code map | **Switch on `error.code`** with fallback to `error.message` | Stable contract. |
| 401 handler | **Logout + redirect to /login** | Auto-recover from token expiry. |

### Tests (vitest + RTL)

≥4 component tests covering critical UX:
- `StatusBadge` renders correct color per status.
- `LoginPage` happy: type creds → submit → mock axios → assert navigation.
- `LoginPage` 401: mock 401 → assert error Alert visible.
- `CampaignDetailPage` send flow: mock GET → click Send → mock 202 → poll → assert "sending" → mock GET status='sent' → assert stats block.

Use `@testing-library/react` + msw or simple axios mocks. **Use msw if not too time-consuming**; otherwise vi.mock the api module directly.

## Out of Scope

- Edit campaign UI (PATCH from frontend) — F6 if time.
- Cancel scheduled / cancel sending UI.
- Recipient management page (list/create/edit recipients standalone). F6 if time.
- E2E tests (Playwright).
- i18n (English-only).
- Dark mode.
- Mobile-first responsive design (assignment doesn't require it; AntD defaults work).

## Agent Workflow

```
THINK:  architect            (component tree, hooks shape, error code map, polling pattern)
BUILD:  frontend             (all 5 pages + components + hooks + interceptor + routes)
VERIFY: unit-tester          (≥4 vitest component tests)
        code-reviewer        (a11y baseline, error UX, race conditions on polling, security: token leak)
```

**Agents:** 4. No SHIP.

## Definition of Done

- [ ] `yarn workspace @app/web build` clean (tsc + vite)
- [ ] `yarn workspace @app/web test` ≥4 component tests pass
- [ ] `yarn workspace @app/web dev` boots, can register a user, log in, create a campaign, schedule it, send it, watch status flip to sent, see stats > 0 (with seed-stamped opens)
- [ ] All 4 status badges render with correct colors
- [ ] Action buttons appear ONLY when status allows (Schedule/Send/Delete on draft, Send on scheduled, none on sent)
- [ ] Loading skeletons during initial fetch, no white flash
- [ ] Errors surfaced via Alert/notification, mapped by `error.code` to readable text
- [ ] 401 anywhere triggers logout + redirect to /login
- [ ] `yarn lint` clean across the web workspace
- [ ] README "Quick start" section captures the F5 demo flow
