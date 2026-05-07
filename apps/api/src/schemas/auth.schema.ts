/**
 * Zod schemas for /auth endpoints.
 *
 * Per ADR-009, schemas live in apps/api (NOT in @app/shared) — keeps zod out
 * of the web bundle. The web app gets pure types from @app/shared.
 *
 * Constraint sources:
 *   - email: trimmed + lowercased before any DB hit. CITEXT also handles
 *     case-insensitive comparison at the column level, but normalizing the
 *     input means our service-layer string comparisons (logs, dedupe checks)
 *     can rely on a canonical form.
 *   - name: 1..80 after trim. 80 is conservative; matches the assignment's
 *     "reasonable for a person's name" implicit limit and keeps payloads small.
 *   - password: 8..72. The 72-byte ceiling is bcrypt's hard truncation point;
 *     anything beyond is silently dropped, which would make a 100-char
 *     password equivalent to its first 72 bytes — confusing and a foot-gun.
 *     Reject up front instead.
 */
import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(8).max(72),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  // For login we still bound length (defense-in-depth against giant payloads)
  // but accept any non-empty string — the actual credential check is
  // verifyPassword, not zod.
  password: z.string().min(1).max(72),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
