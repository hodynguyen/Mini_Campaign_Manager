/**
 * Sequelize associations registry.
 *
 * All model relationships live HERE — NOT scattered across model files. Why:
 *   1. Avoids circular-import / model-load-order pitfalls. Models can be
 *      imported in any sequence; associations are wired exactly once when
 *      this module is imported.
 *   2. Single source of truth for the relationship graph — code-reviewer can
 *      verify FK directions and `as`/aliases in one place.
 *   3. Each model file stays a pure data carrier (`init(...)` + types only).
 *
 * Relationship graph (F3):
 *
 *   User    ────1:N───  Campaign           (FK: campaigns.created_by)
 *   Campaign ───1:N───  CampaignRecipient  (FK: campaign_recipients.campaign_id)
 *   Recipient ──1:N───  CampaignRecipient  (FK: campaign_recipients.recipient_id)
 *
 *   M:N convenience: Campaign ↔ Recipient through CampaignRecipient.
 *
 * Aliases (`as`) for `include`-based eager loading:
 *   campaign.campaignRecipients         -> CR rows for this campaign
 *   campaignRecipient.campaign          -> the parent campaign
 *   campaignRecipient.recipient         -> the recipient row (for email/name)
 *   recipient.campaignRecipients        -> CR rows referencing this recipient
 *   campaign.recipients                 -> Recipient rows via the join
 *   recipient.campaigns                 -> Campaign rows via the join
 *
 * Import this module ONCE at process boot:
 *   - `apps/api/src/index.ts` (production)
 *   - `apps/api/tests/helpers/server.ts` (tests)
 *
 * After import, all associations are registered on the shared Sequelize
 * singleton. Subsequent `Model.findAll({ include: ... })` calls work
 * regardless of which file imports which model first.
 */
import { Campaign } from './models/Campaign';
import { CampaignRecipient } from './models/CampaignRecipient';
import { Recipient } from './models/Recipient';
import { User } from './models/User';

// User ↔ Campaign (one user owns many campaigns).
User.hasMany(Campaign, {
  foreignKey: 'created_by',
  as: 'campaigns',
  onDelete: 'CASCADE',
});
Campaign.belongsTo(User, {
  foreignKey: 'created_by',
  as: 'creator',
});

// Campaign ↔ CampaignRecipient (one campaign has many CR rows).
Campaign.hasMany(CampaignRecipient, {
  foreignKey: 'campaign_id',
  as: 'campaignRecipients',
  onDelete: 'CASCADE',
});
CampaignRecipient.belongsTo(Campaign, {
  foreignKey: 'campaign_id',
  as: 'campaign',
});

// Recipient ↔ CampaignRecipient (one recipient may appear in many CRs).
Recipient.hasMany(CampaignRecipient, {
  foreignKey: 'recipient_id',
  as: 'campaignRecipients',
  // RESTRICT at DB level — don't allow deleting a recipient that has CRs.
  onDelete: 'RESTRICT',
});
CampaignRecipient.belongsTo(Recipient, {
  foreignKey: 'recipient_id',
  as: 'recipient',
});

// Convenience M:N — useful for `Campaign.findByPk(id, { include: ['recipients'] })`.
// Backend may use either the through-CR include path OR this M:N alias depending
// on whether they need the CR's `status`/`sent_at` fields.
Campaign.belongsToMany(Recipient, {
  through: CampaignRecipient,
  foreignKey: 'campaign_id',
  otherKey: 'recipient_id',
  as: 'recipients',
});
Recipient.belongsToMany(Campaign, {
  through: CampaignRecipient,
  foreignKey: 'recipient_id',
  otherKey: 'campaign_id',
  as: 'campaigns',
});
