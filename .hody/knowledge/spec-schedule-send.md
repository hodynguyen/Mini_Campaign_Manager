---
tags: [spec, api-endpoint, schedule, send, async, state-machine]
date: 2026-05-08
author-agent: start-feature
status: implemented
---

# Spec: F4 — Schedule + Send (async) + Stats refresh

**Type:** api-endpoint
**Priority:** high (closes the backend; F5 frontend depends on these endpoints)
**Time budget within F4:** ~1.5 hours

## Summary

Wire the two transition endpoints from the brief: `POST /campaigns/:id/schedule`
and `POST /campaigns/:id/send`. Implement the async send simulation: 202
returns immediately with status=sending, a background worker iterates
CampaignRecipient rows and randomly marks each `sent` or `failed`, then
flips Campaign.status to `sent`. Make all state transitions atomic
(closes the F3 race carry-forward). Add a small open-tracking endpoint so
the F6 seed script (and the frontend demo) can produce non-zero
`open_rate`.

## Requirements

1. `POST /campaigns/:id/schedule` body `{ scheduled_at: <ISO 8601> }` → 200 with updated Campaign. Guards:
   - `scheduled_at` in the future (server clock).
   - Campaign is `draft` (atomic UPDATE; not find-then-update).
2. `POST /campaigns/:id/send` → **202 Accepted** with `{ id, status: 'sending' }`. Guards: status ∈ {`draft`, `scheduled`}. Worker runs after response sent.
3. Worker semantics:
   - For each `pending` CampaignRecipient: roll Math.random() < `SEND_SUCCESS_RATE` (default `0.8`); set `status='sent'` or `status='failed'`; stamp `sent_at = now()` either way.
   - When all rows processed, atomically flip Campaign.status from `sending` → `sent` (only if still `sending`).
   - Failures during the worker do NOT crash the api process — log + leave campaign in `sending` state. (Better than corrupt half-state.)
