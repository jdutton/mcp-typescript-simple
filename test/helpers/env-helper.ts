/**
 * Environment Variable Preservation Helper
 *
 * Prevents environment variable pollution between tests by capturing
 * and restoring the original process.env state.
 *
 * Usage:
 * ```typescript
 * import { preserveEnv } from '../helpers/env-helper.js';
 *
 * describe('My Tests', () => {
 *   let restoreEnv: () => void;
 *
 *   beforeEach(() => {
 *     restoreEnv = preserveEnv();
 *   });
 *
 *   afterEach(() => {
 *     restoreEnv();
 *   });
 *
 *   it('can modify process.env safely', () => {
 *     process.env.TEST_VAR = 'modified';
 *     // ... test code
 *     // restoreEnv() will reset TEST_VAR automatically
 *   });
 * });
 * ```
 */

/**
 * Captures the current state of process.env and returns a function to restore it.
 *
 * @returns A function that restores process.env to its captured state
 */
export function preserveEnv(): () => void {
  // Create a deep copy of process.env to avoid reference issues
  const original = { ...process.env };

  return () => {
    // Clear all current env vars
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }

    // Restore original env vars
    for (const [key, value] of Object.entries(original)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }
  };
}

/**
 * Alternative implementation using Object.assign for more efficient restoration.
 * Use this if you're certain no new env vars are added during tests.
 *
 * @returns A function that restores process.env to its captured state
 */
export function preserveEnvSimple(): () => void {
  const original = { ...process.env };
  return () => {
    Object.assign(process.env, original);
  };
}
