import type { ProjectConfig } from '../types.js';

/**
 * Current framework version (updated by bump-version tool)
 */
export const FRAMEWORK_VERSION = '0.9.0-rc.9';

/**
 * Get package dependencies (full-featured, always includes everything)
 */
export function getDependencies(_config: ProjectConfig): Record<string, string> {
  return {
    // Core MCP SDK
    '@modelcontextprotocol/sdk': '^1.18.0',

    // Framework packages (full-featured)
    '@mcp-typescript-simple/config': `^${FRAMEWORK_VERSION}`,
    '@mcp-typescript-simple/observability': `^${FRAMEWORK_VERSION}`,
    '@mcp-typescript-simple/server': `^${FRAMEWORK_VERSION}`,
    '@mcp-typescript-simple/tools': `^${FRAMEWORK_VERSION}`,
    '@mcp-typescript-simple/http-server': `^${FRAMEWORK_VERSION}`,
    '@mcp-typescript-simple/auth': `^${FRAMEWORK_VERSION}`,
    '@mcp-typescript-simple/tools-llm': `^${FRAMEWORK_VERSION}`,
    '@mcp-typescript-simple/example-tools-basic': `^${FRAMEWORK_VERSION}`,
    '@mcp-typescript-simple/example-tools-llm': `^${FRAMEWORK_VERSION}`,

    // LLM provider SDKs (gracefully degrade without API keys)
    '@anthropic-ai/sdk': '^0.63.0',
    'openai': '^5.21.0',
    '@google/generative-ai': '^0.24.1',

    // Redis client (for session storage)
    'ioredis': '^5.3.2',

    // OpenTelemetry (observability)
    '@opentelemetry/api': '^1.9.0',
    '@opentelemetry/api-logs': '^0.56.0',

    // Pino logging (production dependencies - required by observability package)
    'pino-pretty': '^13.1.1',
    'pino-opentelemetry-transport': '^1.1.0',
  };
}

/**
 * Get dev dependencies for generated project
 */
export function getDevDependencies(): Record<string, string> {
  return {
    '@types/node': '^24.5.2',
    '@mcp-typescript-simple/testing': `^${FRAMEWORK_VERSION}`,
    '@vibe-validate/cli': '^0.16.0',
    'tsx': '^4.20.5',
    'typescript': '^5.9.2',
    'vitest': '^3.2.4',
    'axios': '^1.7.9', // For system tests
    'oauth2-mock-server': '^8.1.0', // For OAuth testing (used by @mcp-typescript-simple/testing)

    // Git hooks
    'husky': '^9.1.7',

    // ESLint dependencies
    'eslint': '^9.35.0',
    '@eslint/js': '^9.35.0',
    '@typescript-eslint/eslint-plugin': '^8.44.0',
    '@typescript-eslint/parser': '^8.44.0',
  };
}

/**
 * Get npm scripts for generated project
 */
export function getScripts(config: ProjectConfig): Record<string, string> {
  const { basePort } = config;
  const testPort1 = basePort + 1;
  const testPort2 = basePort + 2;

  return {
    // Setup
    'prepare': 'husky install',

    // Build and development
    'build': 'tsc',
    'dev:stdio': 'NODE_ENV=development MCP_DEV_SKIP_AUTH=true tsx src/index.ts',
    'dev:http': `NODE_ENV=development MCP_MODE=streamable_http HTTP_PORT=${basePort} MCP_DEV_SKIP_AUTH=true tsx src/index.ts`,
    'dev:oauth': `NODE_ENV=development MCP_MODE=streamable_http HTTP_PORT=${basePort} tsx --env-file=.env.oauth src/index.ts`,

    // Testing
    'test': 'vitest run',
    'test:unit': 'vitest run test/unit',
    'test:system': `HTTP_PORT=${basePort} HTTP_TEST_PORT=${testPort1} vitest run --config vitest.system.config.ts`,
    'test:system:stdio': 'TEST_ENV=stdio npm run test:system',
    'test:system:http': 'TEST_ENV=express npm run test:system',
    'test:system:ci': `TEST_ENV=express:ci HTTP_PORT=${basePort} HTTP_TEST_PORT=${testPort1} npm run test:system`,
    'test:ci': 'npm run test:unit && npm run test:system:ci',

    // Validation
    'validate': 'npx vibe-validate validate',
    'pre-commit': 'npx vibe-validate pre-commit',

    // Type checking and linting
    'typecheck': 'tsc --noEmit',
    'lint': 'eslint src/**/*.ts test/**/*.ts',
  };
}
