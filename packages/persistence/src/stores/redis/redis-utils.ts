/**
 * Shared Redis utility functions
 *
 * Common functionality used across all Redis store implementations
 * to eliminate code duplication.
 */

/**
 * Mask sensitive parts of Redis URL for logging
 *
 * Hides password in Redis URLs to prevent credential leakage in logs.
 *
 * @param url Redis connection URL
 * @returns Masked URL with password replaced by ***
 */
export function maskRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return 'redis://***';
  }
}
