/**
 * User model.
 *
 * Mirrors the `users` table from migration 0001. Columns are snake_case in
 * Postgres (`password_hash`, `created_at`, `updated_at`); Sequelize maps them
 * to camelCase JS attributes via `underscored: true`.
 *
 * Sensitive-field handling:
 *   We hide `passwordHash` from JSON serialization via a `defaultScope` that
 *   excludes the column. Routes that need to verify a password (login) bypass
 *   the scope explicitly with `User.scope('withPassword').findOne(...)`.
 *
 * Why scope (not `toJSON` override): the scope short-circuits at the SQL level
 * — `password_hash` is never even SELECTed for normal queries, so it can't
 * accidentally leak via logging, debug printers, or `JSON.stringify`. The
 * `toJSON` approach would still pull the column into memory and rely on
 * discipline at every serialization site.
 *
 * NOTE: never exported to `@app/shared`; that package only ships pure DTO
 * types. Callers in routes/services use `toUserDTO(user)` (in controller.ts)
 * to produce the wire shape.
 */
import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from 'sequelize';

import { sequelize } from '../sequelize';

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<string>;
  declare email: string;
  declare name: string;
  declare passwordHash: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

User.init(
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      // DB default `gen_random_uuid()` (pgcrypto, enabled by migration 0001)
      // produces the value; we don't generate UUIDs in Node.
      defaultValue: DataTypes.UUIDV4,
    },
    email: {
      // Stored as CITEXT in Postgres — Sequelize doesn't have a native CITEXT
      // type, so we declare STRING here and rely on the column type set by the
      // migration. Validation still runs server-side in the zod schema.
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    passwordHash: {
      type: DataTypes.STRING,
      allowNull: false,
      // Map JS `passwordHash` -> column `password_hash` explicitly.
      // (The `underscored: true` table option does the same automatically,
      // but being explicit here documents the sensitive column.)
      field: 'password_hash',
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
    tableName: 'users',
    underscored: true,
    timestamps: true,
    // Default scope hides password_hash. Use User.scope('withPassword') to
    // include it (only the login path needs it).
    defaultScope: {
      attributes: { exclude: ['passwordHash'] },
    },
    scopes: {
      withPassword: {
        attributes: { include: ['passwordHash'] },
      },
    },
  },
);
