import { vi } from 'vitest';

import type { Request } from 'express';
import type {
  MicrosoftOAuthConfig,
  OAuthSession,
  OAuthUserInfo
} from '@mcp-typescript-simple/auth';
import { logger } from '@mcp-typescript-simple/auth';
import { MemoryPKCEStore } from '@mcp-typescript-simple/persistence';

import { createMockResponse, jsonReply, testAuthorizationRequestParams, testAntiCachingHeaders } from './test-helpers.js';

/* eslint-disable sonarjs/no-unused-vars */
let originalFetch: typeof globalThis.fetch;
const fetchMock = vi.fn() as MockFunction<typeof fetch>;

const baseConfig: MicrosoftOAuthConfig = {
  type: 'microsoft',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://example.com/callback',
  scopes: ['openid', 'profile', 'email'],
  tenantId: 'common'
};

let MicrosoftOAuthProvider: typeof import('@mcp-typescript-simple/auth').MicrosoftOAuthProvider;

beforeAll(async () => {
  ({ MicrosoftOAuthProvider } = await import('@mcp-typescript-simple/auth'));
});

describe('MicrosoftOAuthProvider', () => {
  beforeAll(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.clearAllMocks();
  });

  const createProvider = () => {
    return new MicrosoftOAuthProvider(baseConfig, undefined, new MemoryPKCEStore());
  };

  describe('handleAuthorizationRequest', () => {
    it('redirects to authorization URL with correct parameters', async () => {
      await testAuthorizationRequestParams(createProvider, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    });

    it('sets anti-caching headers', async () => {
      await testAntiCachingHeaders(createProvider);
    });
  });

  describe('handleAuthorizationCallback', () => {
    it('exchanges code for tokens and fetches user info', async () => {
      const provider = createProvider();
      const now = Date.now();

      // Store a session first
      (provider as unknown as { storeSession: (_state: string, _session: OAuthSession) => void }).storeSession('state123', {
        state: 'state123',
        codeVerifier: 'verifier',
        codeChallenge: 'challenge',
        redirectUri: baseConfig.redirectUri,
        scopes: baseConfig.scopes,
        provider: 'microsoft',
        expiresAt: now + 5_000
      });

      // Mock token exchange response
      fetchMock.mockResolvedValueOnce(jsonReply({
        access_token: 'access-token',
        token_type: 'Bearer',
        scope: 'openid profile email',
        expires_in: 3600,
        refresh_token: 'refresh-token'
      }));

      // Mock Microsoft user response
      fetchMock.mockResolvedValueOnce(jsonReply({
        id: 'user123',
        mail: 'test@example.com',
        displayName: 'Test User'
      }));

      const res = createMockResponse();
      const req = {
        query: {
          code: 'auth-code',
          state: 'state123'
        }
      } as unknown as Request;

      await provider.handleAuthorizationCallback(req, res);

      expect(res.json).toHaveBeenCalledTimes(1);
      expect(res.jsonPayload).toMatchObject({
        access_token: 'access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        user: {
          sub: 'user123',
          email: 'test@example.com',
          name: 'Test User',
          provider: 'microsoft'
        }
      });

      provider.dispose();
    });

    it('returns error if code is missing', async () => {
      const provider = createProvider();
      const res = createMockResponse();
      const req = {
        query: {
          state: 'state123'
        }
      } as unknown as Request;

      await provider.handleAuthorizationCallback(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Missing authorization code or state'
      });

      provider.dispose();
    });

    it('returns error if OAuth provider returns error', async () => {
      const provider = createProvider();
      const res = createMockResponse();
      const req = {
        query: {
          error: 'access_denied',
          error_description: 'User denied access'
        }
      } as unknown as Request;

      const loggerErrorSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

      await provider.handleAuthorizationCallback(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authorization failed',
        details: 'access_denied'
      });

      loggerErrorSpy.mockRestore();
      provider.dispose();
    });

    it('returns error when token exchange does not provide access token', async () => {
      const provider = createProvider();
      const now = Date.now();

      const loggerErrorSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

      (provider as unknown as { storeSession: (_state: string, _session: OAuthSession) => void }).storeSession('state123', {
        state: 'state123',
        codeVerifier: 'verifier',
        codeChallenge: 'challenge',
        redirectUri: baseConfig.redirectUri,
        scopes: baseConfig.scopes,
        provider: 'microsoft',
        expiresAt: now + 5_000
      });

      // Mock empty token response
      fetchMock.mockResolvedValueOnce(jsonReply({}));

      const res = createMockResponse();
      const req = {
        query: {
          code: 'code123',
          state: 'state123'
        }
      } as unknown as Request;

      await provider.handleAuthorizationCallback(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Authorization failed' }));

      loggerErrorSpy.mockRestore();
      provider.dispose();
    });
  });

  describe('handleTokenExchange', () => {
    it('exchanges authorization code for access token', async () => {
      const provider = createProvider();
      const _now = Date.now();

      const authCode = 'auth-code-123';
      const codeVerifier = 'verifier-123';

      // Store PKCE mapping using pkceStore
      const pkceStore = (provider as any).pkceStore;
      await pkceStore.storeCodeVerifier(`microsoft:${authCode}`, {
        codeVerifier,
        state: 'test-state'
      }, 600);

      // Mock token exchange response
      fetchMock.mockResolvedValueOnce(jsonReply({
        access_token: 'new-access-token',
        token_type: 'Bearer',
        scope: 'openid profile email',
        expires_in: 3600,
        refresh_token: 'refresh-token'
      }));

      // Mock Microsoft user response
      fetchMock.mockResolvedValueOnce(jsonReply({
        id: 'user456',
        mail: 'dev@example.com',
        displayName: 'Developer User'
      }));

      const res = createMockResponse();
      const req = {
        body: {
          grant_type: 'authorization_code',
          code: authCode,
          code_verifier: codeVerifier,
          redirect_uri: baseConfig.redirectUri
        }
      } as unknown as Request;

      await provider.handleTokenExchange(req, res);

      expect(res.json).toHaveBeenCalledTimes(1);
      expect(res.jsonPayload).toMatchObject({
        access_token: 'new-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh-token'
      });

      provider.dispose();
    });

    it('returns silently when code_verifier is missing (not my code)', async () => {
      const provider = createProvider();

      const res = createMockResponse();
      const req = {
        body: {
          grant_type: 'authorization_code',
          code: 'some-code',
          redirect_uri: baseConfig.redirectUri
        }
      } as unknown as Request;

      await provider.handleTokenExchange(req, res);

      // Should return without sending any response (let loop try next provider)
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();

      provider.dispose();
    });
  });

  describe('handleTokenRefresh', () => {
    it('refreshes tokens using the Microsoft token endpoint', async () => {
      const provider = createProvider();

      // ADR 006: No server-side token storage, just exchange refresh token for new access token
      fetchMock.mockResolvedValueOnce(jsonReply({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 7200
      }));

      const res = createMockResponse();

      await provider.handleTokenRefresh({
        body: { refresh_token: 'refresh-token' }
      } as unknown as Request, res);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        expect.objectContaining({ method: 'POST' })
      );
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        access_token: 'new-access',
        refresh_token: 'new-refresh'
      }));

      provider.dispose();
    });

    it('rejects refresh requests with unknown refresh tokens', async () => {
      const provider = createProvider();
      const res = createMockResponse();

      // Mock Microsoft API returning error for invalid refresh token
      fetchMock.mockResolvedValueOnce(new Response('Invalid grant', { status: 400 }));

      await provider.handleTokenRefresh({
        body: { refresh_token: 'unknown' },
        headers: { host: 'localhost:3000' },
        secure: false
      } as unknown as Request, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Failed to refresh token'
      }));

      provider.dispose();
    });
  });

  describe('handleLogout', () => {
    it('removes token on logout', async () => {
      const provider = createProvider();
      const accessToken = 'token-to-remove';

      // Store a token first
      const _userInfo: OAuthUserInfo = {
        sub: 'user123',
        email: 'test@example.com',
        name: 'Test User',
        provider: 'microsoft'
      };

      

      // Mock successful revocation
      fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));

      const res = createMockResponse();
      const req = {
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      } as unknown as Request;

      await provider.handleLogout(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true });

      provider.dispose();
    });

    it('succeeds even without authorization header', async () => {
      const provider = createProvider();
      const res = createMockResponse();
      const req = {
        headers: {}
      } as unknown as Request;

      await provider.handleLogout(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true });

      provider.dispose();
    });

    it('succeeds even when revocation fails', async () => {
      const provider = createProvider();

      // ADR 006: No server-side token storage, just test revocation behavior
      // Mock revocation failure
      fetchMock.mockResolvedValueOnce(new Response('error', {
        status: 500,
        statusText: 'Error'
      }));

      const consoleWarnSpy = vi.spyOn(logger, 'oauthWarn').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

      const res = createMockResponse();
      await provider.handleLogout({
        headers: { authorization: 'Bearer access-token' }
      } as Request, res);

      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true });

      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      provider.dispose();
    });
  });

  describe('verifyAccessToken', () => {
    it('verifies valid token from cache', async () => {
      const provider = createProvider();
      const accessToken = 'valid-token';

      // ADR 006: Always verify via API (no server-side caching)
      fetchMock.mockResolvedValueOnce(jsonReply({
        id: 'user789',
        mail: 'verified@example.com',
        displayName: 'Verified User'
      }));

      const authInfo = await provider.verifyAccessToken(accessToken);

      expect(authInfo).toMatchObject({
        scopes: baseConfig.scopes,
        extra: {
          userInfo: {
            email: 'verified@example.com',
            name: 'Verified User'
          }
        }
      });

      provider.dispose();
    });

    it('fetches user info if token not in cache', async () => {
      const provider = createProvider();
      const accessToken = 'uncached-token';

      // Mock Microsoft user response
      fetchMock.mockResolvedValueOnce(jsonReply({
        id: 'user999',
        mail: 'fetched@example.com',
        displayName: 'Fetched User'
      }));

      const authInfo = await provider.verifyAccessToken(accessToken);

      expect(authInfo).toMatchObject({
        extra: {
          userInfo: {
            email: 'fetched@example.com',
            name: 'Fetched User'
          }
        }
      });

      provider.dispose();
    });

    it('throws error for invalid token', async () => {
      const provider = createProvider();
      const invalidToken = 'invalid-token';

      // Mock failed Microsoft response
      fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      const loggerErrorSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

      await expect(provider.verifyAccessToken(invalidToken)).rejects.toThrow();

      loggerErrorSpy.mockRestore();
      provider.dispose();
    });
  });

  describe('getUserInfo', () => {
    it('returns cached user info', async () => {
      const provider = createProvider();
      const accessToken = 'cached-info-token';
      const userInfo: OAuthUserInfo = {
        sub: 'user101',
        email: 'cached@example.com',
        name: 'Cached User',
        provider: 'microsoft'
      };

      // ADR 006: Always fetch from Microsoft API (no server-side caching)
      fetchMock.mockResolvedValueOnce(jsonReply({
        id: 'user101',
        mail: 'cached@example.com',
        displayName: 'Cached User'
      }));

      const result = await provider.getUserInfo(accessToken);

      expect(result).toMatchObject(userInfo);

      provider.dispose();
    });

    it('fetches user info from API if not cached', async () => {
      const provider = createProvider();
      const accessToken = 'api-fetch-token';

      // Mock Microsoft user response
      fetchMock.mockResolvedValueOnce(jsonReply({
        id: 'user202',
        mail: 'api@example.com',
        displayName: 'API User'
      }));

      const result = await provider.getUserInfo(accessToken);

      expect(result).toMatchObject({
        sub: 'user202',
        email: 'api@example.com',
        name: 'API User',
        provider: 'microsoft'
      });

      provider.dispose();
    });

    it('throws when Microsoft user info cannot be retrieved', async () => {
      const provider = createProvider();

      const consoleSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

      fetchMock.mockResolvedValueOnce(new Response('forbidden', {
        status: 403,
        statusText: 'Forbidden'
      }));

      await expect(provider.getUserInfo('token')).rejects.toThrow('Failed to get user information');

      consoleSpy.mockRestore();
      provider.dispose();
    });
  });

  describe('provider metadata', () => {
    it('returns correct provider type', () => {
      const provider = createProvider();
      expect(provider.getProviderType()).toBe('microsoft');
      provider.dispose();
    });

    it('returns correct provider name', () => {
      const provider = createProvider();
      expect(provider.getProviderName()).toBe('Microsoft');
      provider.dispose();
    });

    it('returns correct endpoints', () => {
      const provider = createProvider();
      const endpoints = provider.getEndpoints();

      expect(endpoints).toEqual({
        authEndpoint: '/auth/microsoft',
        callbackEndpoint: '/auth/microsoft/callback',
        refreshEndpoint: '/auth/microsoft/refresh',
        logoutEndpoint: '/auth/microsoft/logout'
      });

      provider.dispose();
    });

    it('returns correct default scopes', () => {
      const provider = createProvider();
      expect(provider.getDefaultScopes()).toEqual(['openid', 'profile', 'email']);
      provider.dispose();
    });
  });

  describe('JWT Validation (ADR 006)', () => {
    // Helper to create a valid JWT token (simplified format for testing)
    function createTestJWT(payload: Record<string, unknown>): string {
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const signature = Buffer.from('fake-signature').toString('base64url');
      return `${header}.${payloadStr}.${signature}`;
    }

    it('should validate ID token locally by checking expiry and audience', async () => {
      const provider = createProvider();

      const validPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        aud: baseConfig.clientId,
        exp: Math.floor(Date.now() / 1000) + 3600 // Valid for 1 hour
      };

      const authCache = {
        provider: 'microsoft' as const,
        userId: 'user-123',
        tokenHash: 'test-hash',
        tokenBindingTime: Date.now(),
        lastValidated: Date.now(),
        validationTTL: 300000,
        scopes: ['openid', 'email'],
        authInfo: {
          token: 'test-token',
          clientId: baseConfig.clientId,
          scopes: ['openid', 'email'],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          extra: {
            idToken: createTestJWT(validPayload),
            userInfo: {
              sub: 'user-123',
              email: 'test@example.com'
            }
          }
        }
      };

      const result = await (provider as any).canUseCachedAuthentication(authCache);

      expect(result).toBe(true);

      provider.dispose();
    });

    it('should reject expired ID tokens', async () => {
      const provider = createProvider();

      const expiredPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        aud: baseConfig.clientId,
        exp: Math.floor(Date.now() / 1000) - 3600 // Expired 1 hour ago
      };

      const authCache = {
        provider: 'microsoft' as const,
        userId: 'user-123',
        tokenHash: 'test-hash',
        tokenBindingTime: Date.now(),
        lastValidated: Date.now(),
        validationTTL: 300000,
        scopes: ['openid', 'email'],
        authInfo: {
          token: 'test-token',
          clientId: baseConfig.clientId,
          scopes: ['openid', 'email'],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          extra: {
            idToken: createTestJWT(expiredPayload),
            userInfo: {
              sub: 'user-123',
              email: 'test@example.com'
            }
          }
        }
      };

      const result = await (provider as any).canUseCachedAuthentication(authCache);

      expect(result).toBe(false);

      provider.dispose();
    });

    it('should reject tokens with audience mismatch', async () => {
      const provider = createProvider();

      const mismatchedPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        aud: 'wrong-client-id',
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const authCache = {
        provider: 'microsoft' as const,
        userId: 'user-123',
        tokenHash: 'test-hash',
        tokenBindingTime: Date.now(),
        lastValidated: Date.now(),
        validationTTL: 300000,
        scopes: ['openid', 'email'],
        authInfo: {
          token: 'test-token',
          clientId: baseConfig.clientId,
          scopes: ['openid', 'email'],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          extra: {
            idToken: createTestJWT(mismatchedPayload),
            userInfo: {
              sub: 'user-123',
              email: 'test@example.com'
            }
          }
        }
      };

      const result = await (provider as any).canUseCachedAuthentication(authCache);

      expect(result).toBe(false);

      provider.dispose();
    });

    it('should reject malformed JWT tokens (invalid structure)', async () => {
      const provider = createProvider();

      const authCache = {
        provider: 'microsoft' as const,
        userId: 'user-123',
        tokenHash: 'test-hash',
        tokenBindingTime: Date.now(),
        lastValidated: Date.now(),
        validationTTL: 300000,
        scopes: ['openid', 'email'],
        authInfo: {
          token: 'test-token',
          clientId: baseConfig.clientId,
          scopes: ['openid', 'email'],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          extra: {
            idToken: 'invalid.jwt', // Only 2 parts instead of 3
            userInfo: {
              sub: 'user-123',
              email: 'test@example.com'
            }
          }
        }
      };

      const result = await (provider as any).canUseCachedAuthentication(authCache);

      expect(result).toBe(false);

      provider.dispose();
    });

    it('should reject JWT with invalid JSON payload', async () => {
      const provider = createProvider();

      // Create JWT with invalid JSON in payload
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const invalidPayload = Buffer.from('not-valid-json{').toString('base64url');
      const signature = Buffer.from('fake-signature').toString('base64url');
      const invalidJWT = `${header}.${invalidPayload}.${signature}`;

      const authCache = {
        provider: 'microsoft' as const,
        userId: 'user-123',
        tokenHash: 'test-hash',
        tokenBindingTime: Date.now(),
        lastValidated: Date.now(),
        validationTTL: 300000,
        scopes: ['openid', 'email'],
        authInfo: {
          token: 'test-token',
          clientId: baseConfig.clientId,
          scopes: ['openid', 'email'],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          extra: {
            idToken: invalidJWT,
            userInfo: {
              sub: 'user-123',
              email: 'test@example.com'
            }
          }
        }
      };

      const result = await (provider as any).canUseCachedAuthentication(authCache);

      expect(result).toBe(false);

      provider.dispose();
    });

    it('should accept token without expiry claim', async () => {
      const provider = createProvider();

      const payloadNoExp = {
        sub: 'user-123',
        email: 'test@example.com',
        aud: baseConfig.clientId
        // No exp field
      };

      const authCache = {
        provider: 'microsoft' as const,
        userId: 'user-123',
        tokenHash: 'test-hash',
        tokenBindingTime: Date.now(),
        lastValidated: Date.now(),
        validationTTL: 300000,
        scopes: ['openid', 'email'],
        authInfo: {
          token: 'test-token',
          clientId: baseConfig.clientId,
          scopes: ['openid', 'email'],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          extra: {
            idToken: createTestJWT(payloadNoExp),
            userInfo: {
              sub: 'user-123',
              email: 'test@example.com'
            }
          }
        }
      };

      const result = await (provider as any).canUseCachedAuthentication(authCache);

      // Should accept token without expiry (but log warning)
      expect(result).toBe(true);

      provider.dispose();
    });

    it('should accept token without audience claim', async () => {
      const provider = createProvider();

      const payloadNoAud = {
        sub: 'user-123',
        email: 'test@example.com',
        exp: Math.floor(Date.now() / 1000) + 3600
        // No aud field
      };

      const authCache = {
        provider: 'microsoft' as const,
        userId: 'user-123',
        tokenHash: 'test-hash',
        tokenBindingTime: Date.now(),
        lastValidated: Date.now(),
        validationTTL: 300000,
        scopes: ['openid', 'email'],
        authInfo: {
          token: 'test-token',
          clientId: baseConfig.clientId,
          scopes: ['openid', 'email'],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          extra: {
            idToken: createTestJWT(payloadNoAud),
            userInfo: {
              sub: 'user-123',
              email: 'test@example.com'
            }
          }
        }
      };

      const result = await (provider as any).canUseCachedAuthentication(authCache);

      // Should accept token without audience (validation is optional)
      expect(result).toBe(true);

      provider.dispose();
    });

    it('should fallback to TTL-based caching when no ID token available', async () => {
      const provider = createProvider();

      const authCache = {
        provider: 'microsoft' as const,
        userId: 'user-123',
        tokenHash: 'test-hash',
        tokenBindingTime: Date.now(),
        lastValidated: Date.now(),
        validationTTL: 300000, // 5 minutes
        scopes: ['openid', 'email'],
        authInfo: {
          token: 'test-token',
          clientId: baseConfig.clientId,
          scopes: ['openid', 'email'],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          extra: {
            // No idToken field
            userInfo: {
              sub: 'user-123',
              email: 'test@example.com'
            }
          }
        }
      };

      const result = await (provider as any).canUseCachedAuthentication(authCache);

      // Should return true because within TTL
      expect(result).toBe(true);

      provider.dispose();
    });

    it('should fallback to TTL-based caching and return false when TTL expired', async () => {
      const provider = createProvider();

      const authCache = {
        provider: 'microsoft' as const,
        userId: 'user-123',
        tokenHash: 'test-hash',
        tokenBindingTime: Date.now(),
        lastValidated: Date.now() - 600000, // 10 minutes ago (beyond 5-minute TTL)
        validationTTL: 300000, // 5 minutes
        scopes: ['openid', 'email'],
        authInfo: {
          token: 'test-token',
          clientId: baseConfig.clientId,
          scopes: ['openid', 'email'],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          extra: {
            // No idToken field
            userInfo: {
              sub: 'user-123',
              email: 'test@example.com'
            }
          }
        }
      };

      const result = await (provider as any).canUseCachedAuthentication(authCache);

      // Should return false because TTL expired
      expect(result).toBe(false);

      provider.dispose();
    });
  });
});
