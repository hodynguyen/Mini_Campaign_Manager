/**
 * Test helper: register + log in test users.
 *
 * Many F3 suites need two distinct authenticated users to exercise tenancy
 * (User A creates campaign; User B must get 404, not 403). This module
 * factors out the register-then-login dance so test files stay focused on
 * the behavior under test.
 *
 * Each helper returns:
 *   - `token`: a Bearer JWT signed by the live `/auth/login` endpoint.
 *     Use as `Authorization: Bearer ${token}`.
 *   - `userId`: the UUID assigned by the register endpoint. Useful for
 *     direct DB assertions like `Campaign.findOne({ where: { createdBy } })`.
 *   - `email` / `name`: round-tripped for assertions on response bodies.
 *
 * Pattern note: every helper takes the supertest-built `app` so the caller
 * controls app lifecycle (one app per `it`, per the F2 convention).
 */
import request from 'supertest';

import type { Express } from 'express';

export interface TestUser {
  token: string;
  userId: string;
  email: string;
  name: string;
  password: string;
}

/**
 * Register + log in one test user. The email/name suffix lets callers create
 * multiple distinct users in the same test (User A, User B, etc.) without
 * collisions on the unique-email constraint.
 *
 * Throws if either step returns a non-2xx — failing fast keeps test stack
 * traces pointing at the actual assertion, not at downstream side effects.
 */
export async function createTestUser(
  app: Express,
  suffix: string,
): Promise<TestUser> {
  const email = `user-${suffix}@example.com`;
  const name = `User ${suffix}`;
  const password = 'integration-test-pwd-1';

  const reg = await request(app).post('/auth/register').send({ email, name, password });
  if (reg.status !== 201) {
    throw new Error(
      `createTestUser('${suffix}'): register failed with ${reg.status}: ${JSON.stringify(reg.body)}`,
    );
  }

  const login = await request(app).post('/auth/login').send({ email, password });
  if (login.status !== 200) {
    throw new Error(
      `createTestUser('${suffix}'): login failed with ${login.status}: ${JSON.stringify(login.body)}`,
    );
  }

  return {
    token: login.body.token as string,
    userId: reg.body.id as string,
    email,
    name,
    password,
  };
}

/** Convenience: create User A. */
export async function createUserA(app: Express): Promise<TestUser> {
  return createTestUser(app, 'a');
}

/** Convenience: create User B. */
export async function createUserB(app: Express): Promise<TestUser> {
  return createTestUser(app, 'b');
}
