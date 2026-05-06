/**
 * Jest config for @app/api.
 *
 * Authored as plain CommonJS (.js) rather than .ts so jest can load it
 * without ts-node. The api workspace is already CommonJS (see tsconfig.json +
 * package.json — no "type": "module"), so this matches the rest of the
 * workspace's module system. ts-jest still handles TypeScript compilation
 * for the actual test files.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
};
