/**
 * Unit tests for FileOAuthTokenStore
 */

import { FileOAuthTokenStore } from '../../../../src/auth/stores/file-oauth-token-store.js';
import { StoredTokenInfo } from '../../../../src/auth/providers/types.js';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('FileOAuthTokenStore', () => {
  let store: FileOAuthTokenStore;
  let testDir: string;
  let testFilePath: string;

  beforeEach(() => {
    // Create temporary directory for test files
    testDir = join(tmpdir(), `oauth-token-store-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    testFilePath = join(testDir, 'oauth-tokens.json');

    store = new FileOAuthTokenStore({
      filePath: testFilePath,
      debounceMs: 0, // Disable debouncing for tests
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

      // Verify file exists
      expect(existsSync(testFilePath)).toBe(true);

      // Verify file content
      const content = readFileSync(testFilePath, 'utf8');
      const data = JSON.parse(content);
      expect(data.tokens).toHaveLength(1);
      expect(data.tokens[0].accessToken).toBe('access-token-123');
      expect(data.tokens[0].tokenInfo.provider).toBe('google');
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
      const newStore = new FileOAuthTokenStore({ filePath: testFilePath });

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
      const newStore = new FileOAuthTokenStore({ filePath: nonExistentPath });

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
      const newStore = new FileOAuthTokenStore({ filePath: testFilePath });

      // Verify refresh token index was rebuilt
      const result = await newStore.findByRefreshToken('refresh-token-abc');
      expect(result).not.toBeNull();
      expect(result?.accessToken).toBe('access-token-xyz');

      newStore.dispose();
    });
  });
});
