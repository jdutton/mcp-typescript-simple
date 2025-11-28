import eslint from '@eslint/js';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import importPlugin from 'eslint-plugin-import';
import security from 'eslint-plugin-security';
import pluginNode from 'eslint-plugin-n';

export default [
  eslint.configs.recommended,
  sonarjs.configs.recommended,
  security.configs.recommended,
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
      security,
      n: pluginNode,
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

      // SonarJS rules - HIGH VALUE (warn in tests for visibility without blocking)
      'sonarjs/no-ignored-exceptions': 'warn', // Empty catch blocks common in tests for expected failures
      'sonarjs/assertions-in-tests': 'warn', // Some tests validate side effects, not return values
      'sonarjs/updated-loop-counter': 'error', // Prevent infinite loops/bugs (still error)
      'sonarjs/no-unused-vars': 'warn', // Covered by @typescript-eslint/no-unused-vars

      // SonarJS rules - LOW VALUE (disable for tests)
      'sonarjs/no-dead-store': 'off', // Test setup often assigns for clarity
      'sonarjs/os-command': 'off',
      'sonarjs/no-os-command-from-path': 'off',
      'sonarjs/no-nested-functions': 'off', // Common in describe/it blocks
      'sonarjs/no-nested-template-literals': 'off',
      'sonarjs/slow-regex': 'off',
      'sonarjs/cognitive-complexity': 'off', // Test readability > complexity
      'sonarjs/no-nested-conditional': 'off', // Complex test setup sometimes needs nested conditionals
      'sonarjs/no-hardcoded-passwords': 'off', // Test fixtures need test credentials
      'sonarjs/no-hardcoded-secrets': 'off', // Test fixtures need test secrets
      'sonarjs/pseudo-random': 'off', // Math.random() fine for test data
      'sonarjs/no-empty-test-file': 'off', // Placeholder test files during development
      'sonarjs/no-clear-text-protocols': 'off', // Tests use http://localhost
      'sonarjs/todo-tag': 'off', // TODOs in tests are useful for tracking coverage
      'sonarjs/unused-import': 'off', // Covered by @typescript-eslint/no-unused-vars
      'sonarjs/no-identical-functions': 'off', // Test helper functions intentionally duplicated
      'sonarjs/publicly-writable-directories': 'off', // Tests use /tmp for temporary files
      'sonarjs/no-unused-collection': 'off', // Test data setup may create collections for side effects

      // Code quality - ERROR in tests (autofix removes unused imports)
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

      // Security - relaxed for tests
      'security/detect-child-process': 'off', // Tests execute commands
      'security/detect-non-literal-fs-filename': 'off', // Tests use temp paths
      'security/detect-object-injection': 'off', // TypeScript type safety covers this

      // Import rules - HIGH VALUE (catch duplicate imports)
      'import/no-duplicates': 'error',

      // Unicorn rules - HIGH VALUE (enforce in tests)
      'unicorn/prefer-node-protocol': 'error', // Modern Node.js best practice

      // Unicorn rules - LOW VALUE (disable for tests)
      'unicorn/no-array-for-each': 'off', // .forEach() is readable in tests
      'unicorn/no-useless-undefined': 'off', // Explicit undefined in test data is intentional
      'unicorn/prefer-top-level-await': 'off', // Test frameworks handle async differently
      'unicorn/prefer-number-properties': 'off', // Not worth the churn in tests
      'unicorn/throw-new-error': 'off',
      'unicorn/prefer-module': 'off',
      'unicorn/prefer-ternary': 'off',
      'unicorn/prefer-string-raw': 'off',

      // Security - check legitimate issues but allow test exceptions
      'security/detect-unsafe-regex': 'warn', // Check but don't block on test regex
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
      security,
      n: pluginNode,
    },
    rules: {
      // TypeScript core rules - STRICT
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // TypeScript async/promise safety - STRICT
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // Modern JavaScript patterns
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

      // Security - CRITICAL vulnerability detection
      'security/detect-child-process': 'error',
      'security/detect-non-literal-fs-filename': 'warn', // Can be noisy but important
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'error', // CRITICAL: ReDoS vulnerability
      'security/detect-buffer-noassert': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-object-injection': 'off', // TypeScript type safety covers this

      // Node.js best practices
      'n/no-path-concat': 'error', // Prevents path.join issues

      // Import rules
      'import/no-duplicates': 'error',

      // SonarJS rules - STRICT enforcement
      'sonarjs/no-ignored-exceptions': 'error',
      'sonarjs/no-control-regex': 'error',
      'sonarjs/no-redundant-jump': 'error',
      'sonarjs/updated-loop-counter': 'error',
      'sonarjs/no-nested-template-literals': 'error',
      'sonarjs/no-nested-functions': 'error',
      'sonarjs/no-nested-conditional': 'error',
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/slow-regex': 'warn',
      'sonarjs/duplicates-in-character-class': 'error',
      'sonarjs/prefer-single-boolean-return': 'error',
      'sonarjs/no-unused-vars': 'warn',

      // Unicorn rules - modern JavaScript best practices
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prefer-number-properties': 'error',
      'unicorn/throw-new-error': 'error',
      'unicorn/prefer-module': 'error',
      'unicorn/prefer-top-level-await': 'error',
      'unicorn/no-array-for-each': 'error',
      'unicorn/no-useless-undefined': 'error',
      'unicorn/prefer-ternary': 'off', // Can reduce readability
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
      security,
      n: pluginNode,
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

      // Security - relaxed for tools
      'security/detect-child-process': 'off', // Tools spawn processes
      'security/detect-non-literal-fs-filename': 'off', // Tools use dynamic paths
      'security/detect-object-injection': 'off',

      // Import rules
      'import/no-duplicates': 'error',

      // SonarJS rules - more lenient for tools
      'sonarjs/cognitive-complexity': ['warn', 30],
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/no-os-command-from-path': 'off', // Tools spawn processes
      'sonarjs/no-ignored-exceptions': 'error', // Still require proper error handling
      '@typescript-eslint/no-unsafe-function-type': 'off',

      // Node.js rules
      'n/no-path-concat': 'error',

      // Unicorn rules for tools
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prefer-number-properties': 'error',
      'unicorn/no-array-for-each': 'error',
    },
  },
  {
    // Tools JavaScript files - same rules as TypeScript tools
    files: ['tools/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        NodeJS: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
      },
    },
    plugins: {
      unicorn,
      import: importPlugin,
      security,
      n: pluginNode,
    },
    rules: {
      // Core JavaScript rules
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': 'off', // Tools use console for output

      // Security - relaxed for tools
      'security/detect-child-process': 'off', // Tools spawn processes
      'security/detect-non-literal-fs-filename': 'off', // Tools use dynamic paths
      'security/detect-object-injection': 'off',

      // Import rules
      'import/no-duplicates': 'error',

      // SonarJS rules - catch issues
      'sonarjs/cognitive-complexity': ['warn', 30],
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/no-os-command-from-path': 'off', // Tools spawn processes
      'sonarjs/no-ignored-exceptions': 'error',

      // Node.js rules
      'n/no-path-concat': 'error',

      // Unicorn rules
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prefer-number-properties': 'error',
      'unicorn/no-array-for-each': 'error',
      'unicorn/prefer-top-level-await': 'error',
      'unicorn/throw-new-error': 'error',
    },
  },
  {
    ignores: [
      'build/**',
      'dist/**',
      'coverage/**',
      'node_modules/**',
      '*.config.js', // Root config files (vitest, eslint, etc)
      '**/*.d.ts',
      'packages/*/vitest.config.ts',
      'vitest.*.config.ts',
    ],
  },
];
