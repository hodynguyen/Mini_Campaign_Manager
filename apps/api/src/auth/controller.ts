/**
 * Auth controllers — the HTTP-aware layer.
 *
 * Pattern:
 *   1. Parse with zod (throws ZodError -> handler maps to 400 + details).
 *   2. Delegate to service for the actual work.
 *   3. Serialize via `toUserDTO` so the wire shape never includes
 *      `password_hash` or other internals.
 *
 * Login enumeration defense (constant-time-ish):
 *   We MUST NOT branch the error message OR the work performed on whether the
 *   email exists. Concretely:
 *     - If user not found, we still call `verifyPassword(submittedPwd, SENTINEL_HASH)`
 *       so the response time roughly matches the "user found, wrong pwd" case.
 *     - The error returned is identical (`INVALID_CREDENTIALS`) for both
 *       "no such email" and "wrong password".
 *   This is a defense against trivial timing oracles — not a strong constant-
 *   time guarantee. A determined attacker with sufficient samples and a
 *   stable network path could still distinguish the cases. Acceptable for the
 *   assignment scope; documented here so reviewers see the limitation.
 */
import type { Request, Response } from 'express';

import type { AuthResponse, User as UserDTO } from '@app/shared';

import { UnauthorizedError } from '../errors/AppError';
import { loginSchema, registerSchema } from '../schemas/auth.schema';

import type { User } from '../db/models/User';

import {
  SENTINEL_HASH,
  createUser,
  findByEmailLower,
  signToken,
  verifyPassword,
} from './service';

/**
 * Convert a Sequelize User model to the wire DTO. Strips passwordHash by
 * construction — we explicitly pick the four public fields. `created_at` is
 * snake_case at the wire to match `@app/shared` `User`.
 */
function toUserDTO(user: User): UserDTO {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    created_at: user.createdAt.toISOString(),
  };
}

export async function register(req: Request, res: Response): Promise<void> {
  const input = registerSchema.parse(req.body);
  const user = await createUser(input);
  res.status(201).json(toUserDTO(user));
}

export async function login(req: Request, res: Response): Promise<void> {
  const input = loginSchema.parse(req.body);

  const user = await findByEmailLower(input.email);

  // Constant-time-ish: always run a bcrypt comparison, even when no user is
  // found. The decoy comparison runs against SENTINEL_HASH so it consumes
  // roughly the same CPU time as a real verify. We then check `user !== null`
  // separately so the response never depends on which branch failed.
  const hashToCompare = user?.passwordHash ?? SENTINEL_HASH;
  const passwordOk = await verifyPassword(input.password, hashToCompare);

  if (!user || !passwordOk) {
    throw new UnauthorizedError({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
  }

  const token = signToken({ id: user.id, email: user.email });
  const body: AuthResponse = {
    token,
    user: toUserDTO(user),
  };
  res.status(200).json(body);
}
