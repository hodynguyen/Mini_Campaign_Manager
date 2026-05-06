---
tags: [business-rules, domain]
created: 2026-05-06
author_agent: human
status: active
---

# Business Rules

> Rules below come directly from `ASSIGNMENT.md` "Business rules" section.
> They MUST be enforced **server-side** (the brief is explicit about this).
> Client-side checks are UX-only and not load-bearing.

## Campaign lifecycle

### Rule: Campaign status state machine
- **States:** `draft` → `scheduled` → `sending` → `sent`
- **Transitions allowed:**
  - `draft` → `scheduled` (via `POST /campaigns/:id/schedule`)
  - `draft` → `sending` (via `POST /campaigns/:id/send`, skip schedule)
  - `scheduled` → `sending` (via `POST /campaigns/:id/send`)
  - `sending` → `sent` (by background worker when all recipients processed)
- **Forbidden:** any transition out of `sent`. Once sent, immutable.

### Rule: Edit only in draft
- **Conditions:** `PATCH /campaigns/:id` is invoked.
- **Action:** allow only when `status = 'draft'`.
- **Otherwise:** 409 Conflict with `{ code: "CAMPAIGN_NOT_EDITABLE" }`.

### Rule: Delete only in draft
- **Conditions:** `DELETE /campaigns/:id` is invoked.
- **Action:** allow only when `status = 'draft'`.
- **Otherwise:** 409 Conflict.

### Rule: scheduled_at must be in the future
- **Conditions:** `POST /campaigns/:id/schedule` body includes `scheduled_at`.
- **Action:** reject if `scheduled_at <= now()` (server clock).
- **Why server clock:** client clocks lie / drift; brief says enforce server-side.
- **Edge case:** define "future" as strictly greater than now + small skew (e.g. 0s ok,
  but be explicit in validator).

### Rule: Sending is one-way
- **Conditions:** Campaign reaches `sent`.
- **Action:** No endpoint may transition it back. Even retries on failed
  recipients do NOT change Campaign.status.

## Authorization

### Rule: Tenancy by created_by
- All campaign endpoints (`GET /campaigns`, `GET/PATCH/DELETE /campaigns/:id`,
  schedule, send) MUST scope by `created_by = req.user.id`.
- Accessing another user's campaign returns **404** (not 403 — don't leak existence).

## Stats computation

### Rule: stats shape (per brief)
```json
{ "total": 0, "sent": 0, "failed": 0, "opened": 0, "open_rate": 0, "send_rate": 0 }
```
- `total` = count of CampaignRecipient rows for this campaign
- `sent` = count where status='sent'
- `failed` = count where status='failed'
- `opened` = count where opened_at IS NOT NULL
- `send_rate` = sent / total (0 if total=0). Range [0, 1].
- `open_rate` = opened / sent (0 if sent=0). Range [0, 1]. **Denominator is `sent`, not `total`** — opening only counts once a message landed.
- All counts/rates computed in a single SQL query (aggregation), not N+1.

## Recipients

### Rule: Recipient identity by email
- A Recipient is unique by `email` (case-insensitive recommended).
- When attaching to a campaign, upsert by email. Don't duplicate the Recipient row.

### Rule: Adding recipients to a non-draft campaign
- Brief is silent. Default decision: **forbidden** once status leaves `draft`.
  Same 409 as edit. Document in API contract.

## Async send simulation

### Rule: Random outcome per recipient
- Each CampaignRecipient is independently marked `sent` or `failed`.
- Distribution: pick a stable ratio (e.g., 80% sent / 20% failed) and document it.
- Stamp `sent_at = now()` regardless of outcome (matches "attempted at" semantics)
  — the `status` field carries success/fail.
- After all rows processed, set Campaign.status = 'sent'.
