/**
 * Unit tests for RedisOAuthTokenStore - Refresh Token Index Encryption
 *
 * CRITICAL: These tests verify that the refresh token index values are encrypted.
 * The current implementation (line 138) stores access tokens in plaintext:
 *
 *   storePromises.push(this.redis.setex(refreshIndexKey, ttlSeconds, accessToken));
 *                                                                      ^^^^^^^^^^
 *                                                              PLAINTEXT ACCESS TOKEN!
 *
 * Security Risk:
 * - OAuth access tokens (e.g., "ghu_xxxxxxxxxxxx") visible in Redis
 * - Compromises zero-tolerance encryption policy
 * - Violates SOC-2, ISO 27001, GDPR, HIPAA requirements
 *
 * Expected Behavior:
 * - Refresh token index values should be encrypted before storing
 * - Direct Redis inspection should show encrypted data, not plaintext tokens
 * - Decryption should happen when reading the index
 */

import { vi } from 'vitest';
import { RedisOAuthTokenStore, StoredTokenInfo } from '../../../src/index.js';
import { TokenEncryptionService } from '../../../src/encryption/token-encryption-service.js';

// Hoist Redis mock to avoid initialization issues
const RedisMock = vi.hoisted(() => require('ioredis-mock'));

// Mock Redis for testing - Vitest requires default export
vi.mock('ioredis', () => ({
  default: RedisMock
}));

// Create a shared Redis instance for direct inspection
let sharedRedis: any = null;

