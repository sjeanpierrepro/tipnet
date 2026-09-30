import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'archive/'] },
  js.configs.recommended,
  { rules: { 'no-unused-vars': ['error', { caughtErrors: 'none', ignoreRestSiblings: true }] } },
  {
    files: ['app/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } },
  },
  {
    files: ['app/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ['tests/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ['proxy/**/*.js', 'integrations/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.serviceworker },
    },
  },
];
