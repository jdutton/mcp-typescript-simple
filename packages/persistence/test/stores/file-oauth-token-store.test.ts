/**
 * Unit tests for FileOAuthTokenStore
 */

import { FileOAuthTokenStore, StoredTokenInfo } from '../../src/index.js';
import { TokenEncryptionService } from '../../src/encryption/token-encryption-service.js';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';


/* eslint-disable sonarjs/no-unused-vars */
describe('FileOAuthTokenStore', () => {
  let store: FileOAuthTokenStore;
  let testDir: string;
  let testFilePath: string;

  // Helper function to create encryption service
  const createEncryptionService = () => {
    return new TokenEncryptionService({
      encryptionKey: process.env.TOKEN_ENCRYPTION_KEY!,
    });
  };

  beforeEach(() => {
    // Set encryption key for tests (required by encryption service - must be 32 bytes base64)
    process.env.TOKEN_ENCRYPTION_KEY = 'Wp3suOcV+cleewUEOGUkE7JNgsnzwmiBMNqF7q9sQSI=';

    // Create temporary directory for test files
    testDir = join(tmpdir(), `oauth-token-store-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    testFilePath = join(testDir, 'oauth-tokens.json');

    store = new FileOAuthTokenStore({
      filePath: testFilePath,
      debounceMs: 0, // Disable debouncing for tests
      encryptionService: createEncryptionService(),
    });
  });

  afterEach(() => {
    store.dispose();

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('storeToken', () => {
    it('should store a token and persist to file', async () => {
      const tokenInfo: StoredTokenInfo = {
        accessToken: 'access-token-123',
        provider: 'google',
        scopes: ['openid', 'email'],
        expiresAt: Date.now() + 3600000,
        refreshToken: 'refresh-token-123',
        userInfo: {
          sub: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
          provider: 'google',
        },
      };

      await store.storeToken('access-token-123', tokenInfo);

      // Wait for file write
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify file exists and is not empty (content is encrypted, so can't parse as JSON)
      expect(existsSync(testFilePath)).toBe(true);
      const content = readFileSync(testFilePath, 'utf8');
      expect(content.length).toBeGreaterThan(0);

      // Verify token can be retrieved through store (decryption works)
      const retrieved = await store.getToken('access-token-123');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.accessToken).toBe('access-token-123');
      expect(retrieved?.provider).toBe('google');
    });

    it('should store multiple tokens', async () => {
      const tokenInfo1: StoredTokenInfo = {
        accessToken: 'access-token-1',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000,
        userInfo: { sub: 'user-1', email: 'user1@example.com', name: 'User 1', provider: 'google' },
      };

      const tokenInfo2: StoredTokenInfo = {
        accessToken: 'access-token-2',
        provider: 'github',
        scopes: ['user:email'],
        expiresAt: Date.now() + 3600000,
        userInfo: { sub: 'user-2', email: 'user2@example.com', name: 'User 2', provider: 'github' },
      };

      await store.storeToken('access-token-1', tokenInfo1);
      await store.storeToken('access-token-2', tokenInfo2);

      const count = await store.getTokenCount();
      expect(count).toBe(2);
    });
  });

  describe('getToken', () => {
    it('should retrieve a stored token', async () => {
      const tokenInfo: StoredTokenInfo = {
        accessToken: 'access-token-123',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000,
        userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
      };

      await store.storeToken('access-token-123', tokenInfo);

      const retrieved = await store.getToken('access-token-123');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.provider).toBe('google');
      expect(retrieved?.userInfo.email).toBe('test@example.com');
    });

    it('should return null for non-existent token', async () => {
      const retrieved = await store.getToken('non-existent-token');
      expect(retrieved).toBeNull();
    });

    it('should return null for expired token', async () => {
      const tokenInfo: StoredTokenInfo = {
        accessToken: 'expired-token',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() - 1000, // Expired 1 second ago
        userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
      };

      await store.storeToken('expired-token', tokenInfo);

      const retrieved = await store.getToken('expired-token');
      expect(retrieved).toBeNull();

      // Verify token was deleted
      const count = await store.getTokenCount();
      expect(count).toBe(0);
    });
  });

  describe('findByRefreshToken', () => {
    it('should find token by refresh token', async () => {
      const tokenInfo: StoredTokenInfo = {
        accessToken: 'access-token-123',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000,
        refreshToken: 'refresh-token-123',
        userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
      };

      await store.storeToken('access-token-123', tokenInfo);

      const result = await store.findByRefreshToken('refresh-token-123');
      expect(result).not.toBeNull();
      expect(result?.accessToken).toBe('access-token-123');
      expect(result?.tokenInfo.provider).toBe('google');
    });

    it('should return null for non-existent refresh token', async () => {
      const result = await store.findByRefreshToken('non-existent-refresh-token');
      expect(result).toBeNull();
    });

    it('should handle token without refresh token', async () => {
      const tokenInfo: StoredTokenInfo = {
        accessToken: 'access-token-123',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000,
        // No refreshToken
        userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
      };

      await store.storeToken('access-token-123', tokenInfo);

      const result = await store.findByRefreshToken('any-refresh-token');
      expect(result).toBeNull();
    });
  });

  describe('deleteToken', () => {
    it('should delete a stored token', async () => {
      const tokenInfo: StoredTokenInfo = {
        accessToken: 'access-token-123',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000,
        refreshToken: 'refresh-token-123',
        userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
      };

      await store.storeToken('access-token-123', tokenInfo);

      let count = await store.getTokenCount();
      expect(count).toBe(1);

      await store.deleteToken('access-token-123');

      count = await store.getTokenCount();
      expect(count).toBe(0);

      // Verify refresh token index is also cleaned up
      const result = await store.findByRefreshToken('refresh-token-123');
      expect(result).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should clean up expired tokens', async () => {
      const validToken: StoredTokenInfo = {
        accessToken: 'valid-token',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000, // Valid for 1 hour
        userInfo: { sub: 'user-1', email: 'user1@example.com', name: 'User 1', provider: 'google' },
      };

      const expiredToken: StoredTokenInfo = {
        accessToken: 'expired-token',
        provider: 'github',
        scopes: ['user:email'],
        expiresAt: Date.now() - 1000, // Expired 1 second ago
        userInfo: { sub: 'user-2', email: 'user2@example.com', name: 'User 2', provider: 'github' },
      };

      await store.storeToken('valid-token', validToken);
      await store.storeToken('expired-token', expiredToken);

      const cleanedCount = await store.cleanup();
      expect(cleanedCount).toBe(1);

      const count = await store.getTokenCount();
      expect(count).toBe(1);

      // Verify only valid token remains
      const retrieved = await store.getToken('valid-token');
      expect(retrieved).not.toBeNull();
    });
  });

  describe('persistence', () => {
    it('should load tokens from existing file on startup', async () => {
      const tokenInfo1: StoredTokenInfo = {
        accessToken: 'access-1',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000,
        refreshToken: 'refresh-1',
        userInfo: { sub: 'user-1', email: 'user1@example.com', name: 'User 1', provider: 'google' },
      };

      const tokenInfo2: StoredTokenInfo = {
        accessToken: 'access-2',
        provider: 'github',
        scopes: ['user:email'],
        expiresAt: Date.now() + 3600000,
        refreshToken: 'refresh-2',
        userInfo: { sub: 'user-2', email: 'user2@example.com', name: 'User 2', provider: 'github' },
      };

      await store.storeToken('access-1', tokenInfo1);
      await store.storeToken('access-2', tokenInfo2);

      // Wait for file write
      await new Promise(resolve => setTimeout(resolve, 100));

      store.dispose();

      // Create new store instance
      const newStore = new FileOAuthTokenStore({
        filePath: testFilePath,
        encryptionService: createEncryptionService(),
      });

      // Verify tokens were loaded
      const count = await newStore.getTokenCount();
      expect(count).toBe(2);

      const retrieved1 = await newStore.getToken('access-1');
      expect(retrieved1?.provider).toBe('google');

      const retrieved2 = await newStore.findByRefreshToken('refresh-2');
      expect(retrieved2?.tokenInfo.provider).toBe('github');

      newStore.dispose();
    });

    it('should handle non-existent file on startup', () => {
      const nonExistentPath = join(testDir, 'non-existent.json');
      const newStore = new FileOAuthTokenStore({
        filePath: nonExistentPath,
        encryptionService: createEncryptionService(),
      });

      expect(newStore).toBeDefined();
      newStore.dispose();
    });
  });

  describe('refresh token index', () => {
    it('should maintain refresh token index across persistence', async () => {
      const tokenInfo: StoredTokenInfo = {
        accessToken: 'access-token-xyz',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000,
        refreshToken: 'refresh-token-abc',
        userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
      };

      await store.storeToken('access-token-xyz', tokenInfo);

      // Wait for file write
      await new Promise(resolve => setTimeout(resolve, 100));

      store.dispose();

      // Create new store instance
      const newStore = new FileOAuthTokenStore({
        filePath: testFilePath,
        encryptionService: createEncryptionService(),
      });

      // Verify refresh token index was rebuilt
      const result = await newStore.findByRefreshToken('refresh-token-abc');
      expect(result).not.toBeNull();
      expect(result?.accessToken).toBe('access-token-xyz');

      newStore.dispose();
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent token storage', async () => {
      const tokens = Array.from({ length: 10 }, (_, i) => ({
        accessToken: `access-token-${i}`,
        tokenInfo: {
          accessToken: `access-token-${i}`,
          provider: 'google' as const,
          scopes: ['openid'],
          expiresAt: Date.now() + 3600000,
          refreshToken: `refresh-token-${i}`,
          userInfo: {
            sub: `user-${i}`,
            email: `user${i}@example.com`,
            name: `User ${i}`,
            provider: 'google',
          },
        },
      }));

      // Store all tokens concurrently
      await Promise.all(
        tokens.map(({ accessToken, tokenInfo }) =>
          store.storeToken(accessToken, tokenInfo)
        )
      );

      // Wait for debounced writes
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify all tokens were stored
      const count = await store.getTokenCount();
      expect(count).toBe(10);

      // Verify all can be retrieved
      for (const { accessToken, tokenInfo } of tokens) {
        const retrieved = await store.getToken(accessToken);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.userInfo.sub).toBe(tokenInfo.userInfo.sub);
      }
    });

    it('should handle concurrent reads and writes', async () => {
      const tokenInfo: StoredTokenInfo = {
        accessToken: 'access-token-123',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000,
        refreshToken: 'refresh-token-123',
        userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
      };

      // Store initial token
      await store.storeToken('access-token-123', tokenInfo);

      // Concurrent reads and writes
      const operations = [
        store.getToken('access-token-123'),
        store.getToken('access-token-123'),
        store.storeToken('access-token-456', {
          ...tokenInfo,
          accessToken: 'access-token-456',
          refreshToken: 'refresh-token-456',
        }),
        store.findByRefreshToken('refresh-token-123'),
        store.getTokenCount(),
      ];

      const results = await Promise.all(operations);

      expect(results[0]).not.toBeNull(); // First read
      expect(results[1]).not.toBeNull(); // Second read
      expect(results[3]).not.toBeNull(); // findByRefreshToken
      expect(results[4]).toBeGreaterThanOrEqual(1); // Token count
    });

    it('should handle concurrent deletes', async () => {
      const tokens = Array.from({ length: 5 }, (_, i) => ({
        accessToken: `access-token-${i}`,
        tokenInfo: {
          accessToken: `access-token-${i}`,
          provider: 'google' as const,
          scopes: ['openid'],
          expiresAt: Date.now() + 3600000,
          userInfo: {
            sub: `user-${i}`,
            email: `user${i}@example.com`,
            name: `User ${i}`,
            provider: 'google',
          },
        },
      }));

      // Store all tokens
      for (const { accessToken, tokenInfo } of tokens) {
        await store.storeToken(accessToken, tokenInfo);
      }

      // Delete all concurrently
      await Promise.all(
        tokens.map(({ accessToken }) => store.deleteToken(accessToken))
      );

      // Wait for writes
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify all deleted
      const count = await store.getTokenCount();
      expect(count).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle very long token strings', async () => {
      const longToken = 'a'.repeat(10000);
      const tokenInfo: StoredTokenInfo = {
        accessToken: longToken,
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000,
        userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
      };

      await store.storeToken(longToken, tokenInfo);

      const retrieved = await store.getToken(longToken);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.provider).toBe('google');
    });

    it('should handle special characters in tokens', async () => {
      const specialToken = 'token-with-special-chars-!@#$%^&*()_+-=[]{}|;:,.<>?';
      const tokenInfo: StoredTokenInfo = {
        accessToken: specialToken,
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000,
        userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
      };

      await store.storeToken(specialToken, tokenInfo);

      const retrieved = await store.getToken(specialToken);
      expect(retrieved).not.toBeNull();
    });

    it('should handle rapid sequential updates to same token', async () => {
      const accessToken = 'access-token-123';

      // Rapid updates
      for (let i = 0; i < 10; i++) {
        const tokenInfo: StoredTokenInfo = {
          accessToken,
          provider: 'google',
          scopes: ['openid'],
          expiresAt: Date.now() + 3600000 + i * 1000,
          refreshToken: `refresh-token-${i}`,
          userInfo: {
            sub: `user-${i}`,
            email: `user${i}@example.com`,
            name: `User ${i}`,
            provider: 'google',
          },
        };

        await store.storeToken(accessToken, tokenInfo);
      }

      // Wait for debounced write
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify latest version is stored
      const retrieved = await store.getToken(accessToken);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.userInfo.sub).toBe('user-9'); // Latest update
    });

    it('should handle empty scopes array', async () => {
      const tokenInfo: StoredTokenInfo = {
        accessToken: 'access-token-123',
        provider: 'google',
        scopes: [], // Empty scopes
        expiresAt: Date.now() + 3600000,
        userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
      };

      await store.storeToken('access-token-123', tokenInfo);

      const retrieved = await store.getToken('access-token-123');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.scopes).toEqual([]);
    });

    it('should handle missing optional fields', async () => {
      const tokenInfo: StoredTokenInfo = {
        accessToken: 'access-token-123',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000,
        // No refreshToken, idToken
        userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
      };

      await store.storeToken('access-token-123', tokenInfo);

      const retrieved = await store.getToken('access-token-123');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.refreshToken).toBeUndefined();
      expect(retrieved?.idToken).toBeUndefined();
    });
  });

  describe('cleanup edge cases', () => {
    it('should handle cleanup with no expired tokens', async () => {
      const tokenInfo: StoredTokenInfo = {
        accessToken: 'access-token-123',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000,
        userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
      };

      await store.storeToken('access-token-123', tokenInfo);

      const cleanedCount = await store.cleanup();
      expect(cleanedCount).toBe(0);

      const count = await store.getTokenCount();
      expect(count).toBe(1); // Token still there
    });

    it('should handle cleanup with all tokens expired', async () => {
      const expiredTokens = Array.from({ length: 5 }, (_, i) => ({
        accessToken: `access-token-${i}`,
        tokenInfo: {
          accessToken: `access-token-${i}`,
          provider: 'google' as const,
          scopes: ['openid'],
          expiresAt: Date.now() - (i + 1) * 1000, // All expired
          userInfo: {
            sub: `user-${i}`,
            email: `user${i}@example.com`,
            name: `User ${i}`,
            provider: 'google',
          },
        },
      }));

      for (const { accessToken, tokenInfo } of expiredTokens) {
        await store.storeToken(accessToken, tokenInfo);
      }

      const cleanedCount = await store.cleanup();
      expect(cleanedCount).toBe(5);

      const count = await store.getTokenCount();
      expect(count).toBe(0);
    });

    it('should cleanup stale refresh token index entries', async () => {
      const tokenInfo: StoredTokenInfo = {
        accessToken: 'access-token-123',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() - 1000, // Expired
        refreshToken: 'refresh-token-123',
        userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
      };

      await store.storeToken('access-token-123', tokenInfo);
      await store.cleanup();

      // Refresh token index should be cleaned up
      const result = await store.findByRefreshToken('refresh-token-123');
      expect(result).toBeNull();
    });
  });

  describe('performance', () => {
    it('should handle large dataset efficiently', async () => {
      const startTime = Date.now();
      const tokenCount = 100;

      // Store many tokens
      for (let i = 0; i < tokenCount; i++) {
        const tokenInfo: StoredTokenInfo = {
          accessToken: `access-token-${i}`,
          provider: 'google',
          scopes: ['openid'],
          expiresAt: Date.now() + 3600000,
          refreshToken: `refresh-token-${i}`,
          userInfo: {
            sub: `user-${i}`,
            email: `user${i}@example.com`,
            name: `User ${i}`,
            provider: 'google',
          },
        };

        await store.storeToken(`access-token-${i}`, tokenInfo);
      }

      const _storeTime = Date.now() - startTime;

      // Verify count
      const count = await store.getTokenCount();
      expect(count).toBe(tokenCount);

      // Test lookup performance
      const lookupStart = Date.now();
      const retrieved = await store.getToken('access-token-50');
      const lookupTime = Date.now() - lookupStart;

      expect(retrieved).not.toBeNull();
      expect(lookupTime).toBeLessThan(10); // O(1) lookup should be fast

      // Test refresh token index lookup performance
      const refreshLookupStart = Date.now();
      const refreshResult = await store.findByRefreshToken('refresh-token-75');
      const refreshLookupTime = Date.now() - refreshLookupStart;

      expect(refreshResult).not.toBeNull();
      expect(refreshLookupTime).toBeLessThan(10); // O(1) lookup via index
    });
  });
});
