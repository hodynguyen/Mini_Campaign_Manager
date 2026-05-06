/**
 * ESLint config for @app/api.
 *
 * Extends the root config and layers on backend-specific environments
 * (node globals + jest globals for the tests folder).
 *
 * No `parserOptions.project` here — type-aware lint rules are not enabled
 * yet, and pulling in the project graph would slow ESLint significantly.
 */
module.exports = {
  root: false,
  extends: ['../../.eslintrc.cjs'],
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['dist', 'coverage', 'node_modules', 'jest.config.ts'],
};
