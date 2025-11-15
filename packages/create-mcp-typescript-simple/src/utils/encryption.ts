import { randomBytes } from 'node:crypto';

/**
 * Generate a unique 32-byte base64-encoded encryption key for TOKEN_ENCRYPTION_KEY
 *
 * This key is used by the MCP server for encrypting tokens stored in Redis.
 * Each scaffolded project gets a unique key to ensure security isolation.
 *
 * @returns Base64-encoded 32-byte encryption key
 *
 * @example
 * const key = generateEncryptionKey();
 * // => "zJ8kL2mN4pQ6rS8tU0vW1xY3zA5bC7dE9fG1hI3jK5mL7nO9pQ=="
 */
export function generateEncryptionKey(): string {
  // Generate 32 random bytes (256 bits)
  const buffer = randomBytes(32);

  // Encode as base64
  return buffer.toString('base64');
}

/**
 * Validate that an encryption key meets the requirements
 *
 * Requirements:
 * - Must be base64-encoded
 * - Must decode to exactly 32 bytes
 *
 * @param key - Encryption key to validate
 * @returns True if valid, false otherwise
 */
export function validateEncryptionKey(key: string): boolean {
  try {
    // Decode from base64
    const buffer = Buffer.from(key, 'base64');

    // Must be exactly 32 bytes
    return buffer.length === 32;
  } catch {
    return false;
  }
}
