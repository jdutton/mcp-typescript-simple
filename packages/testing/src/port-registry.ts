/**
 * Centralized Port Registry for Test Infrastructure
 *
 * Single source of truth for ALL port assignments across the entire test suite.
 * Ensures DRY principles and makes port tracking audit-friendly.
 *
 * Design principles:
 * 1. All ports defined in ONE place
 * 2. Type-safe port constants
 * 3. Environment-aware port selection
 * 4. Automatic port enumeration for cleanup
 * 5. Clear documentation of port ownership
 */

/**
 * Port definitions for all test environments
 * Each port is assigned to a specific purpose/test suite
 */
export const TEST_PORTS = {
  /**
   * Default HTTP server port
   * Used by: Integration tests, default test environment
   */
  DEFAULT_HTTP: 3000,

  /**
   * Alternative HTTP server port
   * Used by: System tests (express, stdio), http-client default
   */
  ALTERNATIVE_HTTP: 3001,

  /**
   * Headless browser test server port
   * Used by: Playwright headless tests (mcp-inspector-headless*.test.ts)
   */
  HEADLESS_TEST: 3555,

  /**
   * Mock OAuth server port
   * Used by: Playwright OAuth flow testing
   */
  MOCK_OAUTH: 4001,

  /**
   * MCP Inspector main port
   * Used by: MCP Inspector UI in headless tests
   */
  INSPECTOR: 16274,

  /**
   * MCP Inspector proxy port
   * Used by: MCP Inspector proxy server (INSPECTOR + 3)
   */
  INSPECTOR_PROXY: 16277,
} as const;

/**
 * Type for test environment names
 * Matches TEST_ENV environment variable values
 */
export type TestEnvironment = 'express' | 'express:ci' | 'stdio';

/**
 * Get all ports used by a specific test environment
 * Ensures self-healing cleanup knows which ports to check
 *
 * @param env - Test environment name
 * @returns Array of port numbers used by that environment
 *
 * @example
 * ```typescript
 * // In beforeAll hook
 * const ports = getEnvironmentPorts('express');
 * await cleanupLeakedTestPorts(ports);
 * ```
 */
export function getEnvironmentPorts(env: TestEnvironment): number[] {
  switch (env) {
    case 'express':
      return [TEST_PORTS.DEFAULT_HTTP];

    case 'express:ci':
      return [TEST_PORTS.ALTERNATIVE_HTTP];

    case 'stdio':
      return [TEST_PORTS.ALTERNATIVE_HTTP];
  }
}

/**
 * Get all ports used by headless browser tests
 * These tests run a full MCP server + Inspector + Mock OAuth
 *
 * @returns Array of all headless test port numbers
 *
 * @example
 * ```typescript
 * // In headless test beforeAll
 * const ports = getHeadlessPorts();
 * await cleanupLeakedTestPorts(ports);
 * ```
 */
export function getHeadlessPorts(): number[] {
  return [
    TEST_PORTS.HEADLESS_TEST,
    TEST_PORTS.INSPECTOR,
    TEST_PORTS.INSPECTOR_PROXY,
    TEST_PORTS.MOCK_OAUTH,
  ];
}

/**
 * Get ALL ports that might be used during testing
 * For comprehensive cleanup and port availability checking
 *
 * @returns Array of all test port numbers
 *
 * @example
 * ```typescript
 * // Pre-flight check before starting test suite
 * const allPorts = getAllTestPorts();
 * await checkPortsAvailable(allPorts);
 * ```
 */
export function getAllTestPorts(): number[] {
  return Object.values(TEST_PORTS);
}

/**
 * Get port for HTTP test client based on environment
 * Matches the logic in http-client.ts and vitest-global-setup.ts
 *
 * @returns Port number for HTTP test client
 *
 * @example
 * ```typescript
 * // In HTTPTestClient constructor
 * const port = options.port || getHTTPTestPort();
 * ```
 */
export function getHTTPTestPort(): number {
  const envPort = process.env.HTTP_TEST_PORT;
  if (envPort) {
    return Number.parseInt(envPort, 10);
  }
  return TEST_PORTS.ALTERNATIVE_HTTP;
}

/**
 * Check if a port is registered in the port registry
 * Useful for auditing and validation
 *
 * @param port - Port number to check
 * @returns true if port is in registry
 *
 * @example
 * ```typescript
 * if (!isRegisteredPort(3000)) {
 *   console.warn('Unregistered port 3000 in use!');
 * }
 * ```
 */
export function isRegisteredPort(port: number): boolean {
  return getAllTestPorts().includes(port);
}

/**
 * Get human-readable description of a port's purpose
 * Useful for logging and debugging
 *
 * @param port - Port number
 * @returns Description of port's purpose, or 'Unknown' if not registered
 *
 * @example
 * ```typescript
 * console.log(`Cleaning up port ${port}: ${getPortDescription(port)}`);
 * ```
 */
export function getPortDescription(port: number): string {
  switch (port) {
    case TEST_PORTS.DEFAULT_HTTP:
      return 'Default HTTP server (integration tests)';
    case TEST_PORTS.ALTERNATIVE_HTTP:
      return 'Alternative HTTP server (system tests)';
    case TEST_PORTS.HEADLESS_TEST:
      return 'Headless browser test server';
    case TEST_PORTS.MOCK_OAUTH:
      return 'Mock OAuth server';
    case TEST_PORTS.INSPECTOR:
      return 'MCP Inspector UI';
    case TEST_PORTS.INSPECTOR_PROXY:
      return 'MCP Inspector proxy';
    default:
      return 'Unknown';
  }
}
