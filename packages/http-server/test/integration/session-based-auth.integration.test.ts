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
  OAuthConfig,
  OAuthProviderType,
  OAuthUserInfo,
  SessionAuthCache
} from '@mcp-typescript-simple/auth';
import { BaseOAuthProvider } from '@mcp-typescript-simple/auth';
import { MemorySessionManager } from '../../src/session/memory-session-manager.js';
import { MemoryPKCEStore } from '@mcp-typescript-simple/persistence';

// Mock OAuth provider for testing
class MockOAuthProvider extends BaseOAuthProvider {
  public mockFetchUserInfo: ((_token: string) => Promise<OAuthUserInfo>) | null = null;

  constructor(
    config: OAuthConfig,
    private readonly _providerType: OAuthProviderType,
    pkceStore: MemoryPKCEStore
  ) {
    super(config, undefined, pkceStore);
  }

  getProviderType(): OAuthProviderType {
    return this._providerType;
  }

  getProviderName(): string {
    return this._providerType;
  }

  getEndpoints() {
    return {
      authEndpoint: `/auth/${this._providerType}`,
      callbackEndpoint: `/auth/${this._providerType}/callback`,
      refreshEndpoint: `/auth/${this._providerType}/refresh`,
      logoutEndpoint: `/auth/${this._providerType}/logout`
    };
  }

  getDefaultScopes(): string[] {
    return ['openid', 'profile', 'email'];
  }

  async handleAuthorizationRequest(_req: Request, _res: Response): Promise<void> {}
  async handleAuthorizationCallback(_req: Request, _res: Response): Promise<void> {}
  async handleTokenRefresh(_req: Request, _res: Response): Promise<void> {}
  async handleLogout(_req: Request, _res: Response): Promise<void> {}

  async verifyAccessToken(token: string) {
    return {
      token,
      clientId: this._config.clientId,
      scopes: ['openid', 'profile', 'email'],
      expiresAt: Math.floor((Date.now() + 3600000) / 1000),
      extra: {
        userInfo: await this.getUserInfo(token),
        provider: this._providerType
      }
    };
  }

  async getUserInfo(token: string): Promise<OAuthUserInfo> {
    if (this.mockFetchUserInfo) {
      return this.mockFetchUserInfo(token);
    }
    return {
      sub: 'user-123',
      name: 'Test User',
      email: 'test@example.com',
      provider: this._providerType
    };
  }

  protected async fetchUserInfo(token: string): Promise<OAuthUserInfo> {
    return this.getUserInfo(token);
  }

  // Mock implementation for legacy O(N) authentication testing
  async hasToken(token: string): Promise<boolean> {
    // ADR 006: No server-side token storage, but for testing backward compatibility
    // we simulate that the provider "has" known tokens
    return token === 'test-access-token';
  }

