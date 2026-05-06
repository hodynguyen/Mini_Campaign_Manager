# Mini Campaign Manager — Assignment Brief

## Overview

Build a **full-stack Mini Campaign Manager** — a simplified MarTech tool that lets marketers create, manage, and track email campaigns.

- **Time estimate:** 4–8 hours
- **Deliverable:** Public GitHub repository link and written walkthrough
- **AI usage:** You are encouraged to use Claude Code (or similar). We will evaluate *how* you use it.

---

## Part 1 — Backend (Node.js + PostgreSQL)

### 1) Schema design

These are mandatory tables, should allow the creation of more tables if necessary:

- **User** — id, email, name, created_at
- **Campaign** — id, name, subject, body (text), status (`draft` | `sending` | `scheduled` | `sent`), scheduled_at, created_by (FK → User), created_at, updated_at
- **Recipient** — id, email, name, created_at
- **CampaignRecipient** — campaign_id, recipient_id, sent_at (nullable), opened_at (nullable), status (`pending` | `sent` | `failed`)

**Indexing:** Include indexes you believe are necessary. Be ready to explain why.

### 2) API endpoints (REST)

Build a REST API with these endpoints:

- `POST /auth/register` — Register a new user
- `POST /auth/login` — Login, return JWT
- `GET /campaigns` — List campaigns (auth required)
- `POST /campaigns` — Create campaign (auth required)
- `GET /recipients` — Get Recipients (auth required)
- `POST /recipient` — Create recipient (auth required)
- `GET /campaigns/:id` — Campaign details + recipient stats (auth required)
- `PATCH /campaigns/:id` — Update campaign (**only if status is `draft`**)
- `DELETE /campaigns/:id` — Delete a **draft** campaign
- `POST /campaigns/:id/schedule` — Schedule a campaign (set `scheduled_at`)
- `POST /campaigns/:id/send` — Simulate asynchronous sending process, recipient can be marked as `sent` or `failed` randomly

### 3) Business rules (enforce server-side)

- A campaign can only be edited or deleted when status is `draft`.
- `scheduled_at` must be a **future** timestamp.
- Sending transitions status to `sent` and cannot be undone.
- `/stats` should return:

```json
{ "total": 0, "sent": 0, "failed": 0, "opened": 0, "open_rate": 0, "send_rate": 0 }
```

### 4) Tech requirements

- Node.js with Express
- PostgreSQL with Sequelize
- JWT authentication middleware
- Input validation (zod or joi)
- Migrations (SQL files or knex migrations)
- At least **3 meaningful tests** for critical business logic (unit or integration)

---

## Part 2 — Frontend (React + TypeScript)

Build a simple but functional UI.

Both backend and frontend should be in the same monorepo, using yarn workspace.

### Pages

- `/login` — Login form, store JWT in memory or httpOnly cookie
- `/campaigns` — List campaigns with status badges, pagination or infinite scroll
- `/campaigns/new` — Create campaign form (name, subject, body, recipient emails)
- `/campaigns/:id` — Campaign detail: stats, recipient list, action buttons

### UI features

- Campaign status badge (color-coded):
  - `draft` = grey
  - `scheduled` = blue
  - `sent` = green
- Action buttons: Schedule, Send, Delete (conditionally shown based on status)
- Stats display: open rate and send rate (progress bar or simple chart)
- Error handling: show API errors meaningfully
- Loading states: skeleton loaders or spinners while fetching

### Tech requirements

- React 18+ with TypeScript (Vite)
- React Query or SWR for data fetching
- Any component library is fine (shadcn/ui, Chakra, MUI, or Tailwind)
- Zustand or Redux required

---

## Part 3 — AI usage showcase (required)

In your `README.md`, include a section titled **"How I Used Claude Code"** that covers:

1. What tasks you delegated to Claude Code
2. 2–3 real prompts you used
3. Where Claude Code was wrong or needed correction
4. What you would not let Claude Code do — and why

---

## Evaluation criteria

- Backend correctness (business rules enforced, efficient SQL)
- API design (REST conventions, error codes, response shapes)
- Frontend quality (UX polish, error/loading states)
- Code quality (readability, separation of concerns)
- AI collaboration (judgment, transparency)
- Testing (meaningful coverage)

---

## Submission instructions

1. Push code to a **public GitHub repo**
2. Include `README.md` with:
   - Local setup (ideally `docker compose up`)
   - Seed data or a demo script
   - "How I Used Claude Code" section
3. Send repo link + walkthrough summary
