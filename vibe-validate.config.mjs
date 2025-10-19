/**
 * vibe-validate Configuration for mcp-typescript-simple
 *
 * Migrated from tools/validation-config.ts to use vibe-validate.
 * This configuration defines all validation steps for both local and CI validation.
 */

import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  // Extend the Node.js preset as base
  extends: 'typescript-nodejs',

  validation: {
    phases: [
      {
        name: 'Phase 1: Pre-Qualification + Build',
        parallel: true,
        steps: [
          {
            name: 'TypeScript type checking',
            command: 'npm run typecheck',
          },
          {
            name: 'ESLint code checking',
            command: 'npm run lint',
          },
          {
            name: 'OpenAPI validation',
            command: 'npm run test:openapi',
          },
          {
            name: 'Build',
            command: 'npm run build',
          },
          {
            name: 'Setup Playwright browsers',
            command: 'npx playwright install --with-deps chromium',
          },
        ],
      },
      {
        name: 'Phase 2: Testing',
        parallel: true,
        dependsOn: ['Phase 1: Pre-Qualification + Build'],
        steps: [
          {
            name: 'Unit tests',
            command: 'npm run test:unit',
          },
          {
            name: 'Integration tests',
            command: 'npm run test:integration',
          },
          {
            name: 'STDIO system tests',
            command: 'npm run test:system:stdio',
          },
          {
            name: 'HTTP system tests',
            command: 'npm run test:system:ci',
          },
          {
            name: 'Headless browser tests',
            command: 'npm run test:system:headless',
          },
        ],
      },
    ],

    // Enable git tree hash caching for faster repeat validations
    caching: {
      enabled: true,
      strategy: 'git-tree-hash',
    },
  },

  // Git configuration
  git: {
    mainBranch: 'main',
    autoSync: false, // Don't auto-merge, require manual merge
  },

  // Output format (auto-detects Claude Code, CI, etc.)
  output: {
    format: 'auto',
  },
});
