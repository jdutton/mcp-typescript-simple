import eslint from '@eslint/js';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import importPlugin from 'eslint-plugin-import';

export default [
  eslint.configs.recommended,
  sonarjs.configs.recommended,
  {
    // Test files - disable type-aware linting (test files excluded from tsconfig)
    files: ['**/*.test.ts', '**/test/**/*.ts', '**/test-*.ts', '**/tests/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: false, // Test files excluded from tsconfig
      },
      globals: {
        NodeJS: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
      unicorn,
      import: importPlugin,
    },
    rules: {
      // Disable type-aware rules for test files
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',

      // Relaxed rules for test files
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-undef': 'off',

      // SonarJS rules - relaxed for tests
      'sonarjs/no-ignored-exceptions': 'error', // Still enforce (use // NOSONAR with explanation)
      'sonarjs/os-command': 'off',
      'sonarjs/no-os-command-from-path': 'off',
      'sonarjs/no-nested-functions': 'off', // Common in describe/it blocks
      'sonarjs/no-nested-template-literals': 'off',
      'sonarjs/slow-regex': 'off',
      'sonarjs/cognitive-complexity': ['warn', 20], // Higher threshold for tests

      // Strict on code quality
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // Import rules - catch duplicate imports (✅ catches SonarQube issues)
      'import/no-duplicates': 'error',

      // Unicorn rules - modern JavaScript
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prefer-number-properties': 'error',
      'unicorn/throw-new-error': 'error',
      'unicorn/prefer-module': 'error',
      'unicorn/prefer-top-level-await': 'error',
      'unicorn/no-array-for-each': 'error',
      'unicorn/no-useless-undefined': 'error',
      'unicorn/prefer-ternary': 'off',
      'unicorn/prefer-string-raw': 'error',
    },
  },
  {
    // Production TypeScript files (type-aware linting enabled)
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['**/*.test.ts', '**/test/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: true, // Enable type-aware linting
      },
      globals: {
        NodeJS: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
      unicorn,
      import: importPlugin,
    },
    rules: {
      // TypeScript core rules
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // TypeScript async/promise safety
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // Modern JavaScript patterns (catches SonarQube nullish coalescing issues)
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',

      // General rules
      'no-console': 'off', // Allow console in production code (used by tools)
      'no-undef': 'off', // TypeScript handles this
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // Import rules - catch duplicate imports (✅ catches SonarQube issues)
      'import/no-duplicates': 'error',

      // SonarJS rules - active enforcement (catches majority of SonarQube issues)
      'sonarjs/no-ignored-exceptions': 'error', // ✅ Catches 11 SonarQube issues
      'sonarjs/no-control-regex': 'error',
      'sonarjs/no-redundant-jump': 'error',
      'sonarjs/updated-loop-counter': 'error',
      'sonarjs/no-nested-template-literals': 'error',
      'sonarjs/no-nested-functions': 'error', // ✅ Catches 3 SonarQube issues (nesting depth)
      'sonarjs/no-nested-conditional': 'error', // ✅ Catches 1 SonarQube issue (nested ternary)
      'sonarjs/cognitive-complexity': ['error', 15], // ✅ Catches 1 SonarQube issue (complexity 21→15)
      'sonarjs/slow-regex': 'warn',
      'sonarjs/duplicates-in-character-class': 'error',
      'sonarjs/prefer-single-boolean-return': 'error',
      'sonarjs/no-unused-vars': 'warn',

      // Unicorn rules - modern JavaScript best practices
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prefer-number-properties': 'error', // ✅ Catches 2 SonarQube issues (Number.parseInt)
      'unicorn/throw-new-error': 'error',
      'unicorn/prefer-module': 'error',
      'unicorn/prefer-top-level-await': 'error',
      'unicorn/no-array-for-each': 'error', // ✅ Catches 1 SonarQube issue (forEach→for...of)
      'unicorn/no-useless-undefined': 'error',
      'unicorn/prefer-ternary': 'off',
      'unicorn/prefer-string-raw': 'error',
    },
  },
  {
    // Tools scripts - relaxed linting (MUST disable type-aware rules)
    files: ['tools/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: false, // No type-aware linting for tools
      },
      globals: {
        NodeJS: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
      unicorn,
      import: importPlugin,
    },
    rules: {
      // Disable type-aware rules inherited from sonarjs.configs.recommended
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',

      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': 'off', // Tools use console for output

      // Import rules - catch duplicate imports (✅ catches SonarQube issues)
      'import/no-duplicates': 'error',

      // SonarJS rules - more lenient for tools
      'sonarjs/cognitive-complexity': ['warn', 30],
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/no-os-command-from-path': 'off', // Tools spawn processes
      'sonarjs/no-ignored-exceptions': 'error', // Still require proper error handling
      '@typescript-eslint/no-unsafe-function-type': 'off',

      // Unicorn rules for tools
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prefer-number-properties': 'error',
      'unicorn/no-array-for-each': 'error',
    },
  },
  {
    ignores: [
      'build/**',
      'dist/**',
      'coverage/**',
      'node_modules/**',
      '*.js',
      '**/*.d.ts',
      'packages/*/vitest.config.ts',
      'vitest.*.config.ts',
    ],
  },
];
