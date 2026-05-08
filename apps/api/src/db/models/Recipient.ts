/**
 * Recipient model.
 *
 * Mirrors the `recipients` table from migration 0003. Recipients are
 * tenant-shared (no `created_by`) per ADR-012.
 *
 * Email is stored as Postgres CITEXT (case-insensitive) — Sequelize doesn't
 * have a native CITEXT type, so we declare STRING here and rely on the column
 * type set by the migration. Validation runs in zod (`src/recipients/schema.ts`).
 *
 * No `updated_at` — recipients are immutable in F3 (no PATCH endpoint).
 * Sequelize default `timestamps: true` would expect both columns, so we
 * disable `updatedAt` and keep only `createdAt`.
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

export class Recipient extends Model<
  InferAttributes<Recipient>,
  InferCreationAttributes<Recipient>
> {
  declare id: CreationOptional<string>;
  declare email: string;
  declare name: string;
  declare createdAt: CreationOptional<Date>;
}

Recipient.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    email: {
      // CITEXT in Postgres; STRING here. zod schema enforces email format.
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'recipients',
    underscored: true,
    // Only `created_at` exists in the table; disable `updatedAt` so Sequelize
    // doesn't try to write to a non-existent column.
    timestamps: true,
    updatedAt: false,
  },
);
