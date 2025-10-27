import typescriptEslint from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  {
    files: ['src/**/*.ts', 'packages/**/src/**/*.ts'],
    ignores: [
      'src/observability/**/*.ts', // Observability infrastructure uses console for bootstrap logging
      'src/utils/logger.ts', // Logger infrastructure file
      'packages/tools-llm/src/utils/logger.ts' // Package-internal simple logger
    ],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json'
      }
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
      'sonarjs': sonarjs
    },
    rules: {
      ...typescriptEslint.configs['recommended'].rules,
      ...sonarjs.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': 'error', // No console methods allowed - use structured logger instead
      // SonarJS shift-left rules
      'sonarjs/cognitive-complexity': ['error', 15], // Enforce cognitive complexity limit
      'sonarjs/no-duplicate-string': 'error', // Prevent string duplication
      'sonarjs/no-identical-functions': 'error', // Prevent function duplication
      'sonarjs/no-collapsible-if': 'error', // Simplify nested if statements
      'sonarjs/no-redundant-boolean': 'error' // Simplify boolean expressions
    }
  },
  {
    files: ['test/**/*.ts', '**/*.test.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.test.json'
      }
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
      'sonarjs': sonarjs
    },
    rules: {
      ...typescriptEslint.configs['recommended'].rules,
      ...sonarjs.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', {
        'argsIgnorePattern': '^_',
        'varsIgnorePattern': '^_',
        'destructuredArrayIgnorePattern': '^_'
      }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      // SonarJS shift-left rules (relaxed for tests)
      'sonarjs/cognitive-complexity': ['warn', 20], // More lenient for tests
      'sonarjs/no-duplicate-string': 'warn', // Warn only in tests
      'sonarjs/no-identical-functions': 'warn' // Warn only in tests
    }
  },
  {
    files: ['tools/**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module'
        // No project option - tools are standalone scripts
      }
    },
    plugins: {
      '@typescript-eslint': typescriptEslint,
      'sonarjs': sonarjs
    },
    rules: {
      ...typescriptEslint.configs['recommended'].rules,
      ...sonarjs.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', {
        'argsIgnorePattern': '^_',
        'varsIgnorePattern': '^_',
        'caughtErrorsIgnorePattern': '^_' // Allow unused catch parameters with _ prefix
      }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': 'off', // Tools can use console.log for output
      // SonarJS shift-left rules (relaxed for utility scripts)
      'sonarjs/cognitive-complexity': ['warn', 30], // More lenient for tools
      'sonarjs/no-duplicate-string': 'off', // Don't enforce in tools
      'sonarjs/no-identical-functions': 'warn', // Warn only in tools
      'sonarjs/no-os-command-from-path': 'off', // Tools spawn processes (legitimate use)
      'sonarjs/no-ignored-exceptions': 'off', // Tools have simple error handling
      '@typescript-eslint/no-unsafe-function-type': 'off' // Tools can use Function type
    }
  },
  {
    ignores: [
      'build/**',
      'node_modules/**',
      '*.js'
    ]
  }
];