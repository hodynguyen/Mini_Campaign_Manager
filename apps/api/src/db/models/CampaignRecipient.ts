/**
 * CampaignRecipient model — join table between Campaign and Recipient.
 *
 * Mirrors the `campaign_recipients` table from migration 0004. Holds the
 * per-recipient send state for a given campaign:
 *   - `status` ENUM ('pending', 'sent', 'failed')
 *   - `sent_at` (set by F4 sender)
 *   - `opened_at` (set by F4 demo/seed for open-tracking simulation)
 *
 * Note: this model has its OWN id (UUID PK) rather than using a composite
 * (campaign_id, recipient_id) PK. The unique constraint on the pair lives at
 * the table level. The id PK simplifies row-level operations from JS land
 * (e.g. `findByPk(crId)` from a future open-tracking endpoint).
 *
 * No `created_at` / `updated_at` — the lifecycle of a CR row is captured by
 * `sent_at` / `opened_at` directly. Sequelize timestamps disabled.
 *
 * Associations are defined in `apps/api/src/db/associations.ts`.
 * SCAFFOLD-ONLY: no instance methods, no hooks.
 */
import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../sequelize';

export type CampaignRecipientStatus = 'pending' | 'sent' | 'failed';

export class CampaignRecipient extends Model<
  InferAttributes<CampaignRecipient>,
  InferCreationAttributes<CampaignRecipient>
> {
  declare id: CreationOptional<string>;
  declare campaignId: string;
  declare recipientId: string;
  declare status: CreationOptional<CampaignRecipientStatus>;
  declare sentAt: CreationOptional<Date | null>;
  declare openedAt: CreationOptional<Date | null>;
}

CampaignRecipient.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    campaignId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'campaign_id',
    },
    recipientId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'recipient_id',
    },
    status: {
      type: DataTypes.ENUM('pending', 'sent', 'failed'),
      allowNull: false,
      defaultValue: 'pending',
    },
    sentAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'sent_at',
    },
    openedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'opened_at',
    },
  },
  {
    sequelize,
    tableName: 'campaign_recipients',
    underscored: true,
    // No created_at/updated_at columns in the table.
    timestamps: false,
  },
);
