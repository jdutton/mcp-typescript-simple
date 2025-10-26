/**
 * Test helper for creating TokenEncryptionService instances
 *
 * Provides a consistent way to create encryption services for tests
 * using a deterministic test key.
 */

import { randomBytes } from 'crypto';
import { TokenEncryptionService } from '../../src/encryption/index.js';

/**
 * Test encryption key (base64-encoded 32 bytes)
 * Generated once for consistent test behavior
 */
const TEST_ENCRYPTION_KEY = randomBytes(32).toString('base64');

/**
 * Creates a TokenEncryptionService instance for testing
 *
 * Uses a consistent test encryption key to ensure deterministic behavior
 * across test runs.
 *
 * @returns TokenEncryptionService instance configured for testing
 */
export function createTestEncryptionService(): TokenEncryptionService {
  return new TokenEncryptionService({
    encryptionKey: TEST_ENCRYPTION_KEY,
  });
}

/**
 * Gets the test encryption key (for advanced test scenarios)
 *
 * @returns Base64-encoded encryption key
 */
export function getTestEncryptionKey(): string {
  return TEST_ENCRYPTION_KEY;
}