describe('RedisOAuthTokenStore - Refresh Token Index Encryption', () => {
  let store: RedisOAuthTokenStore;
  let encryptionService: TokenEncryptionService;

  beforeEach(async () => {
    // Set encryption key for tests (required - must be 32 bytes base64)
    process.env.TOKEN_ENCRYPTION_KEY = 'Wp3suOcV+cleewUEOGUkE7JNgsnzwmiBMNqF7q9sQSI=';

    // Create encryption service
    encryptionService = new TokenEncryptionService({
      encryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
    });

    // Create shared Redis instance if not exists
    if (!sharedRedis) {
      sharedRedis = new (RedisMock as any)();
    }

    // Flush all data between tests
    await sharedRedis.flushall();

    // Create store with encryption service
    store = new RedisOAuthTokenStore('redis://localhost:6379', encryptionService);
  });

  afterEach(() => {
    if (store) {
      store.dispose();
    }
  });

  afterAll(async () => {
    // Clean up shared Redis instance
    if (sharedRedis) {
      await sharedRedis.quit();
      sharedRedis = null;
    }
  });

  describe('Constructor Requirements', () => {
    it('should require TokenEncryptionService parameter', () => {
      // CRITICAL: Constructor should throw if encryption service not provided
      // Zero-tolerance security stance - no silent fallback to unencrypted storage
      expect(() => {
        new RedisOAuthTokenStore('redis://localhost:6379', undefined as any);
      }).toThrow(/TokenEncryptionService is REQUIRED/);
    });

    it('should accept TokenEncryptionService in constructor', () => {
      // Valid constructor call with encryption service
      expect(() => {
        const store = new RedisOAuthTokenStore('redis://localhost:6379', encryptionService);
        expect(store).toBeDefined();
      }).not.toThrow();
    });
  });

  describe('Refresh Token Index Encryption', () => {
    it('should encrypt refresh token index values (access tokens) before storing', async () => {
      // CRITICAL TEST: Verifies that the refresh token index stores encrypted
      // access tokens, not plaintext.
      //
      // Current bug at redis-oauth-token-store.ts:138:
      //   this.redis.setex(refreshIndexKey, ttlSeconds, accessToken)
      //   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
      //   Stores plaintext access token as index value!
      //
      // Expected behavior:
      //   Encrypt access token before storing in index

      const accessToken = 'ghu_SENSITIVE_ACCESS_TOKEN_12345';
      const refreshToken = 'refresh_token_xyz';

      const tokenInfo: StoredTokenInfo = {
        accessToken,
        provider: 'github',
        scopes: ['user:email'],
        expiresAt: Date.now() + 3600000, // 1 hour
        refreshToken,
        userInfo: {
          sub: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
          provider: 'github',
        },
      };

      await store.storeToken(accessToken, tokenInfo);

      // Direct Redis inspection of refresh token index
      // IMPORTANT: Keys are now SHA-256 hashed to prevent token exposure
      const hashedRefreshToken = encryptionService.hashKey(refreshToken);
      const refreshIndexKey = `oauth:refresh:${hashedRefreshToken}`;
      const indexValue = await sharedRedis.get(refreshIndexKey);

      // CRITICAL ASSERTION: Index value should be encrypted, not plaintext access token
      expect(indexValue).not.toBe(accessToken);
      expect(indexValue).not.toContain('ghu_SENSITIVE');
      expect(indexValue).not.toContain('ACCESS_TOKEN');

      // CRITICAL ASSERTION: Index value should be non-empty encrypted data
      expect(indexValue.length).toBeGreaterThan(0);
      expect(indexValue).not.toBe(accessToken); // Double-check it's not plaintext

      // Verify findByRefreshToken still works (decryption happens internally)
      const result = await store.findByRefreshToken(refreshToken);
      expect(result).not.toBeNull();
      expect(result?.accessToken).toBe(accessToken);
    });

    it('should decrypt refresh token index when reading', async () => {
      const accessToken = 'ghu_ANOTHER_TOKEN_67890';
      const refreshToken = 'refresh_token_abc';

      const tokenInfo: StoredTokenInfo = {
        accessToken,
        provider: 'google',
        scopes: ['openid', 'email'],
        expiresAt: Date.now() + 3600000,
        refreshToken,
        userInfo: {
          sub: 'user-456',
          email: 'another@example.com',
          name: 'Another User',
          provider: 'google',
        },
      };

      await store.storeToken(accessToken, tokenInfo);

      // Retrieve via refresh token - should decrypt index and fetch token data
      const result = await store.findByRefreshToken(refreshToken);

      expect(result).not.toBeNull();
      expect(result?.accessToken).toBe(accessToken);
      expect(result?.tokenInfo.provider).toBe('google');
      expect(result?.tokenInfo.userInfo.email).toBe('another@example.com');
    });

    it('should fail fast on corrupted encrypted index', async () => {
      const refreshToken = 'refresh_token_corrupt';
      // IMPORTANT: Keys are now SHA-256 hashed to prevent token exposure
      const hashedRefreshToken = encryptionService.hashKey(refreshToken);
      const refreshIndexKey = `oauth:refresh:${hashedRefreshToken}`;

      // Store corrupted encrypted data
      await sharedRedis.setex(refreshIndexKey, 3600, 'invalid:encrypted:data');

      // Should fail fast on decryption error (zero-tolerance security stance)
      await expect(store.findByRefreshToken(refreshToken)).rejects.toThrow(/decryption failed/i);
    });

    it('should not expose access tokens in Redis keys or values', async () => {
      const accessToken = 'ghu_SECRET_TOKEN_MUST_NOT_APPEAR';
      const refreshToken = 'refresh_secret';

      const tokenInfo: StoredTokenInfo = {
        accessToken,
        provider: 'github',
        scopes: ['repo'],
        expiresAt: Date.now() + 3600000,
        refreshToken,
        userInfo: {
          sub: 'user-security-test',
          email: 'security@example.com',
          name: 'Security Test',
          provider: 'github',
        },
      };

      await store.storeToken(accessToken, tokenInfo);

      // Get all Redis keys
      const allKeys = await sharedRedis.keys('*');

      // Get all Redis values
      const allValues = await Promise.all(
        allKeys.map((key: string) => sharedRedis.get(key))
      );

      // CRITICAL SECURITY CHECK: Access token should not appear in any value
      // (except the main token key which stores encrypted data)
      for (const value of allValues) {
        if (typeof value === 'string') {
          // Value should not contain plaintext access token
          expect(value).not.toContain('SECRET_TOKEN_MUST_NOT_APPEAR');
          expect(value).not.toContain('ghu_SECRET');
        }
      }
    });
  });

  describe('Token Data Encryption (Existing Functionality)', () => {
    it('should continue encrypting main token data', async () => {
      // Verify existing encryption of oauth:token:* data still works
      const accessToken = 'token_main_data';
      const tokenInfo: StoredTokenInfo = {
        accessToken,
        provider: 'microsoft',
        scopes: ['user.read'],
        expiresAt: Date.now() + 3600000,
        userInfo: {
          sub: 'user-main',
          email: 'main@example.com',
          name: 'Main User',
          provider: 'microsoft',
        },
      };

      await store.storeToken(accessToken, tokenInfo);

      // Direct Redis inspection of main token data
      // IMPORTANT: Keys are now SHA-256 hashed to prevent token exposure
      const hashedAccessToken = encryptionService.hashKey(accessToken);
      const tokenKey = `oauth:token:${hashedAccessToken}`;
      const tokenData = await sharedRedis.get(tokenKey);

      // Main token data should be encrypted (already working)
      expect(() => JSON.parse(tokenData)).toThrow();
      expect(tokenData).not.toContain('main@example.com');
      expect(tokenData).not.toContain('Main User');

      // Verify retrieval still works
      const retrieved = await store.getToken(accessToken);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.userInfo.email).toBe('main@example.com');
    });
  });
});
