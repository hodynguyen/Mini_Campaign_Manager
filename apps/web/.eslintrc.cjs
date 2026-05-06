/**
 * apps/web ESLint config — extends the locked root config.
 * Adds React + react-hooks rules. Vitest globals are exposed via `globals: true`
 * in vite.config.ts and types in tsconfig; no extra ESLint env needed.
 */
module.exports = {
  root: false,
  extends: [
    '../../.eslintrc.cjs',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  settings: {
    react: { version: 'detect' },
  },
  env: {
    browser: true,
    es2022: true,
  },
  rules: {
    // react-jsx automatic runtime — no need to import React in scope.
    'react/react-in-jsx-scope': 'off',
    // We rely on TS prop types; PropTypes are not used.
    'react/prop-types': 'off',
  },
  ignorePatterns: ['dist', 'node_modules', 'coverage', '*.config.ts', '*.config.cjs'],
};
