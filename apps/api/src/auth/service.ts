/**
 * Auth service — business logic, no HTTP awareness.
 *
 * Boundaries:
 *   - Knows about `User` model, bcrypt, jsonwebtoken, env.
 *   - Does NOT know about Express req/res. Throws domain errors that the
 *     global handler converts to HTTP responses.
 *   - Never logs passwords or hashes — see the explicit "no-log" notes below.
 *
 * Public surface (everything else is private to this module):
 *   - hashPassword(plain)
 *   - verifyPassword(plain, hash)
 *   - createUser({ email, name, password })   -> User
 *   - findByEmailLower(email)                  -> User | null  (with passwordHash)
 *   - signToken({ id, email })                 -> string (JWT)
 *   - SENTINEL_HASH                            -> for constant-time login fallback
 *
 * Constant-time login: see controller.ts. `verifyPassword` itself is already
 * constant-time per bcrypt — `bcrypt.compare` does not short-circuit on
 * mismatched bytes. The constant-time concern at the controller level is
 * about NOT skipping the verify step when a user isn't found.
 */
import bcrypt from 'bcrypt';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { UniqueConstraintError } from 'sequelize';

import { env } from '../config/env';
import { User } from '../db/models/User';
import { ConflictError } from '../errors/AppError';

/**
 * bcrypt cost factor (see ADR-010).
 *
 * 10 is the OWASP "default for typical web apps" — ~50–100ms per hash on
 * modern hardware, which is the right ballpark for a sub-100ms login response
 * without making bulk-hash GPU attacks trivial. Cost 12 was considered and
 * rejected: it doubles every login latency and the password-length floor we
 * enforce (>=8 chars) already raises the attacker's brute-force cost
 * meaningfully. Revisit once we have prod load numbers.
 */
const BCRYPT_COST = 10;

/**
 * Pre-computed bcrypt hash used as the "decoy" in constant-time login.
 *
 * When `findByEmailLower` returns null, controllers still call
 * `verifyPassword(submittedPassword, SENTINEL_HASH)` to consume an equivalent
 * amount of CPU time as the real-user path. This prevents a trivial timing
 * oracle that distinguishes "no such email" from "wrong password".
 *
 * The hash is generated once at module load (sync bcrypt) — a small startup
 * cost (a few ms) in exchange for not branching on user existence.
 *
 * The plaintext below is irrelevant — what matters is that this is a
 * well-formed bcrypt hash with the configured cost factor so that
 * `bcrypt.compare` runs the full work factor.
 */
export const SENTINEL_HASH: string = bcrypt.hashSync('__sentinel__', BCRYPT_COST);

/** Hash a plaintext password. NEVER log either argument or the return value. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * Compare a plaintext password against a stored bcrypt hash. Constant-time
 * w.r.t. mismatched bytes — `bcrypt.compare` does not early-return.
 *
 * Returns false (not throw) on mismatch.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Create a new user. Hashes the password, inserts the row.
 *
 * Throws:
 *   - ConflictError({code:'EMAIL_TAKEN'}) when email is already taken.
 *   - Anything else bubbles to the global error handler.
 */
export async function createUser(input: {
  email: string;
  name: string;
  password: string;
}): Promise<User> {
  const passwordHash = await hashPassword(input.password);
  try {
    // Email is already lowercased+trimmed by the zod schema; defensively
    // lowercase here too in case a caller bypasses validation.
    const user = await User.create({
      email: input.email.toLowerCase(),
      name: input.name,
      passwordHash,
    });
    return user;
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      throw new ConflictError({
        code: 'EMAIL_TAKEN',
        message: 'Email already in use',
      });
    }
    throw err;
  }
}

/**
 * Look up a user by lowercased email. Returns the user WITH `passwordHash`
 * attached (for verification) — login is the only caller that should touch
 * this and the controller MUST NOT serialize the result without going through
 * `toUserDTO`.
 *
 * `null` when no user matches.
 */
export async function findByEmailLower(email: string): Promise<User | null> {
  // CITEXT in Postgres makes the comparison case-insensitive at the column
  // level, but we lowercase here too so the same logic works against any
  // future non-CITEXT storage and keeps log/error messages canonical.
  return User.scope('withPassword').findOne({
    where: { email: email.toLowerCase() },
  });
}

/**
 * Sign a JWT for an authenticated user.
 *
 * Payload (ADR-011): `{ sub: <userId>, email: <userEmail> }`
 *   - `sub` is the JWT-standard subject claim — clients/middleware reach for
 *     this first. Avoids inventing a custom `userId` claim.
 *   - `email` is included so middleware can populate `req.user.email` without
 *     a DB lookup on every request.
 *
 * Algorithm: HS256. Single-service architecture — no public-key distribution
 * problem to solve. Re-evaluate if we ever federate auth.
 *
 * Expiry: from env (`JWT_EXPIRES_IN`, default '24h'). Casted to SignOptions'
 * `expiresIn` type because jsonwebtoken's TS surface expects a literal-ish
 * string-or-number; the env loader already validates non-empty.
 */
export function signToken(args: { id: string; email: string }): string {
  // `expiresIn` is typed `StringValue | number` in @types/jsonwebtoken, where
  // `StringValue` is a template-literal type from `vercel/ms`. Our env loader
  // gives us a plain `string`, so we cast through `unknown`. The env loader
  // enforces `min(1)` on JWT_EXPIRES_IN, so jsonwebtoken receives a non-empty
  // string at runtime — and it accepts any ms-parseable string.
  const options: SignOptions = {
    algorithm: 'HS256',
    expiresIn: env.JWT_EXPIRES_IN as unknown as number,
  };
  return jwt.sign({ sub: args.id, email: args.email }, env.JWT_SECRET, options);
}
