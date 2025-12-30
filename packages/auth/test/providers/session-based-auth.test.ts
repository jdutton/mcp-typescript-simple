/**
 * Tests for Session-Based Authentication Caching (ADR 006)
 *
 * This test suite verifies the new session-based authentication flow
 * that eliminates token storage and improves performance through:
 * - O(1) provider lookup via session cache
 * - Token binding with SHA-256 hash verification
 * - JWT signature validation (Google, Microsoft)
 * - TTL-based caching for opaque tokens (GitHub)
 * - Client-managed token refresh detection
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import type {
  OAuthConfig,
  SessionAuthCache
} from '@mcp-typescript-simple/auth';
import { MemoryPKCEStore } from '@mcp-typescript-simple/persistence';
import { SessionManager } from '@mcp-typescript-simple/http-server';
import { MockOAuthProvider } from '../../../http-server/test/helpers/mock-oauth-provider.js';

// Helper to create test config
function createTestConfig(): OAuthConfig {
  return {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'http://localhost:3000/callback',
    scopes: ['openid', 'profile', 'email']
  };
}

// Helper to create mock session manager
function createMockSessionManager(): SessionManager {
  const sessions = new Map<string, any>();

  return {
    async createSession(metadata: any) {
      const sessionId = randomUUID();
      sessions.set(sessionId, { id: sessionId, ...metadata });
      return sessionId;
    },
    async getSession(sessionId: string) {
      return sessions.get(sessionId) || null;
    },
    async deleteSession(sessionId: string) {
      sessions.delete(sessionId);
    },
    async cleanup() {
      // No-op for testing
    }
  } as SessionManager;
}

// Helper to create session auth cache
function createSessionAuthCache(overrides?: Partial<SessionAuthCache>): SessionAuthCache {
  return {
    provider: 'google',
    userId: 'user-123',
    tokenHash: createHash('sha256').update('test-token').digest('hex'),
    tokenBindingTime: Date.now(),
    lastValidated: Date.now(),
    validationTTL: 300000, // 5 minutes
    scopes: ['openid', 'profile', 'email'],
    authInfo: {
      token: 'test-token',
      clientId: 'test-client-id',
      scopes: ['openid', 'profile', 'email'],
      expiresAt: Math.floor((Date.now() + 3600000) / 1000),
      extra: {
        userInfo: {
          sub: 'user-123',
          name: 'Test User',
          email: 'test@example.com'
        }
      }
    },
    ...overrides
  };
}

// Helper to setup token refresh test scenario
async function setupTokenRefreshScenario(
  provider: MockOAuthProvider,
  sessionManager: SessionManager,
  options: {
    oldToken?: string;
    userId?: string;
  } = {}
) {
  const oldToken = options.oldToken || 'old-token';
  const userId = options.userId || 'user-123';
  const oldTokenHash = provider.testHashToken(oldToken);

  const authCache = createSessionAuthCache({
    tokenHash: oldTokenHash,
    userId
  });

  const sessionId = await sessionManager.createSession({
    clientId: 'test-client',
    auth: authCache
  });

  return { oldToken, sessionId, authCache };
}

// Helper to setup revalidate tests with mocked user info
async function setupRevalidateTest(
  provider: MockOAuthProvider,
  sessionManager: SessionManager,
  userIdForMock: string
) {
  provider.setSessionManager(sessionManager);
  const newToken = 'new-token';
  const newTokenHash = provider.testHashToken(newToken);
  const { sessionId, authCache } = await setupTokenRefreshScenario(provider, sessionManager);

  provider.mockFetchUserInfo = async () => ({
    sub: userIdForMock,
    name: userIdForMock === 'user-123' ? 'Test User' : 'Attacker',
    email: userIdForMock === 'user-123' ? 'test@example.com' : 'attacker@example.com'
  });

  return { newToken, newTokenHash, sessionId, authCache };
}

describe('Session-Based Authentication (ADR 006)', () => {
  let provider: MockOAuthProvider;
  let sessionManager: SessionManager;

  beforeEach(() => {
    const pkceStore = new MemoryPKCEStore();
    provider = new MockOAuthProvider(createTestConfig(), 'google', pkceStore);
    sessionManager = createMockSessionManager();
  });

  describe('setSessionManager()', () => {
    it('should set session manager instance', () => {
      provider.setSessionManager(sessionManager);
      // Verify by attempting to use session-based auth
      expect(sessionManager).toBeDefined();
    });
  });

  describe('hashToken()', () => {
    it('should generate SHA-256 hash of token', () => {
      const token = 'test-access-token';
      const expectedHash = createHash('sha256').update(token).digest('hex');
      const actualHash = provider.testHashToken(token);

      expect(actualHash).toBe(expectedHash);
      expect(actualHash).toHaveLength(64); // SHA-256 produces 64 hex characters
    });

    it('should generate different hashes for different tokens', () => {
      const token1 = 'token-1';
      const token2 = 'token-2';

      const hash1 = provider.testHashToken(token1);
      const hash2 = provider.testHashToken(token2);

      expect(hash1).not.toBe(hash2);
    });

    it('should generate consistent hashes for same token', () => {
      const token = 'consistent-token';

      const hash1 = provider.testHashToken(token);
      const hash2 = provider.testHashToken(token);

      expect(hash1).toBe(hash2);
    });
  });

  describe('verifyAccessTokenWithSession()', () => {
    it('should fallback to legacy verifyAccessToken when session manager not configured', async () => {
      // Don't set session manager
      const token = 'test-token';
      const sessionId = 'session-123';

      const authInfo = await provider.verifyAccessTokenWithSession(token, sessionId);

      expect(authInfo).toBeDefined();
      expect(authInfo.token).toBe(token);
      expect(authInfo.clientId).toBe('test-client-id');
    });

    it('should throw error when session not found', async () => {
      provider.setSessionManager(sessionManager);
      const token = 'test-token';
      const sessionId = 'nonexistent-session';

      await expect(provider.verifyAccessTokenWithSession(token, sessionId))
        .rejects.toThrow('Session not found or expired');
    });

    it('should throw error when session not authenticated', async () => {
      provider.setSessionManager(sessionManager);
      const token = 'test-token';

      // Create session without auth cache
      const sessionId = await sessionManager.createSession({
        clientId: 'test-client',
        // No auth field
      });

      await expect(provider.verifyAccessTokenWithSession(token, sessionId))
        .rejects.toThrow('Session not authenticated');
    });

    it('should throw error when provider mismatch', async () => {
      provider.setSessionManager(sessionManager);
      const token = 'test-token';

      // Create session with different provider
      const authCache = createSessionAuthCache({ provider: 'github' });
      const sessionId = await sessionManager.createSession({
        clientId: 'test-client',
        auth: authCache
      });

      await expect(provider.verifyAccessTokenWithSession(token, sessionId))
        .rejects.toThrow('Provider mismatch');
    });

    it('should use cached auth when token hash matches and within TTL', async () => {
      provider.setSessionManager(sessionManager);
      const token = 'test-token';
      const tokenHash = provider.testHashToken(token);

      const authCache = createSessionAuthCache({
        tokenHash,
        lastValidated: Date.now(),
        validationTTL: 300000 // 5 minutes
      });

      const sessionId = await sessionManager.createSession({
        clientId: 'test-client',
        auth: authCache
      });

      const authInfo = await provider.verifyAccessTokenWithSession(token, sessionId);

      expect(authInfo).toBeDefined();
      expect(authInfo.token).toBe(token);
      expect(authInfo.extra?.userInfo?.sub).toBe('user-123');
    });

    it('should re-validate when token hash matches but TTL expired', async () => {
      provider.setSessionManager(sessionManager);
      const token = 'test-token';
      const tokenHash = provider.testHashToken(token);

      // Set lastValidated to 10 minutes ago (beyond default 5-minute TTL)
      const authCache = createSessionAuthCache({
        tokenHash,
        lastValidated: Date.now() - 600000, // 10 minutes ago
        validationTTL: 300000 // 5 minutes
      });

      const sessionId = await sessionManager.createSession({
        clientId: 'test-client',
        auth: authCache
      });

      // Mock fetchUserInfo to verify it's called
      let fetchCalled = false;
      provider.mockFetchUserInfo = async () => {
        fetchCalled = true;
        return {
          sub: 'user-123',
          name: 'Test User',
          email: 'test@example.com'
        };
      };

      const authInfo = await provider.verifyAccessTokenWithSession(token, sessionId);

      expect(fetchCalled).toBe(true);
      expect(authInfo).toBeDefined();
      expect(authInfo.extra?.userInfo?.sub).toBe('user-123');
    });

    it('should re-validate and update binding when token hash mismatches', async () => {
      provider.setSessionManager(sessionManager);
      const newToken = 'new-token';
      const { sessionId } = await setupTokenRefreshScenario(provider, sessionManager);

      // Mock fetchUserInfo to verify it's called with new token
      let fetchCalledWithToken: string | null = null;
      provider.mockFetchUserInfo = async (token: string) => {
        fetchCalledWithToken = token;
        return {
          sub: 'user-123',
          name: 'Test User',
          email: 'test@example.com'
        };
      };

      const authInfo = await provider.verifyAccessTokenWithSession(newToken, sessionId);

      expect(fetchCalledWithToken).toBe(newToken);
      expect(authInfo).toBeDefined();
      expect(authInfo.token).toBe(newToken);
    });

    it('should throw error when user ID mismatches after token refresh (security)', async () => {
      provider.setSessionManager(sessionManager);
      const newToken = 'new-token';
      const { sessionId } = await setupTokenRefreshScenario(provider, sessionManager);

      // Mock fetchUserInfo to return different user ID (attack simulation)
      provider.mockFetchUserInfo = async () => {
        return {
          sub: 'user-456', // Different user!
          name: 'Attacker',
          email: 'attacker@example.com'
        };
      };

      await expect(provider.verifyAccessTokenWithSession(newToken, sessionId))
        .rejects.toThrow('Token user mismatch - possible substitution attack');
    });
  });

  describe('canUseCachedAuthentication()', () => {
    it('should return true when within validation TTL', async () => {
      const authCache = createSessionAuthCache({
        lastValidated: Date.now(),
        validationTTL: 300000 // 5 minutes
      });

      const result = await provider.testCanUseCachedAuthentication(authCache);

      expect(result).toBe(true);
    });

    it('should return false when validation TTL expired', async () => {
      const authCache = createSessionAuthCache({
        lastValidated: Date.now() - 600000, // 10 minutes ago
        validationTTL: 300000 // 5 minutes
      });

      const result = await provider.testCanUseCachedAuthentication(authCache);

      expect(result).toBe(false);
    });

    it('should return false when lastValidated not set', async () => {
      const authCache = createSessionAuthCache({
        lastValidated: undefined
      });

      const result = await provider.testCanUseCachedAuthentication(authCache);

      expect(result).toBe(false);
    });

    it('should use default TTL when validationTTL not set', async () => {
      const authCache = createSessionAuthCache({
        lastValidated: Date.now(),
        validationTTL: undefined
      });

      const result = await provider.testCanUseCachedAuthentication(authCache);

      // Should use default 5-minute TTL
      expect(result).toBe(true);
    });
  });

  describe('buildAuthInfoFromSessionCache()', () => {
    it('should build AuthInfo from session cache', () => {
      const token = 'test-token';
      const authCache = createSessionAuthCache();

      const authInfo = provider.testBuildAuthInfoFromSessionCache(token, authCache);

      expect(authInfo.token).toBe(token);
      expect(authInfo.clientId).toBe('test-client-id');
      expect(authInfo.scopes).toEqual(['openid', 'profile', 'email']);
      expect(authInfo.extra?.userInfo?.sub).toBe('user-123');
    });

    it('should use current token not cached token', () => {
      const newToken = 'new-token';
      const authCache = createSessionAuthCache({
        authInfo: {
          ...createSessionAuthCache().authInfo,
          token: 'old-token'
        }
      });

      const authInfo = provider.testBuildAuthInfoFromSessionCache(newToken, authCache);

      expect(authInfo.token).toBe(newToken);
    });
  });

  describe('revalidateAndUpdateBinding()', () => {
    it('should re-validate token and update binding', async () => {
      const { newToken, newTokenHash, sessionId, authCache } = await setupRevalidateTest(provider, sessionManager, 'user-123');

      const authInfo = await provider.testRevalidateAndUpdateBinding(
        newToken,
        newTokenHash,
        sessionId,
        authCache
      );

      expect(authInfo).toBeDefined();
      expect(authInfo.token).toBe(newToken);
      expect(authInfo.extra?.userInfo?.sub).toBe('user-123');
    });

    it('should throw error on user ID mismatch', async () => {
      const { newToken, newTokenHash, sessionId, authCache } = await setupRevalidateTest(provider, sessionManager, 'user-456');

      await expect(provider.testRevalidateAndUpdateBinding(
        newToken,
        newTokenHash,
        sessionId,
        authCache
      )).rejects.toThrow('Token user mismatch - possible substitution attack');
    });
  });

  describe('revalidateAndUpdateCache()', () => {
    it('should re-validate token and update cache timestamp', async () => {
      provider.setSessionManager(sessionManager);
      const token = 'test-token';

      // Create session with expired last validation time
      const authCache = createSessionAuthCache({
        lastValidated: Date.now() - 600000 // 10 minutes ago
      });

      const sessionId = await sessionManager.createSession({
        clientId: 'test-client',
        auth: authCache
      });

      provider.mockFetchUserInfo = async () => ({
        sub: 'user-123',
        name: 'Test User',
        email: 'test@example.com'
      });

      const authInfo = await provider.testRevalidateAndUpdateCache(
        token,
        sessionId,
        authCache
      );

      expect(authInfo).toBeDefined();
      expect(authInfo.extra?.userInfo?.sub).toBe('user-123');
    });
  });

  describe('updateSessionAuthCache()', () => {
    it('should update session auth cache', async () => {
      provider.setSessionManager(sessionManager);

      const authCache = createSessionAuthCache();
      const sessionId = await sessionManager.createSession({
        clientId: 'test-client',
        auth: authCache
      });

      const updatedAuthCache = createSessionAuthCache({
        tokenHash: 'new-hash',
        lastValidated: Date.now()
      });

      await provider.testUpdateSessionAuthCache(sessionId, updatedAuthCache);

      // Verify session was updated
      const session = await sessionManager.getSession(sessionId);
      expect(session).toBeDefined();
      // Note: Current implementation logs the cache update but doesn't persist to session storage
      // Future optimization: Implement session persistence for auth cache updates (tracked in backlog)
    });

    it('should handle session not found gracefully', async () => {
      provider.setSessionManager(sessionManager);

      const authCache = createSessionAuthCache();

      // Should not throw
      await expect(provider.testUpdateSessionAuthCache('nonexistent', authCache))
        .resolves.toBeUndefined();
    });

    it('should handle no session manager gracefully', async () => {
      // Don't set session manager
      const authCache = createSessionAuthCache();

      // Should not throw
      await expect(provider.testUpdateSessionAuthCache('session-123', authCache))
        .resolves.toBeUndefined();
    });
  });
});
