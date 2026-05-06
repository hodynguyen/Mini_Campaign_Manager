/**
 * Root ESLint config — shared base for all workspaces.
 *
 * Workspace-specific rules (e.g. React, vitest globals, jest globals)
 * live in each workspace's own .eslintrc.cjs and extend this file.
 *
 * Stack: ESLint 8.x (legacy config, NOT flat config) + @typescript-eslint 7.x.
 */
module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  rules: {
    // Practical tightening for a 4-8h assignment — keep the noise down.
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/consistent-type-imports': [
      'warn',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],
    'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    'eqeqeq': ['error', 'always', { null: 'ignore' }],
    'prefer-const': 'error',
  },
  ignorePatterns: [
    'node_modules',
    'dist',
    'build',
    'coverage',
    '*.config.js',
    '*.config.cjs',
    '*.config.ts',
    '*.config.mjs',
  ],
};
