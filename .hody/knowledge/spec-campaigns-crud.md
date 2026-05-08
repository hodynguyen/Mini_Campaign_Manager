---
tags: [spec, api-endpoint, campaigns, recipients, state-machine]
date: 2026-05-08
author-agent: start-feature
status: implemented
---

# Spec: F3 — Campaigns + Recipients CRUD + State Machine

**Type:** api-endpoint
**Priority:** high (blocks F4 schedule/send and F5 frontend)
**Time budget within F3:** ~2 hours

## Summary

Ship the three core models (Campaign, Recipient, CampaignRecipient), their
migrations, full CRUD endpoints scoped per-user, the state machine guards
on edit/delete, and the stats aggregation embedded in `GET /campaigns/:id`.
Schedule + Send (async) are deferred to F4 — but the status field already
needs to support `draft | scheduled | sending | sent`.

## Requirements

1. Migrations 0002/0003/0004 add `campaigns`, `recipients`, `campaign_recipients` tables per ASSIGNMENT.md schema, with sensible indexes.
2. All endpoints require `requireAuth` (mounted from F2).
3. Tenancy enforced server-side: `created_by = req.user.id`. **Accessing another user's campaign returns 404, not 403** — no existence leaking.
4. **State machine guards:** `PATCH` and `DELETE` only when `status = 'draft'` → 409 otherwise.
5. `GET /campaigns/:id` returns campaign + nested `stats` block + `recipients` list (each recipient row carries its CampaignRecipient `status`, `sent_at`, `opened_at`).
6. `stats` shape per spec: `{ total, sent, failed, opened, open_rate, send_rate }` — computed in **one** aggregate SQL query, not N+1.
7. `POST /campaigns` accepts an optional `recipient_emails: string[]` and upserts Recipients by email + creates CampaignRecipient rows in a single transaction.
8. `GET /campaigns` is paginated (`?page=1&limit=20`) and filterable by `?status=`.
9. `POST /recipients` rejects duplicate email with 409.
10. ≥10 meaningful integration tests covering: list, create, get-with-stats, update-draft-only, delete-draft-only, update-non-draft-409, delete-non-draft-409, tenancy-404-on-other-user, recipient-create-dup-409, stats-correctness.

## Technical Design

### Data model

```sql
-- 0002-create-campaigns.ts
CREATE TYPE campaign_status AS ENUM ('draft','scheduled','sending','sent');

CREATE TABLE campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  status        campaign_status NOT NULL DEFAULT 'draft',
  scheduled_at  TIMESTAMPTZ,
  created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_campaigns_created_by_updated_at ON campaigns(created_by, updated_at DESC);
CREATE INDEX idx_campaigns_status_scheduled_at ON campaigns(status, scheduled_at) WHERE status = 'scheduled';

-- 0003-create-recipients.ts
CREATE TABLE recipients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       CITEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 0004-create-campaign-recipients.ts
CREATE TYPE campaign_recipient_status AS ENUM ('pending','sent','failed');

CREATE TABLE campaign_recipients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_id  UUID NOT NULL REFERENCES recipients(id) ON DELETE RESTRICT,
  status        campaign_recipient_status NOT NULL DEFAULT 'pending',
  sent_at       TIMESTAMPTZ,
  opened_at     TIMESTAMPTZ,
  UNIQUE (campaign_id, recipient_id)
);
CREATE INDEX idx_cr_campaign_id ON campaign_recipients(campaign_id);
```

### Index rationale (be ready to defend at code-review)

| Index | Why |
|---|---|
| `campaigns(created_by, updated_at DESC)` | `GET /campaigns` scopes by `created_by` and sorts by `updated_at desc` — composite covers both. |
| `campaigns(status, scheduled_at) WHERE status='scheduled'` | F4 worker will scan due-soon scheduled campaigns; partial index keeps it tiny. |
| `recipients(email) UNIQUE` | Required for upsert by email + prevents duplicates. CITEXT collation handles case. |
| `campaign_recipients(campaign_id)` | Stats aggregate scans by campaign_id; FK alone doesn't auto-index in Postgres. |
| `campaign_recipients(campaign_id, recipient_id) UNIQUE` | Prevents same recipient attached twice. |

### File map (apps/api delta)

```
apps/api/
├── migrations/
│   ├── 0002-create-campaigns.ts
│   ├── 0003-create-recipients.ts
│   └── 0004-create-campaign-recipients.ts
├── src/
│   ├── db/models/
│   │   ├── Campaign.ts
│   │   ├── Recipient.ts
│   │   └── CampaignRecipient.ts
│   ├── campaigns/
│   │   ├── service.ts          # business logic + state machine guards
│   │   ├── controller.ts       # request handlers
│   │   ├── routes.ts           # Router (auth-protected)
│   │   ├── stats.ts            # single-query aggregator
│   │   └── schema.ts           # zod: createCampaignSchema, updateCampaignSchema, listQuerySchema
│   ├── recipients/
│   │   ├── service.ts
│   │   ├── controller.ts
│   │   ├── routes.ts
│   │   └── schema.ts
│   └── app.ts                  # mount /campaigns, /recipients (both behind requireAuth)
└── tests/
    ├── helpers/server.ts       # extend truncateAll() to handle new tables
    ├── campaigns.crud.test.ts
    ├── campaigns.tenancy.test.ts
    ├── campaigns.state-machine.test.ts
    ├── campaigns.stats.test.ts
    └── recipients.crud.test.ts
```

