/**
 * Demo seed script.
 *
 * Populates the dev DB with a deterministic, reviewer-friendly demo dataset:
 *   - 1 demo user            (demo@example.com / demo1234)
 *   - 15 shared recipients   (realistic-looking names + emails)
 *   - 4 campaigns owned by the demo user, one per business state:
 *       * draft       — "Welcome series — email 1"     (5 pending CRs)
 *       * draft       — "Newsletter template"           (0 CRs)
 *       * scheduled   — "Spring sale launch"            (8 pending CRs, +7 days)
 *       * sent        — "Q4 product update"             (10 CRs: 8 sent / 2 failed,
 *                                                        5 of the sent rows opened)
 *
 * Idempotency strategy:
 *   - User: `findOrCreate` by email — re-runs reuse the same row.
 *   - Recipients: `findOrCreate` by email — re-runs reuse the same rows
 *     (recipients are tenant-shared per ADR-012, so we must NOT delete them).
 *   - Campaigns: deleted-then-recreated on every run (scoped to demo user only)
 *     so the seed is the source of truth for demo campaign content. The CASCADE
 *     on `campaigns -> campaign_recipients` clears CR rows for us.
 *
 * Re-running this script yields the same final state every time:
 *   1 demo user, 15 recipients, 4 campaigns, 23 CR rows.
 *
 * Safety:
 *   - This script is for the DEV database only. It uses the same
 *     `DATABASE_URL` as `yarn dev`, so do NOT point your dev env at a shared
 *     environment unless you really mean it.
 *   - The test DB (`campaign_test`) is untouched — it has its own
 *     `DATABASE_URL_TEST` and tests truncate per-test in `tests/helpers`.
 *
 * Usage:
 *   yarn workspace @app/api seed
 */
import 'dotenv/config';

import { hashPassword } from '../auth/service';

import './associations';
import { runMigrations } from './migrate';
import { Campaign } from './models/Campaign';
import { CampaignRecipient } from './models/CampaignRecipient';
import { Recipient } from './models/Recipient';
import { User } from './models/User';
import { pingDatabase, sequelize } from './sequelize';

/**
 * 15 deterministic recipient fixtures. Mix of professional/personal-looking
 * emails so the recipient list in the UI looks like a real address book.
 */
const RECIPIENT_FIXTURES: ReadonlyArray<{ email: string; name: string }> = [
  { email: 'alice.anderson@example.com', name: 'Alice Anderson' },
  { email: 'bob.brown@example.com', name: 'Bob Brown' },
  { email: 'carol.chen@example.com', name: 'Carol Chen' },
  { email: 'david.davis@example.com', name: 'David Davis' },
  { email: 'emma.evans@example.com', name: 'Emma Evans' },
  { email: 'frank.fischer@example.com', name: 'Frank Fischer' },
  { email: 'grace.garcia@example.com', name: 'Grace Garcia' },
  { email: 'henry.huang@example.com', name: 'Henry Huang' },
  { email: 'isabel.ibarra@example.com', name: 'Isabel Ibarra' },
  { email: 'jordan.jones@example.com', name: 'Jordan Jones' },
  { email: 'kim.kowalski@example.com', name: 'Kim Kowalski' },
  { email: 'liam.lee@example.com', name: 'Liam Lee' },
  { email: 'maya.martinez@example.com', name: 'Maya Martinez' },
  { email: 'noah.nguyen@example.com', name: 'Noah Nguyen' },
  { email: 'olivia.olsen@example.com', name: 'Olivia Olsen' },
];

const HOURS = 60 * 60 * 1000;
const DAYS = 24 * HOURS;

/** Insert / re-fetch the demo user. Returns the same row on repeated runs. */
async function upsertDemoUser(): Promise<User> {
  const passwordHash = await hashPassword('demo1234');
  const [user] = await User.findOrCreate({
    where: { email: 'demo@example.com' },
    defaults: {
      email: 'demo@example.com',
      name: 'Demo User',
      passwordHash,
    },
  });
  return user;
}

/** Insert / re-fetch the 15 fixture recipients. */
async function upsertRecipients(): Promise<Recipient[]> {
  const rows = await Promise.all(
    RECIPIENT_FIXTURES.map(async (fixture) => {
      const [row] = await Recipient.findOrCreate({
        where: { email: fixture.email },
        defaults: { email: fixture.email, name: fixture.name },
      });
      return row;
    }),
  );
  return rows;
}

/**
 * Wipe the demo user's existing campaigns. Cascade clears their CR rows.
 * Recipients are SHARED — never delete them here.
 */
async function clearDemoCampaigns(demoUserId: string): Promise<void> {
  await Campaign.destroy({ where: { createdBy: demoUserId } });
}

/**
 * Build the four demo campaigns inside a single transaction so any failure
 * leaves the DB in a clean (post-clear, pre-create) state.
 */
