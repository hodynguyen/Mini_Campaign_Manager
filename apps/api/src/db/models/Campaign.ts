/**
 * Campaign model.
 *
 * Mirrors the `campaigns` table from migration 0002. Columns are snake_case in
 * Postgres (`scheduled_at`, `created_by`, `created_at`, `updated_at`); Sequelize
 * maps them to camelCase JS attributes via `underscored: true`.
 *
 * Status field is a Postgres ENUM (`campaign_status`); we declare it as a
 * Sequelize `DataTypes.ENUM('draft','scheduled','sending','sent')` so the
 * model knows the allowed values for client-side validation. The actual
 * storage type is owned by the migration.
 *
 * Associations live in `apps/api/src/db/associations.ts` (NOT in this file)
 * so model files can be imported in any order without resolving circular
 * association definitions. See associations.ts for the relationship graph.
 *
 * This is a SCAFFOLD-ONLY file: NO instance methods, NO custom toJSON, NO
 * hooks. Backend adds business logic in `src/campaigns/service.ts`. The model
 * is a pure data carrier mapping JS <-> SQL.
 */
import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../sequelize';

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent';

export class Campaign extends Model<InferAttributes<Campaign>, InferCreationAttributes<Campaign>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare subject: string;
  declare body: string;
  declare status: CreationOptional<CampaignStatus>;
  declare scheduledAt: CreationOptional<Date | null>;
  declare createdBy: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Campaign.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    subject: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    status: {
      // Sequelize ENUM mirrors the Postgres `campaign_status` type. The
      // migration owns the actual SQL type — this declaration just teaches
      // Sequelize the allowed values for query-side validation and TS narrowing.
      type: DataTypes.ENUM('draft', 'scheduled', 'sending', 'sent'),
      allowNull: false,
      defaultValue: 'draft',
    },
    scheduledAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'scheduled_at',
    },
    createdBy: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'created_by',
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'campaigns',
    underscored: true,
    timestamps: true,
  },
);
