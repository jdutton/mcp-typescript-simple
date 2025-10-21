/**
 * Environment Variable Preservation Helper
 *
 * Prevents environment variable pollution between tests by capturing
 * and restoring the original process.env state.
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
