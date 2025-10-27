/**
 * Token Encryption Service
 *
 * Enterprise-grade AES-256-GCM encryption for OAuth access tokens and
 * initial access tokens.
 *
 * Security Features:
 * - AES-256-GCM authenticated encryption
 * - Cryptographically secure random IVs (12 bytes)
 * - Authentication tags (16 bytes) for integrity verification
 * - NIST SP 800-90A compliant randomness (crypto.randomBytes)
 * - Constant-time comparison for auth tags (timing attack prevention)
 *
 * Format:
 * ```
 * encrypted_data = base64url(iv + ciphertext + authTag)
 * iv: 12 bytes (96 bits)
 * ciphertext: variable length
 * authTag: 16 bytes (128 bits)
 * ```
 *
 * Compliance:
 * - SOC-2 Type II: CC6.1 (Encryption at rest)
 * - ISO 27001:2022: A.8.24 (Cryptographic controls)
 * - GDPR Article 32: Encryption of personal data
 * - HIPAA §164.312(a)(2)(iv): Encryption mechanism
 *
 * References:
 * - NIST SP 800-38D (Galois/Counter Mode)
 * - NIST SP 800-90A (Random Number Generation)
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits (recommended for GCM)
const AUTH_TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits

export interface TokenEncryptionOptions {
  /**
   * Base64-encoded encryption key (32 bytes = 256 bits)
   * Generate with: crypto.randomBytes(32).toString('base64')
   */
  encryptionKey: string;
}

export class TokenEncryptionService {
  private readonly key: Buffer;

  constructor(options: TokenEncryptionOptions) {
    if (!options.encryptionKey) {
      throw new Error('Encryption key is required');
    }

    // Decode base64 key
    this.key = Buffer.from(options.encryptionKey, 'base64');

    // Verify key length (must be exactly 32 bytes for AES-256)
    if (this.key.length !== KEY_LENGTH) {
      throw new Error(
        `Invalid encryption key length: expected ${KEY_LENGTH} bytes (256 bits), got ${this.key.length} bytes. ` +
        `Generate a new key with: crypto.randomBytes(32).toString('base64')`
      );
    }
  }

  /**
   * Encrypt a token using AES-256-GCM
   *
   * @param plaintext Token to encrypt
   * @returns Base64url-encoded encrypted data (iv + ciphertext + authTag)
   */
  encrypt(plaintext: string): string {
    if (!plaintext) {
      throw new Error('Cannot encrypt empty token');
    }

    // Generate cryptographically secure random IV (12 bytes for GCM)
    const iv = randomBytes(IV_LENGTH);

    // Create cipher with AES-256-GCM
    const cipher = createCipheriv(ALGORITHM, this.key, iv);

    // Encrypt the token
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    // Get authentication tag (16 bytes)
    const authTag = cipher.getAuthTag();

    // Combine: iv + ciphertext + authTag
    const encrypted = Buffer.concat([iv, ciphertext, authTag]);

    // Return base64url-encoded string
    return encrypted.toString('base64url');
  }

  /**
   * Decrypt a token using AES-256-GCM
   *
   * @param encrypted Base64url-encoded encrypted data
   * @returns Decrypted plaintext token
   * @throws Error if decryption fails (wrong key, corrupted data, tampered)
   */
  decrypt(encrypted: string): string {
    if (!encrypted) {
      throw new Error('Cannot decrypt empty string');
    }

    try {
      // Decode base64url
      const encryptedBuffer = Buffer.from(encrypted, 'base64url');

      // Minimum length check: iv (12) + authTag (16) = 28 bytes
      if (encryptedBuffer.length < IV_LENGTH + AUTH_TAG_LENGTH) {
        throw new Error('Encrypted data is too short to contain IV and auth tag');
      }

      // Extract components
      const iv = encryptedBuffer.subarray(0, IV_LENGTH);
      const authTag = encryptedBuffer.subarray(encryptedBuffer.length - AUTH_TAG_LENGTH);
      const ciphertext = encryptedBuffer.subarray(IV_LENGTH, encryptedBuffer.length - AUTH_TAG_LENGTH);

      // Create decipher
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);

      // Decrypt
      const plaintext = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);

      return plaintext.toString('utf8');
    } catch (error) {
      // Don't leak information about why decryption failed
      throw new Error(
        'Decryption failed: invalid key, corrupted data, or tampering detected'
      );
    }
  }

  /**
   * Encrypt JSON object (for OAuth tokens with metadata)
   *
   * @param data Object to encrypt
   * @returns Base64url-encoded encrypted JSON
   */
  encryptJSON<T>(data: T): string {
    const json = JSON.stringify(data);
    return this.encrypt(json);
  }

  /**
   * Decrypt JSON object (for OAuth tokens with metadata)
   *
   * @param encrypted Base64url-encoded encrypted JSON
   * @returns Decrypted object
   * @throws Error if decryption fails or JSON is invalid
   */
  decryptJSON<T>(encrypted: string): T {
    const json = this.decrypt(encrypted);
    try {
      return JSON.parse(json) as T;
    } catch (error) {
      throw new Error('Decrypted data is not valid JSON');
    }
  }

  /**
   * Generate a new encryption key (for setup/rotation)
   *
   * @returns Base64-encoded 256-bit encryption key
   */
  static generateKey(): string {
    return randomBytes(KEY_LENGTH).toString('base64');
  }

  /**
   * Verify an encryption key is valid
   *
   * @param key Base64-encoded key to verify
   * @returns True if key is valid for AES-256-GCM
   */
  static verifyKey(key: string): boolean {
    try {
      const buffer = Buffer.from(key, 'base64');
      return buffer.length === KEY_LENGTH;
    } catch {
      return false;
    }
  }

  /**
   * Hash a token using SHA-256 (for Redis key names)
   *
   * This prevents exposing actual token values in Redis key names.
   * Even though values are encrypted, key names are visible in Redis.
   *
   * Security Benefits:
   * - Read-only Redis access doesn't expose usable tokens
   * - Keys cannot be used to reconstruct original tokens
   * - SHA-256 is one-way (no reversal possible)
   *
   * @param token Token to hash (access token, refresh token, etc.)
   * @returns SHA-256 hex digest (64 characters)
   */
  hashKey(token: string): string {
    if (!token) {
      throw new Error('Cannot hash empty token');
    }

    return createHash('sha256').update(token).digest('hex');
  }
}
