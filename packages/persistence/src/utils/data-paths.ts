/**
 * Data Directory Path Utilities
 *
 * Provides environment-aware data file paths for test isolation.
 * Tests use separate data directory to avoid interfering with local development.
 *
 * Usage:
 *   import { getDataPath } from './utils/data-paths.js';
 *   const sessionFile = getDataPath('mcp-sessions.json');
 *
 * Environment behavior:
 *   - NODE_ENV=test:        ./data/test/mcp-sessions.json
 *   - NODE_ENV=development: ./data/mcp-sessions.json
 *   - NODE_ENV=production:  ./data/mcp-sessions.json
 *
 * Benefits:
 *   - Test isolation: Tests don't corrupt local development data
 *   - Clean slate: Each test run starts fresh
 *   - No cleanup needed: Tests write to separate directory
 */

/**
 * Get the base data directory based on environment
 */
export function getDataDir(): string {
  const isTest = process.env.NODE_ENV === 'test';
  return isTest ? './data/test' : './data';
}

/**
 * Get full path to a data file, accounting for test environment
 *
 * @param filename - The data file name (e.g., 'mcp-sessions.json')
 * @returns Full path to data file
 *
 * @example
 * ```typescript
 * const sessionFile = getDataPath('mcp-sessions.json');
 * // Test env:  './data/test/mcp-sessions.json'
 * // Other env: './data/mcp-sessions.json'
 * ```
 */
export function getDataPath(filename: string): string {
  const dataDir = getDataDir();
  return `${dataDir}/${filename}`;
}
