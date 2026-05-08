/**
 * Send simulation worker.
 *
 * Per ADR-002 (accepted, F4): in-process async via `setImmediate` from the
 * controller after `res.status(202).json(...)` is committed. This file owns
 * the actual work; the controller owns the kick-off.
 *
 * Worker contract (per business-rules.md "Random outcome per recipient" +
 * spec-schedule-send.md §"Worker semantics"):
 *
 *   1. Find all CampaignRecipient rows for `campaignId` with status='pending'.
 *      (`status='pending'` filter makes a partial retry safe — a worker that
 *      re-runs after a previous run flipped some rows will only touch the
 *      rows still pending.)
 *   2. For each pending row, roll `Math.random() < env.SEND_SUCCESS_RATE`:
 *        - true  → bucket into sentIds.
 *        - false → bucket into failedIds.
 *   3. Issue at most TWO bulk UPDATEs (one per outcome bucket):
 *        UPDATE campaign_recipients
 *           SET status='sent', sent_at=NOW()
 *         WHERE id IN (:sentIds);
 *        UPDATE campaign_recipients
 *           SET status='failed', sent_at=NOW()
 *         WHERE id IN (:failedIds);
 *      (`sent_at` is stamped on BOTH success and failure — represents
 *      "attempted at" per business-rules.md.)
 *   4. Atomically flip Campaign.status sending → sent ONLY if it's still
 *      'sending':
 *        UPDATE campaigns SET status='sent', updated_at=NOW()
 *         WHERE id=:campaignId AND status='sending';
 *      The `WHERE status='sending'` clause makes the flip idempotent — a
 *      retry/race against a concurrent fix won't trample.
 *
 * Error handling:
 *   - All errors are caught at the top level and logged via console.error
 *     with a structured prefix ('[send-worker]'). The worker NEVER throws
 *     out — the api process must not crash on a simulated send failure.
 *   - On error, the campaign is left in `sending` state. Better than a
 *     half-flipped status. Operator can re-trigger manually (re-running the
 *     worker is safe by design — see step 1's pending filter).
 *
 * Two exports, ONE implementation:
 *   - `runSendWorker(campaignId)` — production path. Called from the
 *     controller via `setImmediate(() => runSendWorker(id).catch(...))`.
 *     Awaiting it from the same micro-task that responded 202 would defeat
 *     the async point of the endpoint.
 *   - `runSendWorkerForTests(campaignId)` — same body, awaitable from tests.
 *     Tests import this directly (NOT via the route) so they can assert the
 *     eventual state without polling. The names are deliberately distinct
 *     so production code can never accidentally `await` the test variant
 *     and serialize a request behind the worker.
 *
 * Optional artificial delay:
 *   - `env.SEND_WORKER_DELAY_MS` (default 0) is awaited BEFORE the worker
 *     starts updating rows. Lets integration tests that DO want to observe
 *     the `sending` intermediate state poll for it before the worker
 *     completes. Production leaves it at 0 (no delay).
 */
import { QueryTypes } from 'sequelize';

import { env } from '../config/env';
import { CampaignRecipient } from '../db/models/CampaignRecipient';
import { sequelize } from '../db/sequelize';

/**
 * SQL for the final atomic flip from `sending` → `sent`. Inlined here (rather
 * than re-exported from service.ts) because it's worker-private and the
 * `WHERE status='sending'` clause is the load-bearing idempotency guard —
 * keeping it next to the worker that uses it makes the invariant local to
 * read.
 */
const ATOMIC_SENDING_TO_SENT_SQL = `
  UPDATE campaigns
     SET status     = 'sent',
         updated_at = NOW()
   WHERE id     = :campaignId
     AND status = 'sending';
`;

/**
 * Run the simulated send worker for `campaignId`. Production entry point.
 *
 * NEVER throws — all errors are caught and logged. Caller (controller) wraps
 * with `.catch(...)` defensively but the inner promise should already be
 * settled successfully.
 *
 * @param campaignId UUID of the campaign whose pending CR rows to process.
 */
export async function runSendWorker(campaignId: string): Promise<void> {
  try {
    await runSendWorkerForTests(campaignId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[send-worker]', { campaignId, err });
    // Intentionally swallow: per spec, worker failures must NOT crash the api
    // process. The campaign is left in 'sending' state for manual recovery
    // (re-triggering is safe — the pending-filter in step 1 makes it idempotent).
  }
}

/**
 * Test-mode entry point — same body as `runSendWorker` but THROWS on error
 * so tests can assert the failure path.
 *
 * Tests should:
 *   1. Set up a campaign in `sending` state (or call sendCampaign first).
 *   2. `await runSendWorkerForTests(campaignId)` directly.
 *   3. Re-fetch the campaign / CR rows and assert the expected state.
 *
 * This avoids the polling-with-timeout pattern that would otherwise be
 * required to observe the worker's eventual effect through the HTTP surface.
 *
 * Tests can also override `process.env.SEND_SUCCESS_RATE = '1'` (or `'0'`)
 * BEFORE booting the test app to make outcomes deterministic — the env
 * loader reads it once at startup.
 *
 * @param campaignId UUID of the campaign whose pending CR rows to process.
 */
export async function runSendWorkerForTests(campaignId: string): Promise<void> {
  // Optional artificial latency. Default 0 in production. Tests that want to
  // observe the `sending` intermediate state via the HTTP surface bump this
  // to (e.g.) 200ms. Done BEFORE any DB work so the campaign visibly stays
  // in 'sending' for the duration.
  if (env.SEND_WORKER_DELAY_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, env.SEND_WORKER_DELAY_MS));
  }

  // 1. Find all pending CR rows. `attributes: ['id']` keeps the payload
  // tiny — we only need ids to build the bulk-UPDATE bind lists.
  const pending = await CampaignRecipient.findAll({
    where: { campaignId, status: 'pending' },
    attributes: ['id'],
  });

  // 2. Bucket each row by random outcome. Math.random is cheap; the bottle-
  // neck on a large campaign is round-trip count, not CPU.
  const sentIds: string[] = [];
  const failedIds: string[] = [];
  for (const cr of pending) {
    if (Math.random() < env.SEND_SUCCESS_RATE) {
      sentIds.push(cr.id);
    } else {
      failedIds.push(cr.id);
    }
  }

  // 3. Two bulk UPDATEs max (one per outcome bucket). Skip the call entirely
  // when a bucket is empty — Sequelize handles `Op.in: []` safely but a
  // no-op round-trip is still wasteful, and skipping makes the test for "all
  // sent" / "all failed" deterministic without inspecting the empty path.
  // `sent_at = NOW()` for BOTH outcomes per business-rules.md (represents
  // "attempted at", not "successfully delivered at").
  const now = new Date();
  if (sentIds.length > 0) {
    await CampaignRecipient.update(
      { status: 'sent', sentAt: now },
      { where: { id: sentIds } },
    );
  }
  if (failedIds.length > 0) {
    await CampaignRecipient.update(
      { status: 'failed', sentAt: now },
      { where: { id: failedIds } },
    );
  }

  // 4. Atomic flip sending → sent. The `WHERE status='sending'` clause makes
  // this idempotent — a re-run, or a race against a hypothetical operator
  // fix, won't trample. If the campaign isn't in 'sending' anymore, the
  // UPDATE matches 0 rows and the worker exits cleanly.
  await sequelize.query(ATOMIC_SENDING_TO_SENT_SQL, {
    replacements: { campaignId },
    type: QueryTypes.UPDATE,
  });
}