  // Expose protected method for testing
  public testHashToken(token: string): string {
    return this.hashToken(token);
  }
}

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
    // Create test providers
    const config: OAuthConfig = {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://localhost:3000/callback',
      scopes: ['openid', 'profile', 'email']
    };

    const pkceStore = new MemoryPKCEStore();
    googleProvider = new MockOAuthProvider(config, 'google', pkceStore);
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

  describe('Session-Based Authentication (O(1) Provider Lookup)', () => {
    it('should authenticate successfully with valid session and token', async () => {
      const token = 'test-access-token';
      const tokenHash = googleProvider.testHashToken(token);

      // Create session with auth cache
      const authCache: SessionAuthCache = {
        provider: 'google',
        userId: 'user-123',
        tokenHash,
        tokenBindingTime: Date.now(),
        lastValidated: Date.now(),
        validationTTL: 300000,
        scopes: ['openid', 'profile', 'email'],
        authInfo: {
          token,
          clientId: 'test-client-id',
          scopes: ['openid', 'profile', 'email'],
          expiresAt: Math.floor((Date.now() + 3600000) / 1000),
          extra: {
            userInfo: {
              sub: 'user-123',
              name: 'Test User',
              email: 'test@example.com',
              provider: 'google'
            }
          }
        }
      };

      const session = await sessionManager.createSession(undefined, { auth: authCache });

      const response = await request(app)
        .get('/api/test')
        .set('Authorization', `Bearer ${token}`)
        .set('mcp-session-id', session.sessionId);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user).toBeDefined();
      expect(response.body.user.sub).toBe('user-123');
      expect(response.body.user.provider).toBe('google');
      expect(response.body.provider).toBe('google');
    });

    it('should reject request when session not found', async () => {
      const token = 'test-access-token';

      const response = await request(app)
        .get('/api/test')
        .set('Authorization', `Bearer ${token}`)
        .set('mcp-session-id', 'nonexistent-session');

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Session not found');
    });

    it('should reject request when session not authenticated', async () => {
      const token = 'test-access-token';

      // Create session without auth cache
      const session = await sessionManager.createSession(undefined, {});

      const response = await request(app)
        .get('/api/test')
        .set('Authorization', `Bearer ${token}`)
        .set('mcp-session-id', session.sessionId);

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Session not found');
    });

    it('should reject request when provider not available', async () => {
      const token = 'test-access-token';
      const tokenHash = googleProvider.testHashToken(token);

      // Create session with auth cache for unknown provider
      const authCache: SessionAuthCache = {
        provider: 'github', // GitHub provider not registered
        userId: 'user-123',
        tokenHash,
        tokenBindingTime: Date.now(),
        lastValidated: Date.now(),
        validationTTL: 300000,
        scopes: ['openid', 'profile', 'email'],
        authInfo: {
          token,
          clientId: 'test-client-id',
          scopes: ['openid', 'profile', 'email'],
          expiresAt: Math.floor((Date.now() + 3600000) / 1000),
          extra: {
            userInfo: {
              sub: 'user-123',
              name: 'Test User',
              email: 'test@example.com',
              provider: 'google'
            }
          }
        }
      };

      const session = await sessionManager.createSession(undefined, { auth: authCache });

      const response = await request(app)
        .get('/api/test')
        .set('Authorization', `Bearer ${token}`)
        .set('mcp-session-id', session.sessionId);

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Provider not available');
    });

    it('should detect token refresh when hash mismatches', async () => {
      const oldToken = 'old-access-token';
      const newToken = 'new-access-token';
      const oldTokenHash = googleProvider.testHashToken(oldToken);

      // Create session with old token hash
      const authCache: SessionAuthCache = {
        provider: 'google',
        userId: 'user-123',
        tokenHash: oldTokenHash,
        tokenBindingTime: Date.now(),
        lastValidated: Date.now(),
        validationTTL: 300000,
        scopes: ['openid', 'profile', 'email'],
        authInfo: {
          token: oldToken,
          clientId: 'test-client-id',
          scopes: ['openid', 'profile', 'email'],
          expiresAt: Math.floor((Date.now() + 3600000) / 1000),
          extra: {
            userInfo: {
              sub: 'user-123',
              name: 'Test User',
              email: 'test@example.com',
              provider: 'google'
            }
          }
        }
      };

      const session = await sessionManager.createSession(undefined, { auth: authCache });

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

      // Create session with old token hash
      const authCache: SessionAuthCache = {
        provider: 'google',
        userId: 'user-123',
        tokenHash: oldTokenHash,
        tokenBindingTime: Date.now(),
        lastValidated: Date.now(),
        validationTTL: 300000,
        scopes: ['openid', 'profile', 'email'],
        authInfo: {
          token: oldToken,
          clientId: 'test-client-id',
          scopes: ['openid', 'profile', 'email'],
          expiresAt: Math.floor((Date.now() + 3600000) / 1000),
          extra: {
            userInfo: {
              sub: 'user-123',
              name: 'Test User',
              email: 'test@example.com',
              provider: 'google'
            }
          }
        }
      };

      const session = await sessionManager.createSession(undefined, { auth: authCache });

      // Mock fetchUserInfo to return different user ID (attack simulation)
      googleProvider.mockFetchUserInfo = async () => ({
        sub: 'user-456', // Different user!
        name: 'Attacker',
        email: 'attacker@example.com'
      });

      // Request with attacker token (should be rejected)
      const response = await request(app)
        .get('/api/test')
        .set('Authorization', `Bearer ${newToken}`)
        .set('mcp-session-id', session.sessionId);

      expect(response.status).toBe(401);
      expect(response.body.error).toContain('Token user mismatch');
    });

    it('should use cached auth when within TTL', async () => {
      const token = 'test-access-token';
      const tokenHash = googleProvider.testHashToken(token);

      // Create session with recent validation
      const authCache: SessionAuthCache = {
        provider: 'google',
        userId: 'user-123',
        tokenHash,
        tokenBindingTime: Date.now(),
        lastValidated: Date.now(),
        validationTTL: 300000, // 5 minutes
        scopes: ['openid', 'profile', 'email'],
        authInfo: {
          token,
          clientId: 'test-client-id',
          scopes: ['openid', 'profile', 'email'],
          expiresAt: Math.floor((Date.now() + 3600000) / 1000),
          extra: {
            userInfo: {
              sub: 'user-123',
              name: 'Test User',
              email: 'test@example.com',
              provider: 'google'
            }
          }
        }
      };

      const session = await sessionManager.createSession(undefined, { auth: authCache });

      // Track if fetchUserInfo is called
      let fetchCalled = false;
      googleProvider.mockFetchUserInfo = async () => {
        fetchCalled = true;
        return {
          sub: 'user-123',
          name: 'Test User',
          email: 'test@example.com'
        };
      };

      const response = await request(app)
        .get('/api/test')
        .set('Authorization', `Bearer ${token}`)
        .set('mcp-session-id', session.sessionId);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // Should use cached auth, no fetch call
      expect(fetchCalled).toBe(false);
    });

    it('should re-validate when TTL expired', async () => {
      const token = 'test-access-token';
      const tokenHash = googleProvider.testHashToken(token);

      // Create session with expired validation
      const authCache: SessionAuthCache = {
        provider: 'google',
        userId: 'user-123',
        tokenHash,
        tokenBindingTime: Date.now(),
        lastValidated: Date.now() - 600000, // 10 minutes ago (beyond 5-minute TTL)
        validationTTL: 300000,
        scopes: ['openid', 'profile', 'email'],
        authInfo: {
          token,
          clientId: 'test-client-id',
          scopes: ['openid', 'profile', 'email'],
          expiresAt: Math.floor((Date.now() + 3600000) / 1000),
          extra: {
            userInfo: {
              sub: 'user-123',
              name: 'Test User',
              email: 'test@example.com',
              provider: 'google'
            }
          }
        }
      };

      const session = await sessionManager.createSession(undefined, { auth: authCache });

      // Track if fetchUserInfo is called
      let fetchCalled = false;
      googleProvider.mockFetchUserInfo = async () => {
        fetchCalled = true;
        return {
          sub: 'user-123',
          name: 'Test User',
          email: 'test@example.com'
        };
      };

      const response = await request(app)
        .get('/api/test')
        .set('Authorization', `Bearer ${token}`)
        .set('mcp-session-id', session.sessionId);

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