async function createDemoCampaigns(demoUserId: string, recipients: Recipient[]): Promise<void> {
  await sequelize.transaction(async (tx) => {
    // ── 1. Draft #1: "Welcome series — email 1" — 5 pending CRs ─────────────
    const draft1 = await Campaign.create(
      {
        name: 'Welcome series — email 1',
        subject: 'Welcome aboard, {{name}}!',
        body:
          'Hi {{name}},\n\n' +
          "We're thrilled to have you join us. Over the next few days, we'll " +
          'send you a short series of emails to help you get the most out of ' +
          "your account. There's nothing you need to do — just keep an eye on " +
          'your inbox.\n\n' +
          'Cheers,\nThe Team',
        status: 'draft',
        createdBy: demoUserId,
      },
      { transaction: tx },
    );
    await CampaignRecipient.bulkCreate(
      recipients.slice(0, 5).map((r) => ({
        campaignId: draft1.id,
        recipientId: r.id,
        status: 'pending' as const,
      })),
      { transaction: tx },
    );

    // ── 2. Draft #2: "Newsletter template" — 0 CRs ──────────────────────────
    await Campaign.create(
      {
        name: 'Newsletter template',
        subject: 'Monthly newsletter — DRAFT',
        body:
          'Hi {{name}},\n\n' +
          "Here's what we've been up to this month:\n\n" +
          '  • [headline 1]\n' +
          '  • [headline 2]\n' +
          '  • [headline 3]\n\n' +
          'Until next month,\nThe Team',
        status: 'draft',
        createdBy: demoUserId,
      },
      { transaction: tx },
    );

    // ── 3. Scheduled: "Spring sale launch" — 8 pending CRs, +7 days ─────────
    const scheduled = await Campaign.create(
      {
        name: 'Spring sale launch',
        subject: "🌸 Don't miss our spring sale",
        body:
          'Hi {{name}},\n\n' +
          'Spring is here, and so is our biggest sale of the year. For one ' +
          'week only, take 25% off everything in the store with code SPRING25 ' +
          'at checkout.\n\n' +
          'Shop the sale: https://example.com/spring-sale\n\n' +
          'Happy shopping,\nThe Team',
        status: 'scheduled',
        scheduledAt: new Date(Date.now() + 7 * DAYS),
        createdBy: demoUserId,
      },
      { transaction: tx },
    );
    await CampaignRecipient.bulkCreate(
      recipients.slice(0, 8).map((r) => ({
        campaignId: scheduled.id,
        recipientId: r.id,
        status: 'pending' as const,
      })),
      { transaction: tx },
    );

    // ── 4. Sent: "Q4 product update" — 8 sent / 2 failed; 5 sent rows opened
    const sentCampaign = await Campaign.create(
      {
        name: 'Q4 product update',
        subject: 'Big news from the team',
        body:
          'Hi {{name}},\n\n' +
          "We just shipped our biggest update of the year — packed with the " +
          'features you asked for:\n\n' +
          '  • Faster sync (3× the previous version)\n' +
          '  • Dark mode across the dashboard\n' +
          '  • A redesigned reporting page\n\n' +
          'Read the full announcement: https://example.com/blog/q4-update\n\n' +
          'As always, thanks for being part of the journey.\n\n' +
          'The Team',
        status: 'sent',
        createdBy: demoUserId,
      },
      { transaction: tx },
    );

    // 10 recipients: indices 0..9 of the fixture list.
    const sentTargets = recipients.slice(0, 10);
    // Stamps: send simulated 6 hours ago; opens trickled in 30 min after send.
    const sentAt = new Date(Date.now() - 6 * HOURS);
    const openedAt = new Date(sentAt.getTime() + 30 * 60 * 1000);

    const crRows = sentTargets.map((recipient, idx) => {
      // First 8 are 'sent', last 2 are 'failed'. Both groups stamp sent_at —
      // failed sends still have an attempt timestamp (matches F4 worker behavior).
      const isFailed = idx >= 8;
      // Of the 8 'sent' rows, the FIRST 5 have an open recorded.
      // open_rate = 5 / 8 = 62.5% (non-zero per spec).
      const opened = !isFailed && idx < 5;

      return {
        campaignId: sentCampaign.id,
        recipientId: recipient.id,
        status: (isFailed ? 'failed' : 'sent') as 'failed' | 'sent',
        sentAt,
        openedAt: opened ? openedAt : null,
      };
    });
    await CampaignRecipient.bulkCreate(crRows, { transaction: tx });
  });
}

async function main(): Promise<void> {
  // 1. Make sure the connection works — fail fast with a clear error.
  const ok = await pingDatabase();
  if (!ok) {
    throw new Error(
      'Cannot reach database — is `docker compose up postgres` running and DATABASE_URL set?',
    );
  }

  // 2. Migrations are idempotent (umzug skips already-executed). Running them
  //    here means the seed works on a brand-new DB without a separate
  //    `yarn migrate` step.
  await runMigrations();

  // 3. Demo user (upsert).
  const demoUser = await upsertDemoUser();

  // 4. Recipients (upsert).
  const recipients = await upsertRecipients();

  // 5. Demo campaigns (clear + recreate, scoped to demo user).
  await clearDemoCampaigns(demoUser.id);
  await createDemoCampaigns(demoUser.id, recipients);

  // 6. Friendly summary so reviewers see exactly what to log in with.
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log('Seed complete.');
  // eslint-disable-next-line no-console
  console.log('  Login:      demo@example.com / demo1234');
  // eslint-disable-next-line no-console
  console.log(`  Recipients: ${recipients.length}`);
  // eslint-disable-next-line no-console
  console.log('  Campaigns:  4 (1 draft+5 / 1 draft+0 / 1 scheduled+8 / 1 sent+10)');
  // eslint-disable-next-line no-console
  console.log('');
}

main()
  .then(async () => {
    await sequelize.close();
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', err);
    await sequelize.close().catch(() => {
      /* swallow — already failing */
    });
    process.exit(1);
  });
