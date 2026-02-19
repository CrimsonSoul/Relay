import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

// Shared parser options for all TypeScript files
const sharedParserOptions = {
  ecmaFeatures: { jsx: true },
  ecmaVersion: 'latest',
  sourceType: 'module',
  project: ['./tsconfig.json', './tsconfig.renderer.json', './tsconfig.node.json'],
  tsconfigRootDir: import.meta.dirname,
};

// Shared TypeScript rules applied to all source files
const sharedTsRules = {
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': [
    'warn',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    },
  ],
  '@typescript-eslint/explicit-function-return-type': 'off',
  '@typescript-eslint/explicit-module-boundary-types': 'off',
  '@typescript-eslint/strict-boolean-expressions': 'off',
};

// Shared React + hooks rules
const sharedReactRules = {
  'react/react-in-jsx-scope': 'off',
  'react/prop-types': 'off',
  'react-hooks/rules-of-hooks': 'error',
  'react-hooks/exhaustive-deps': 'warn',
};

// Shared promise safety rules
const promiseRules = {
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
};

// React + hooks plugins bundle
const reactPlugins = {
  '@typescript-eslint': tseslint,
  react,
  'react-hooks': reactHooks,
};

const reactSettings = { react: { version: 'detect' } };

export default [
  {
    ignores: [
      'dist',
      'build',
      'node_modules',
      '*.config.js',
      '*.config.ts',
      'coverage',
      'playwright-report',
      'test-results',
      'docs',
      'src/renderer/test/setup.ts',
    ],
  },
  js.configs.recommended,

  // Main process
  {
    files: ['src/main/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: sharedParserOptions,
      globals: { ...globals.node, Electron: 'readonly', NodeJS: 'readonly' },
    },
    plugins: reactPlugins,
    settings: reactSettings,
    rules: {
      ...sharedTsRules,
      ...sharedReactRules,
      ...promiseRules,
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Preload
  {
    files: ['src/preload/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: sharedParserOptions,
      globals: { ...globals.node, ...globals.browser, Electron: 'readonly', NodeJS: 'readonly' },
    },
    plugins: reactPlugins,
    settings: reactSettings,
    rules: {
      ...sharedTsRules,
      ...promiseRules,
      '@typescript-eslint/no-explicit-any': 'error',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Shared
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: sharedParserOptions,
      globals: { ...globals.nodeBuiltin },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...sharedTsRules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'off',
    },
  },

  // Renderer
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: sharedParserOptions,
      globals: { ...globals.browser, React: 'readonly', Electron: 'readonly' },
    },
    plugins: { ...reactPlugins, 'jsx-a11y': jsxA11y },
    settings: reactSettings,
    rules: {
      ...sharedTsRules,
      ...sharedReactRules,
      ...promiseRules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'jsx-a11y/no-autofocus': 'off', // Intentional in modal/search UX with useFocusTrap
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Scripts
  {
    files: ['scripts/**/*.{mjs,js}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // Tests
  {
    files: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/*.spec.ts',
      'src/**/*.spec.tsx',
      'tests/**/*.ts',
      'tests/e2e/**/*.{ts,tsx}',
      '**/__tests__/**/*',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        NodeJS: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    plugins: reactPlugins,
    settings: reactSettings,
    rules: {
      ...sharedTsRules,
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
