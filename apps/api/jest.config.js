/**
 * Jest config for @app/api.
 *
 * Authored as plain CommonJS (.js) rather than .ts so jest can load it
 * without ts-node. The api workspace is already CommonJS (see tsconfig.json +
 * package.json — no "type": "module"), so this matches the rest of the
 * workspace's module system. ts-jest still handles TypeScript compilation
 * for the actual test files.
 *
 * F2 additions (integration-tester):
 *   - `setupFiles` loads `.env.test` via dotenv BEFORE any test-file import
 *     evaluates. Critical because `src/config/env.ts` validates env at
 *     import-time and exits the process on missing values.
 *   - `globalSetup` runs migrations once before any worker starts, so the
 *     test database has the `users` schema for every test.
 *   - `globalTeardown` closes any sequelize pool the teardown process opens.
 *   - The `test` script in package.json passes `--runInBand` so tests share
 *     a single connection-pool and truncates don't race across workers.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // Don't pick up helper modules as test files.
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/tests/helpers/'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
  setupFiles: ['<rootDir>/tests/helpers/setup-env.ts'],
  globalSetup: '<rootDir>/tests/helpers/setup-global.ts',
  globalTeardown: '<rootDir>/tests/helpers/teardown-global.ts',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
};
