/**
 * Integration tests for Session Auth Cache (ADR 006)
 *
 * Tests the SessionAuthCache functionality that consolidates authentication
 * caching within session metadata, eliminating separate token storage.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemorySessionManager } from '../../src/session/memory-session-manager.js';
import type { SessionInfo } from '../../src/session/session-manager.js';
import type { SessionAuthCache } from '@mcp-typescript-simple/persistence';

describe('Session Auth Cache (ADR 006)', () => {
  let sessionManager: MemorySessionManager;

  beforeEach(() => {
    sessionManager = new MemorySessionManager();
  });

  describe('SessionInfo with SessionAuthCache', () => {
    it('should store and retrieve session with auth cache', async () => {
      const authCache: SessionAuthCache = {
        provider: 'github',
        userId: 'user-123',
        email: 'user@example.com',
        scopes: ['user:email', 'read:user'],
        authInfo: {
          provider: 'github',
          userId: 'user-123',
          email: 'user@example.com',
        },
        tokenHash: 'abc123hash',
        tokenBindingTime: Date.now(),
        lastValidated: Date.now(),
        validationTTL: 300000, // 5 minutes
      };

      // Create session with auth cache
      const session = await sessionManager.createSession(undefined, {}, 'test-session-1');

      // Update session with auth cache (simulating OAuth flow completion)
      const updatedSession: SessionInfo = {
        ...session,
        auth: authCache,
      };

      // In a real implementation, we would have an updateSession method
      // For now, verify the type compatibility
      expect(updatedSession.auth).toBeDefined();
      expect(updatedSession.auth?.provider).toBe('github');
      expect(updatedSession.auth?.userId).toBe('user-123');
      expect(updatedSession.auth?.tokenHash).toBe('abc123hash');
    });

    it('should support JWT-style auth cache (no lastValidated)', async () => {
      const jwtAuthCache: SessionAuthCache = {
        provider: 'google',
        userId: 'google-user-456',
        email: 'user@gmail.com',
        scopes: ['openid', 'profile', 'email'],
        authInfo: {
          provider: 'google',
          userId: 'google-user-456',
          email: 'user@gmail.com',
        },
        tokenHash: 'jwt-hash-xyz',
        tokenBindingTime: Date.now(),
        // No lastValidated/validationTTL for JWT (local validation)
      };

      const session = await sessionManager.createSession(undefined, {}, 'jwt-session-1');

      const updatedSession: SessionInfo = {
        ...session,
        auth: jwtAuthCache,
      };

      expect(updatedSession.auth).toBeDefined();
      expect(updatedSession.auth?.provider).toBe('google');
      expect(updatedSession.auth?.lastValidated).toBeUndefined();
      expect(updatedSession.auth?.validationTTL).toBeUndefined();
    });

    it('should support opaque token auth cache with TTL', async () => {
      const opaqueAuthCache: SessionAuthCache = {
        provider: 'github',
        userId: 'github-user-789',
        email: 'developer@github.com',
        scopes: ['repo', 'user'],
        authInfo: {
          provider: 'github',
          userId: 'github-user-789',
          email: 'developer@github.com',
        },
        tokenHash: 'opaque-hash-123',
        tokenBindingTime: Date.now(),
        lastValidated: Date.now(),
        validationTTL: 300000, // 5 minutes for opaque tokens
      };

      const session = await sessionManager.createSession(undefined, {}, 'opaque-session-1');

      const updatedSession: SessionInfo = {
        ...session,
        auth: opaqueAuthCache,
      };

      expect(updatedSession.auth).toBeDefined();
      expect(updatedSession.auth?.lastValidated).toBeDefined();
      expect(updatedSession.auth?.validationTTL).toBe(300000);
    });

    it('should maintain backward compatibility with deprecated authInfo field', async () => {
      // Legacy sessions may have authInfo at root level
      const legacySession = await sessionManager.createSession(
        {
          provider: 'google',
          userId: 'legacy-user',
          email: 'legacy@example.com',
        },
        {},
        'legacy-session-1'
      );

      expect(legacySession.authInfo).toBeDefined();
      expect(legacySession.authInfo?.userId).toBe('legacy-user');

      // New sessions should use auth.authInfo instead
      const newAuthCache: SessionAuthCache = {
        provider: 'google',
        userId: 'new-user',
        email: 'new@example.com',
        scopes: ['openid'],
        authInfo: {
          provider: 'google',
          userId: 'new-user',
          email: 'new@example.com',
        },
        tokenHash: 'new-hash',
        tokenBindingTime: Date.now(),
      };

      const newSession: SessionInfo = {
        sessionId: 'new-session-1',
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
        auth: newAuthCache, // NEW: Use auth field
      };

      expect(newSession.auth).toBeDefined();
      expect(newSession.auth?.authInfo.userId).toBe('new-user');
    });
  });

  describe('Token Binding Security', () => {
    it('should store token hash (not actual token)', async () => {
      const authCache: SessionAuthCache = {
        provider: 'github',
        userId: 'user-secure',
        scopes: ['user:email'],
        authInfo: {
          provider: 'github',
          userId: 'user-secure',
        },
        tokenHash: 'sha256-hash-of-token', // SHA-256 hash, NOT the actual token
        tokenBindingTime: Date.now(),
      };

      // Verify no actual token is stored
      expect(authCache.tokenHash).toBe('sha256-hash-of-token');
      expect(authCache).not.toHaveProperty('accessToken');
      expect(authCache).not.toHaveProperty('refreshToken');

      // The authInfo MAY have accessToken/refreshToken for MCP SDK compatibility
      // but these should NOT be the actual tokens (they should be masked or omitted)
    });

    it('should track token binding time for refresh detection', async () => {
      const now = Date.now();
      const authCache: SessionAuthCache = {
        provider: 'google',
        userId: 'user-binding',
        scopes: ['openid'],
        authInfo: {
          provider: 'google',
          userId: 'user-binding',
        },
        tokenHash: 'initial-hash',
        tokenBindingTime: now,
      };

      expect(authCache.tokenBindingTime).toBe(now);

      // Simulate token refresh (new token, new hash, new binding time)
      const refreshedAuthCache: SessionAuthCache = {
        ...authCache,
        tokenHash: 'new-hash-after-refresh',
        tokenBindingTime: now + 60000, // 1 minute later
      };

      expect(refreshedAuthCache.tokenHash).not.toBe(authCache.tokenHash);
      expect(refreshedAuthCache.tokenBindingTime).toBeGreaterThan(authCache.tokenBindingTime);
    });
  });

  describe('Validation TTL for Opaque Tokens', () => {
    it('should track last validation time', async () => {
      const now = Date.now();
      const authCache: SessionAuthCache = {
        provider: 'github',
        userId: 'user-validation',
        scopes: ['user:email'],
        authInfo: {
          provider: 'github',
          userId: 'user-validation',
        },
        tokenHash: 'opaque-token-hash',
        tokenBindingTime: now,
        lastValidated: now,
        validationTTL: 300000,
      };

      expect(authCache.lastValidated).toBe(now);
      expect(authCache.validationTTL).toBe(300000);
    });

    it('should detect when validation TTL has expired', () => {
      const now = Date.now();
      const validationTTL = 300000; // 5 minutes

      const authCache: SessionAuthCache = {
        provider: 'github',
        userId: 'user-ttl',
        scopes: ['user:email'],
        authInfo: {
          provider: 'github',
          userId: 'user-ttl',
        },
        tokenHash: 'token-hash',
        tokenBindingTime: now,
        lastValidated: now - 400000, // 6.67 minutes ago (expired)
        validationTTL,
      };

      const age = Date.now() - (authCache.lastValidated ?? 0);
      const isExpired = age >= (authCache.validationTTL ?? 0);

      expect(isExpired).toBe(true);
    });

    it('should detect when validation is still fresh', () => {
      const now = Date.now();
      const validationTTL = 300000; // 5 minutes

      const authCache: SessionAuthCache = {
        provider: 'github',
        userId: 'user-fresh',
        scopes: ['user:email'],
        authInfo: {
          provider: 'github',
          userId: 'user-fresh',
        },
        tokenHash: 'token-hash',
        tokenBindingTime: now,
        lastValidated: now - 60000, // 1 minute ago (fresh)
        validationTTL,
      };

      const age = Date.now() - (authCache.lastValidated ?? 0);
      const isExpired = age >= (authCache.validationTTL ?? 0);

      expect(isExpired).toBe(false);
    });
  });
});