### `packages/shared` delta

```ts
// add to packages/shared/src/index.ts:
export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent';
export type CampaignRecipientStatus = 'pending' | 'sent' | 'failed';

export interface Campaign {
  id: string;
  name: string;
  subject: string;
  body: string;
  status: CampaignStatus;
  scheduled_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Recipient {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

export interface CampaignRecipientRow {
  recipient_id: string;
  email: string;
  name: string;
  status: CampaignRecipientStatus;
  sent_at: string | null;
  opened_at: string | null;
}

export interface CampaignStats {
  total: number;
  sent: number;
  failed: number;
  opened: number;
  open_rate: number;   // 0..1
  send_rate: number;   // 0..1
}

export interface CampaignDetail extends Campaign {
  stats: CampaignStats;
  recipients: CampaignRecipientRow[];
}

export interface CreateCampaignRequest {
  name: string;
  subject: string;
  body: string;
  recipient_emails?: string[];
}

export interface UpdateCampaignRequest {
  name?: string;
  subject?: string;
  body?: string;
}

export interface PaginatedList<T> {
  data: T[];
  meta: { page: number; limit: number; total: number };
}
```

### Locked tech decisions

| Area | Decision | Rationale |
|---|---|---|
| Stats query | Single SQL via raw `sequelize.query` with named params, returns counts via `FILTER (WHERE …)` | One round-trip; no N+1; portable. |
| Recipient attach on create | Upsert by lower(email); attach via CampaignRecipient with status=pending | Per business-rules.md "Recipient identity by email". |
| Edit/delete on non-draft | 409 Conflict, code `CAMPAIGN_NOT_EDITABLE` | Per business-rules.md "Edit only in draft". |
| Other-user 404 vs 403 | **404** | Per business-rules.md "Tenancy by created_by — don't leak existence". |
| Pagination | Offset-based `page`/`limit` (defaults 1/20, max 100) | Simple, matches brief. Cursor pagination overkill. |
| List sort | `updated_at DESC` | Per architecture.md component diagram. |
| Recipients management | Tenant-shared (no `created_by`) | Brief schema doesn't include `created_by` on recipients; treat as a global lookup. Document in ADR-012. |
| Update status field | NOT exposed via PATCH | Status only changes via dedicated transitions in F4 (schedule, send). |

### Key business rules (summary, full list in business-rules.md)

- `PATCH /campaigns/:id` allows ONLY `{ name?, subject?, body? }` — never `status`, never `scheduled_at`, never `created_by`. Anything else → 400 from zod `strict()`.
- `DELETE /campaigns/:id` cascades CampaignRecipient rows (FK ON DELETE CASCADE).
- `scheduled_at` field is set in F4 only; F3 leaves it null.
- Recipients added to a non-draft campaign → forbidden 409 (business-rules.md "Adding recipients to a non-draft campaign"). F3 only adds at create-time, so this doesn't surface yet.

## Out of Scope

- Schedule + Send (F4).
- Stats endpoint as standalone (`/stats` is nested in `GET /campaigns/:id` per spec ambiguity resolution in api-contracts.md).
- Open tracking endpoint (F4 seed script will simulate).
- Bulk recipient import endpoint.
- Soft delete.
- Campaign templates.

## Agent Workflow

```
THINK:  architect            (lock model relationships, stats query shape, list pagination contract)
BUILD:  backend              (3 migrations, 3 models, 2 routers + services, mount under requireAuth)
VERIFY: integration-tester   (≥10 tests across 5 files; tenancy is the most security-relevant)
        code-reviewer        (sql injection on stats raw query, tenancy leaks, business rule enforcement, index sanity)
```

No SHIP phase needed — CI was wired in F2 and the new tables auto-migrate via existing globalSetup.

**Agents:** 4 (architect → backend → integration-tester → code-reviewer).

## Definition of Done

- [ ] `yarn workspace @app/api migrate` applies migrations 0002, 0003, 0004 cleanly
- [ ] `yarn workspace @app/api test` passes (24 from F2 + ≥10 new = ≥34 total)
- [ ] `GET /campaigns` paginated + auth required + scoped by `created_by`
- [ ] `POST /campaigns` creates draft + attaches recipients (upsert by email) in one transaction
- [ ] `GET /campaigns/:id` returns campaign + stats + recipients in one response
- [ ] `PATCH /campaigns/:id` 409s on non-draft
- [ ] `DELETE /campaigns/:id` 409s on non-draft, cascades CR rows on success
- [ ] Other-user campaign access → 404
- [ ] Stats query is single SQL (verified by reading the code, not via assertion)
- [ ] `yarn lint` + `tsc` clean
- [ ] decisions.md updated with ADR-012 (recipients are tenant-shared)
- [ ] business-rules.md cross-reference is up to date
