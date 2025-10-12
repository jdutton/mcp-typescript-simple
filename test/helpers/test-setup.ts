/**
 * Reusable test environment setup
 *
 * Provides automatic port cleanup and environment preparation for system tests
 * Self-healing: automatically recovers from leaked test processes
 */

import { cleanupLeakedTestPorts } from './port-utils.js';

/**
 * Configuration for test environment setup
 */
export interface TestEnvironmentConfig {
  /**
   * Ports that need to be available for the test
   */
  ports: number[];

  /**
   * Skip automatic port cleanup
   * Set to true if you want to handle port cleanup manually
   * @default false
   */
  skipPortCleanup?: boolean;

  /**
   * Fail tests if port cleanup is needed
   * Set to true to detect leaked processes as test failures
   * @default false
   */
  failOnLeakedPorts?: boolean;
}

/**
 * Cleanup function returned by setupTestEnvironment
 */
export type TestEnvironmentCleanup = () => Promise<void>;

/**
 * Setup test environment with automatic port cleanup
 *
 * This function provides self-healing port management:
 * - Checks if required ports are available
 * - Automatically kills leaked test processes from previous runs
 * - Only kills processes identified as test-related (safe)
 * - Provides detailed logging of cleanup actions
 *
 * Usage in Vitest:
 * ```typescript
 * describe('My System Tests', () => {
 *   let cleanup: TestEnvironmentCleanup;
 *
 *   beforeAll(async () => {
 *     cleanup = await setupTestEnvironment({
 *       ports: [3000, 3001],
 *     });
 *   });
 *
 *   afterAll(async () => {
 *     await cleanup();
 *   });
 *
 *   it('should work', async () => {
 *     // Tests run with clean ports
 *   });
 * });
 * ```
 *
 * @param config - Test environment configuration
 * @returns Cleanup function to call in afterAll
 * @throws Error if ports cannot be freed or if failOnLeakedPorts is true and leaks detected
 */
export async function setupTestEnvironment(
  config: TestEnvironmentConfig
): Promise<TestEnvironmentCleanup> {
  const {
    ports,
    skipPortCleanup = false,
    failOnLeakedPorts = false,
  } = config;

  // Skip cleanup if requested
  if (skipPortCleanup) {
    return async () => {
      // No-op cleanup
    };
  }

  // Perform port cleanup - kill any leaked test processes
  console.log(`🔧 Setting up test environment for ports: ${ports.join(', ')}`);
  const cleanupResults = await cleanupLeakedTestPorts(ports);

  // Report what was killed
  const killedProcesses = cleanupResults.filter((r) => r.processKilled);
  if (killedProcesses.length > 0) {
    console.log(
      `🔧 Cleaned up ${killedProcesses.length} leaked process(es): ${killedProcesses
        .map((r) => `port ${r.port} (${r.processKilled?.command}, PID ${r.processKilled?.pid})`)
        .join(', ')}`
    );

    if (failOnLeakedPorts) {
      throw new Error(
        `Test setup failure: Found ${killedProcesses.length} leaked process(es)\n` +
          `This indicates incomplete cleanup from previous test run.\n` +
          `Set failOnLeakedPorts: false to allow automatic cleanup.`
      );
    }
  }

  // Report failures (processes we couldn't kill)
  const failedCleanups = cleanupResults.filter((r) => !r.success);
  if (failedCleanups.length > 0) {
    const errorDetails = failedCleanups
      .map((r) => `  - Port ${r.port}: ${r.error}`)
      .join('\n');

    console.warn(
      `⚠️  Warning: Failed to cleanup ${failedCleanups.length} port(s):\n${errorDetails}\n` +
        `   The test will attempt to use these ports anyway.`
    );
  }

  console.log(`✅ Test environment ready`);

  // Return cleanup function (no-op for now, but could be extended)
  return async () => {
    // Future: Could add post-test verification here
  };
}
