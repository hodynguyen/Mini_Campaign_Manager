---
tags: [api, contracts, endpoints, planned]
created: 2026-05-06
author_agent: human
status: planned
---

# API Contracts

> **Status:** Planned per `ASSIGNMENT.md`. No code yet.
> All campaign/recipient endpoints require `Authorization: Bearer <jwt>`.
> Error response shape (uniform): `{ "error": { "code": "STRING", "message": "..." } }`
> with appropriate HTTP status.

## Auth

### POST /auth/register
- **Request:** `{ email: string, name: string, password: string }`
- **Response 201:** `{ id: string, email: string, name: string, created_at: string }`
- **Errors:** 400 invalid input, 409 email taken
- **Auth:** public

### POST /auth/login
- **Request:** `{ email: string, password: string }`
- **Response 200:** `{ token: string, user: { id, email, name } }`
- **Errors:** 400, 401 invalid credentials
- **Auth:** public

## Campaigns

### GET /campaigns
- **Query:** `?page=1&limit=20&status=draft|sending|scheduled|sent`
- **Response 200:** `{ data: Campaign[], meta: { page, limit, total } }`
- **Auth:** required
- **Notes:** lists campaigns owned by `req.user.id`. Sort by `updated_at desc`.

### POST /campaigns
- **Request:**
  ```json
  {
    "name": "string",
    "subject": "string",
    "body": "string",
    "recipient_emails": ["a@x.com", "b@x.com"]   // optional; can attach later
  }
  ```
- **Response 201:** `Campaign` (status=draft)
- **Errors:** 400 validation
- **Auth:** required
- **Notes:** Recipients are upserted by email. CampaignRecipient rows created with status=pending.

### GET /campaigns/:id
- **Response 200:**
  ```json
  {
    "id": "...", "name": "...", "subject": "...", "body": "...",
    "status": "draft", "scheduled_at": null,
    "created_by": "...", "created_at": "...", "updated_at": "...",
    "stats": { "total": 0, "sent": 0, "failed": 0, "opened": 0, "open_rate": 0, "send_rate": 0 },
    "recipients": [
      { "recipient_id": "...", "email": "...", "name": "...",
        "status": "pending|sent|failed", "sent_at": null, "opened_at": null }
    ]
  }
  ```
- **Errors:** 404 not found, 403 not owner
- **Auth:** required

### PATCH /campaigns/:id
- **Request:** any subset of `{ name, subject, body }`
- **Response 200:** updated `Campaign`
- **Errors:** 400, 404, 403, **409** if status != "draft"
- **Auth:** required
- **Business rule:** only allowed when status=draft.

### DELETE /campaigns/:id
- **Response 204**
- **Errors:** 404, 403, **409** if status != "draft"
- **Auth:** required
- **Business rule:** only allowed when status=draft.

### POST /campaigns/:id/schedule
- **Request:** `{ scheduled_at: string (ISO 8601, future) }`
- **Response 200:** updated `Campaign` (status=scheduled)
- **Errors:** 400 (scheduled_at not in future), 409 (status != draft)
- **Auth:** required

### POST /campaigns/:id/send
- **Request:** (none)
- **Response 202:** `{ id, status: "sending" }`
- **Errors:** 409 (status not in {draft, scheduled})
- **Auth:** required
- **Notes:** Async simulation. Worker randomly marks each CampaignRecipient
  `sent` or `failed` (~80/20 split), stamps `sent_at`, then flips
  Campaign.status to `sent`. Client polls `GET /campaigns/:id` for progress.

## Recipients

### GET /recipients
- **Query:** `?page=1&limit=50&search=substr`
- **Response 200:** `{ data: Recipient[], meta }`
- **Auth:** required

### POST /recipients
- **Request:** `{ email: string, name: string }`
- **Response 201:** `Recipient`
- **Errors:** 400, 409 duplicate email
- **Auth:** required
- **Note:** Brief writes `POST /recipient` (singular). I'll standardize on
  `POST /recipients` per REST convention and call this out in the README.

## Open tracking (demo-only)

The brief includes `opened_at` in the schema but specifies no HTTP endpoint to
trigger it. To make `open_rate` non-zero in the UI demo, the seed script will
stamp `opened_at` on a random subset of `sent` rows. **Not** part of the public API.
