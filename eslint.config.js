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
        ecmaVersion: 2020,
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
        ecmaVersion: 2020,
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
    ignores: ['build/**', 'node_modules/**', '*.js']
  }
];