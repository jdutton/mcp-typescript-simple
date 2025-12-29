/**
 * Integration tests for HTTP Server Session-Based Authentication (ADR 006)
 *
 * Tests the complete authentication flow through the HTTP server middleware:
 * - Session-based auth with O(1) provider lookup
 * - Legacy auth with O(N) provider loop (backward compatibility)
 * - Token binding verification and refresh detection
 * - JWT validation for Google/Microsoft providers
 * - TTL-based caching for opaque tokens (GitHub)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import type {
  OAuthProviderType
} from '@mcp-typescript-simple/auth';
import { MemorySessionManager } from '../../src/session/memory-session-manager.js';
import { MockOAuthProvider } from '../helpers/mock-oauth-provider.js';
import { createMockOAuthProvider, setupAuthenticatedSession } from '../helpers/auth-test-helpers.js';
import { makeAuthenticatedRequest, testRequestWithFetchTracking, expectMatchers } from '../helpers/api-request-helpers.js';

// Helper to create authentication middleware similar to HTTP server
function createAuthMiddleware(
  providers: Map<OAuthProviderType, MockOAuthProvider>,
  sessionManager: MemorySessionManager
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization as string | undefined;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.substring(7);
    const sessionIdHeader = req.headers['mcp-session-id'] as string | undefined;

    try {
      // ADR 006: Session-based authentication
      if (sessionIdHeader && sessionManager) {
        const session = await sessionManager.getSession(sessionIdHeader);

        if (!session || !session.auth) {
          res.status(401).json({ error: 'Session not found or expired' });
          return;
        }

        const providerType = session.auth.provider;
        const provider = providers.get(providerType);

        if (!provider) {
          res.status(401).json({ error: 'Provider not available' });
          return;
        }

        const authInfo = await provider.verifyAccessTokenWithSession(token, sessionIdHeader);
        (req as any).auth = authInfo;
        next();
        return;
      }

      // Legacy authentication: O(N) provider loop
      let correctProvider: MockOAuthProvider | undefined;

      for (const [, provider] of providers.entries()) {
        try {
          const hasToken = await provider.hasToken(token);
          if (hasToken) {
            correctProvider = provider;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!correctProvider) {
        res.status(401).json({ error: 'Invalid or expired access token' });
        return;
      }

      const authInfo = await correctProvider.verifyAccessToken(token);
      (req as any).auth = authInfo;
      next();
    } catch (error) {
      res.status(401).json({
        error: error instanceof Error ? error.message : 'Authentication failed'
      });
    }
  };
}

describe('HTTP Server Session-Based Authentication Integration (ADR 006)', () => {
  let app: express.Application;
  let providers: Map<OAuthProviderType, MockOAuthProvider>;
  let sessionManager: MemorySessionManager;
  let googleProvider: MockOAuthProvider;

  beforeEach(() => {
    // Create test providers using helper
    googleProvider = createMockOAuthProvider('google');
    sessionManager = new MemorySessionManager();

    // Configure provider with session manager
    googleProvider.setSessionManager(sessionManager);

    providers = new Map();
    providers.set('google', googleProvider);

    // Create Express app with auth middleware
    app = express();
    app.use(createAuthMiddleware(providers, sessionManager));

    // Test endpoint
    app.get('/api/test', (req, res) => {
      const auth = (req as any).auth;
      res.json({
        success: true,
        user: auth?.extra?.userInfo,
        provider: auth?.extra?.provider
      });
    });
  });

  /**
   * Helper to test session-based auth with TTL validation tracking
   */
  async function testSessionAuthWithTTL(options: {
    token: string;
    tokenHash: string;
    lastValidated?: number;
    validationTTL: number;
  }) {
    const session = await setupAuthenticatedSession(sessionManager, {
      provider: 'google',
      token: options.token,
      tokenHash: options.tokenHash,
      lastValidated: options.lastValidated,
      validationTTL: options.validationTTL
    });

    return testRequestWithFetchTracking(
      { app, endpoint: '/api/test', token: options.token, sessionId: session.sessionId },
      (mock) => { googleProvider.mockFetchUserInfo = mock; }
    );
  }

  describe('Session-Based Authentication (O(1) Provider Lookup)', () => {
    it('should authenticate successfully with valid session and token', async () => {
      const token = 'test-access-token';
      const tokenHash = googleProvider.testHashToken(token);

      // Create authenticated session using helper
      const session = await setupAuthenticatedSession(sessionManager, {
        provider: 'google',
        token,
        tokenHash
      });

      const response = await makeAuthenticatedRequest({
        app,
        endpoint: '/api/test',
        token,
        sessionId: session.sessionId
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user).toBeDefined();
      expect(response.body.user.sub).toBe('user-123');
      expect(response.body.user.provider).toBe('google');
      expect(response.body.provider).toBe('google');
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests -- assertions are in expectMatchers.toBeUnauthorized helper
    it('should reject request when session not found', async () => {
      const token = 'test-access-token';

      const response = await makeAuthenticatedRequest({
        app,
        endpoint: '/api/test',
        token,
        sessionId: 'nonexistent-session'
      });

      expectMatchers.toBeUnauthorized(response, 'Session not found');
    });

    it('should reject request when session not authenticated', async () => {
      const token = 'test-access-token';

      // Create session without auth cache
      const session = await sessionManager.createSession(undefined, {});

      const response = await makeAuthenticatedRequest({
        app,
        endpoint: '/api/test',
        token,
        sessionId: session.sessionId
      });

      expectMatchers.toBeUnauthorized(response, 'Session not found');
    });

    it('should reject request when provider not available', async () => {
      const token = 'test-access-token';
      const tokenHash = googleProvider.testHashToken(token);

      // Create authenticated session for unknown provider using helper
      const session = await setupAuthenticatedSession(sessionManager, {
        provider: 'github', // GitHub provider not registered
        token,
        tokenHash
      });

      const response = await makeAuthenticatedRequest({
        app,
        endpoint: '/api/test',
        token,
        sessionId: session.sessionId
      });

      expectMatchers.toBeUnauthorized(response, 'Provider not available');
    });

    it('should detect token refresh when hash mismatches', async () => {
      const oldToken = 'old-access-token';
      const newToken = 'new-access-token';
      const oldTokenHash = googleProvider.testHashToken(oldToken);

      // Create authenticated session with old token using helper
      const session = await setupAuthenticatedSession(sessionManager, {
        provider: 'google',
        token: oldToken,
        tokenHash: oldTokenHash
      });

      // Mock fetchUserInfo to return same user ID
      googleProvider.mockFetchUserInfo = async () => ({
        sub: 'user-123',
        name: 'Test User',
        email: 'test@example.com'
      });

      // Request with new token (should trigger re-validation)
      const response = await request(app)
        .get('/api/test')
        .set('Authorization', `Bearer ${newToken}`)
        .set('mcp-session-id', session.sessionId);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user.email).toBe('test@example.com');
    });

    it('should reject token with user ID mismatch after refresh (security)', async () => {
      const oldToken = 'old-access-token';
      const newToken = 'attacker-token';
      const oldTokenHash = googleProvider.testHashToken(oldToken);

      // Create authenticated session with old token using helper
      const session = await setupAuthenticatedSession(sessionManager, {
        provider: 'google',
        token: oldToken,
        tokenHash: oldTokenHash
      });

      // Mock fetchUserInfo to return different user ID (attack simulation)
      googleProvider.mockFetchUserInfo = async () => ({
        sub: 'user-456', // Different user!
        name: 'Attacker',
        email: 'attacker@example.com'
      });

      // Request with attacker token (should be rejected)
      const response = await makeAuthenticatedRequest({
        app,
        endpoint: '/api/test',
        token: newToken,
        sessionId: session.sessionId
      });

      expectMatchers.toBeUnauthorized(response, 'Token user mismatch');
    });

    it('should use cached auth when within TTL', async () => {
      const token = 'test-access-token';
      const tokenHash = googleProvider.testHashToken(token);

      const { response, fetchCalled } = await testSessionAuthWithTTL({
        token,
        tokenHash,
        validationTTL: 300000 // 5 minutes
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // Should use cached auth, no fetch call
      expect(fetchCalled).toBe(false);
    });

    it('should re-validate when TTL expired', async () => {
      const token = 'test-access-token';
      const tokenHash = googleProvider.testHashToken(token);

      const { response, fetchCalled } = await testSessionAuthWithTTL({
        token,
        tokenHash,
        lastValidated: Date.now() - 600000, // 10 minutes ago (beyond 5-minute TTL)
        validationTTL: 300000
      });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // Should re-validate with provider
      expect(fetchCalled).toBe(true);
    });
  });

  describe('Legacy Authentication (O(N) Provider Loop)', () => {
    it('should authenticate without mcp-session-id header (backward compatibility)', async () => {
      const token = 'test-access-token';

      // ADR 006: Mock provider's getUserInfo for O(N) verification
      googleProvider.mockFetchUserInfo = async (_token: string) => ({
        sub: 'user-123',
        name: 'Test User',
        email: 'test@example.com',
        provider: 'google'
      });

      const response = await request(app)
        .get('/api/test')
        .set('Authorization', `Bearer ${token}`);
        // No mcp-session-id header

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user.email).toBe('test@example.com');

      // Clean up mock
      googleProvider.mockFetchUserInfo = null;
    });

    it('should reject token not in any provider store', async () => {
      const token = 'unknown-token';

      const response = await request(app)
        .get('/api/test')
        .set('Authorization', `Bearer ${token}`);
        // No mcp-session-id header

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Invalid or expired access token');
    });
  });

  describe('Error Handling', () => {
    it('should reject request without Authorization header', async () => {
      const response = await request(app).get('/api/test');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Missing or invalid Authorization header');
    });

    it('should reject request with invalid Authorization header', async () => {
      const response = await request(app)
        .get('/api/test')
        .set('Authorization', 'Invalid header');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Missing or invalid Authorization header');
    });
  });
});