4. Atomic state transitions (closes F3 carry-forward):
   - schedule: `UPDATE campaigns SET status='scheduled', scheduled_at=:t, updated_at=now() WHERE id=:id AND created_by=:userId AND status='draft'` → affectedRows must equal 1; else 409 `CAMPAIGN_NOT_SCHEDULABLE` (or 404 if it's a tenancy miss — distinguish via a follow-up SELECT).
   - send: same pattern, condition `status IN ('draft','scheduled')`.
5. Re-running send: 409 `CAMPAIGN_NOT_SENDABLE` for non-{draft,scheduled} states.
6. **Open tracking endpoint** (out-of-scope per brief, in-scope for demo): `POST /campaigns/:id/recipients/:recipientId/open` → 204. Idempotent (only stamps `opened_at` if it's currently null AND row.status='sent'). Required for `open_rate > 0` in the demo. **Auth-required** (so it's not a public webhook surface).
7. ≥7 meaningful integration tests covering: schedule happy / past-time / wrong-state / tenancy-404; send happy with worker assertion / wrong-state; open-track happy / non-sent-row no-op / dup-no-op.
8. ADR-002 (proposed in F1) gets resolved → **accepted** with the actual implementation strategy.

## Technical Design

### File map (apps/api delta)

```
apps/api/
├── src/
│   ├── campaigns/
│   │   ├── service.ts         # ADD: scheduleCampaign(), sendCampaign(), trackOpen()
│   │   ├── worker.ts          # NEW: runSendWorker(campaignId) — pure function, exported
│   │   ├── controller.ts      # ADD: schedule, send, trackOpen handlers
│   │   ├── routes.ts          # ADD: POST /:id/schedule, POST /:id/send, POST /:id/recipients/:rid/open
│   │   └── schema.ts          # ADD: scheduleSchema, openTrackParamsSchema
│   └── config/env.ts          # ADD: SEND_SUCCESS_RATE (default 0.8), SEND_WORKER_DELAY_MS (default 0; tests can bump to make worker observable)
└── tests/
    ├── campaigns.schedule.test.ts
    ├── campaigns.send.test.ts
    └── campaigns.open-track.test.ts
```

### `packages/shared` delta

```ts
// add:
export interface ScheduleCampaignRequest {
  scheduled_at: string; // ISO 8601 UTC, must be > now()
}

export interface SendCampaignResponse {
  id: string;
  status: 'sending';
}
```

### Worker design

```ts
// apps/api/src/campaigns/worker.ts
export async function runSendWorker(campaignId: string): Promise<void> {
  // Read CR rows; for each pending row, randomize sent/failed + stamp sent_at; bulk update.
  // Use a single UPDATE per outcome bucket (2 queries total) for efficiency:
  //   UPDATE campaign_recipients SET status='sent',   sent_at=now() WHERE id IN (:sentIds)
  //   UPDATE campaign_recipients SET status='failed', sent_at=now() WHERE id IN (:failedIds)
  // Then atomic flip: UPDATE campaigns SET status='sent', updated_at=now() WHERE id=:id AND status='sending'.
}
```

The endpoint kicks off the worker via `setImmediate(() => runSendWorker(id).catch(logErr))` AFTER `res.status(202).json(...)`. This ensures the response is committed before the work starts.

For tests, the worker is **awaited** by exposing `sendCampaign(userId, id)` to optionally return a `Promise<void>` that the caller can `await` for deterministic test sequencing. Implementation: return both the immediate-202 result AND the worker promise from `service.sendCampaign(...)` — controller awaits the immediate result, then `setImmediate(() => workerPromise.catch(...))`. Tests can monkey-patch / call the service directly to await the worker.

Alternative: tests poll `GET /campaigns/:id` for `status === 'sent'` with a timeout. Simpler; pick this for non-flaky test sequencing.

### Locked tech decisions

| Area | Decision | Rationale |
|---|---|---|
| Async strategy | **`setImmediate` in-process** | ADR-002 resolution. BullMQ + Redis adds infra; the brief says "simulate", not "production-grade". |
| Atomic schedule transition | `UPDATE ... WHERE status='draft' RETURNING *` (or check affectedRows) | Closes F3 race. |
| Atomic send transition | `UPDATE ... WHERE status IN ('draft','scheduled') RETURNING *` | Same. |
| Worker → sent flip | `UPDATE ... WHERE status='sending'` | Idempotent on retry; doesn't trample manual fixes. |
| Outcome distribution | Default 80/20 sent/failed via `SEND_SUCCESS_RATE=0.8` env | Configurable for tests. |
| `sent_at` semantics | Stamp on BOTH `sent` and `failed` rows | Per business-rules.md — represents "attempted at". |
| Open tracking auth | Requires JWT (same as other /campaigns routes) | Don't expose a public webhook in scope-limited assignment. |
| Open tracking guards | Only stamps if currently null AND row.status='sent' | Idempotent; pending/failed never "opened". |

## Out of Scope

- Real email sending (SMTP, SendGrid, etc.).
- Per-tenant rate limiting on send.
- Cancel-while-sending endpoint.
- Email open pixel tracking endpoint (no `<img src>` route — frontend demo does it via JSON POST).
- Persistent job queue / retry on api crash.
- Cron-driven scheduled send (the `scheduled_at` field is informational; the user clicks send manually). Brief doesn't actually require a scheduler — only that the endpoint accepts a future `scheduled_at`.

## Agent Workflow

```
THINK:  architect            (atomic transition SQL, worker design, tests-await-worker pattern)
BUILD:  backend              (service + worker + controller + routes + schema delta)
VERIFY: integration-tester   (≥7 tests; the send test is the hardest — sequencing without race)
        code-reviewer        (race surface, worker error handling, idempotency, auth on open-track)
```

**Agents:** 4. No SHIP — CI was wired in F2.

## Definition of Done

- [ ] `POST /campaigns/:id/schedule` 200 on draft + future-time
- [ ] `POST /campaigns/:id/schedule` 400 on past-time
- [ ] `POST /campaigns/:id/schedule` 409 on non-draft
- [ ] `POST /campaigns/:id/send` 202 with status=sending
- [ ] After send, `GET /campaigns/:id` eventually shows status=sent and stats reflect sent/failed counts
- [ ] `POST /campaigns/:id/send` 409 on already-sent
- [ ] `POST /campaigns/:id/recipients/:rid/open` 204 (auth required, idempotent)
- [ ] All transitions are atomic (verified by reading the SQL, not just tests passing)
- [ ] ≥7 new tests pass; total ≥66 (59 + 7)
- [ ] ADR-002 status flipped to "accepted"
- [ ] tech-debt entry from F3 (atomic transitions) marked resolved
- [ ] business-rules.md cross-references current
