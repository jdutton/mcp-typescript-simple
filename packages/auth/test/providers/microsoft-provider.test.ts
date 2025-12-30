import { vi } from 'vitest';

import type { Request } from 'express';
import type {
  MicrosoftOAuthConfig
} from '@mcp-typescript-simple/auth';
import { logger } from '@mcp-typescript-simple/auth';
import { MemoryPKCEStore } from '@mcp-typescript-simple/persistence';

import {
  createMockResponse,
  setupFetchMocking,
  testAuthorizationRequestParams,
  testAntiCachingHeaders,
  testAuthorizationCallbackSuccess,
  testOAuthCallbackErrors,
  createTestAuthCache,
  testCachedAuthentication,
  testTokenExchangeSuccess,
  testSilentCodeVerifierMissing,
  testTokenRefreshFlow,
  testTokenRefreshMissingToken,
  testLogoutFlow,
  testVerifyAccessTokenValid,
  testVerifyAccessTokenFetchesUserInfo,
  testVerifyAccessTokenInvalid,
  testGetUserInfoSuccess,
  testGetUserInfoFromAPI,
  testGetUserInfoError,
  testProviderMetadata
} from './test-helpers.js';

const fetchMock = vi.fn() as MockFunction<typeof fetch>;
const { setupFetchBeforeAll, restoreFetchAfterAll, resetMocksBeforeEach } = setupFetchMocking(fetchMock);

const baseConfig: MicrosoftOAuthConfig = {
  type: 'microsoft',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://example.com/callback',
  scopes: ['openid', 'profile', 'email'],
  tenantId: 'common'
};

let MicrosoftOAuthProvider: typeof import('@mcp-typescript-simple/auth').MicrosoftOAuthProvider;

/**
 * Helper to create a valid JWT token (simplified format for testing)
 */
function createTestJWT(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = Buffer.from('fake-signature').toString('base64url');
  return `${header}.${payloadStr}.${signature}`;
}

beforeAll(async () => {
  ({ MicrosoftOAuthProvider } = await import('@mcp-typescript-simple/auth'));
});

describe('MicrosoftOAuthProvider', () => {
  beforeAll(setupFetchBeforeAll);
  afterAll(restoreFetchAfterAll);
  beforeEach(resetMocksBeforeEach);

  const createProvider = () => {
    return new MicrosoftOAuthProvider(baseConfig, undefined, new MemoryPKCEStore());
  };

  describe('handleAuthorizationRequest', () => {
    // eslint-disable-next-line sonarjs/assertions-in-tests
    it('redirects to authorization URL with correct parameters', async () => {
      await testAuthorizationRequestParams(createProvider, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests
    it('sets anti-caching headers', async () => {
      await testAntiCachingHeaders(createProvider);
    });
  });

  describe('handleAuthorizationCallback', () => {
    it('exchanges code for tokens and fetches user info', testAuthorizationCallbackSuccess(
      createProvider,
      {
        provider: 'microsoft',
        redirectUri: baseConfig.redirectUri,
        scopes: baseConfig.scopes,
        mockTokenResponse: {
          access_token: 'access-token',
          token_type: 'Bearer',
          scope: 'openid profile email',
          expires_in: 3600,
          refresh_token: 'refresh-token'
        },
        mockUserResponses: [
          {
            id: 'user123',
            mail: 'test@example.com',
            displayName: 'Test User'
          }
        ],
        expectedUser: {
          sub: 'user123',
          email: 'test@example.com',
          name: 'Test User',
          provider: 'microsoft'
        },
        expectedTokenResponse: {
          access_token: 'access-token',
          token_type: 'Bearer',
          expires_in: 3600
        }
      }
    ));

    describe('OAuth callback error handling', testOAuthCallbackErrors(
      createProvider,
      {
        redirectUri: baseConfig.redirectUri,
        scopes: baseConfig.scopes,
        provider: 'microsoft'
      }
    ));
  });

  describe('handleTokenExchange', () => {
    it('exchanges authorization code for access token', testTokenExchangeSuccess(
      createProvider,
      {
        authCode: 'auth-code-123',
        codeVerifier: 'verifier-123',
        redirectUri: baseConfig.redirectUri,
        provider: 'microsoft',
        tokenResponse: {
          access_token: 'new-access-token',
          token_type: 'Bearer',
          scope: 'openid profile email',
          expires_in: 3600,
          refresh_token: 'refresh-token'
        },
        userInfoResponse: {
          id: 'user456',
          mail: 'dev@example.com',
          displayName: 'Developer User'
        },
        setupCodeVerifier: async (provider, authCode, codeVerifier) => {
          const pkceStore = (provider as any).pkceStore;
          await pkceStore.storeCodeVerifier(`microsoft:${authCode}`, {
            codeVerifier,
            state: 'test-state'
          }, 600);
        }
      }
    ));

    it('returns silently when code_verifier is missing (not my code)', testSilentCodeVerifierMissing(
      createProvider,
      baseConfig.redirectUri
    ));
  });

  describe('handleTokenRefresh', () => {
    it('refreshes tokens using the Microsoft token endpoint', testTokenRefreshFlow(
      createProvider,
      {
        refreshToken: 'refresh-token',
        tokenResponse: {
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 7200
        },
        expectedTokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
      }
    ));

    it('rejects refresh requests with unknown refresh tokens', async () => {
      const provider = createProvider();
      const res = createMockResponse();

      // Mock Microsoft API returning error for invalid refresh token
      fetchMock.mockResolvedValueOnce(new Response('Invalid grant', { status: 400 }));

      await testTokenRefreshMissingToken(provider, res);
      expect(res.status).toHaveBeenCalledWith(401); // Verify helper assertions executed

      provider.dispose();
    });
  });

  describe('handleLogout', () => {
    describe('standard logout flow', testLogoutFlow(createProvider));

    it('succeeds even when revocation fails', async () => {
      const provider = createProvider();

      // ADR 006: No server-side token storage, just test revocation behavior
      // Mock revocation failure
      fetchMock.mockResolvedValueOnce(new Response('error', {
        status: 500,
        statusText: 'Error'
      }));

      const consoleWarnSpy = vi.spyOn(logger, 'oauthWarn').mockImplementation(() => { /* no-op mock */ });
      const consoleErrorSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => { /* no-op mock */ });

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
    it('verifies valid token from cache', testVerifyAccessTokenValid(
      createProvider,
      {
        accessToken: 'valid-token',
        mockUserResponse: {
          id: 'user789',
          mail: 'verified@example.com',
          displayName: 'Verified User'
        },
        expectedScopes: baseConfig.scopes,
        expectedUserInfo: {
          email: 'verified@example.com',
          name: 'Verified User'
        }
      }
    ));

    it('fetches user info if token not in cache', testVerifyAccessTokenFetchesUserInfo(
      createProvider,
      {
        accessToken: 'uncached-token',
        mockUserResponse: {
          id: 'user999',
          mail: 'fetched@example.com',
          displayName: 'Fetched User'
        },
        expectedUserInfo: {
          email: 'fetched@example.com',
          name: 'Fetched User'
        }
      }
    ));

    it('throws error for invalid token', testVerifyAccessTokenInvalid(
      createProvider,
      'invalid-token'
    ));
  });

  // Microsoft-specific: Tests caching of user info with Microsoft's id/mail/displayName structure
  describe('getUserInfo', () => {
    it('returns cached user info', testGetUserInfoSuccess(
      createProvider,
      {
        accessToken: 'cached-info-token',
        mockUserResponse: {
          id: 'user101',
          mail: 'cached@example.com',
          displayName: 'Cached User'
        },
        expectedUserInfo: {
          sub: 'user101',
          email: 'cached@example.com',
          name: 'Cached User',
          provider: 'microsoft'
        }
      }
    ));

    it('fetches user info from API if not cached', testGetUserInfoFromAPI(
      createProvider,
      {
        accessToken: 'api-fetch-token',
        mockUserResponse: {
          id: 'user202',
          mail: 'api@example.com',
          displayName: 'API User'
        },
        expectedUserInfo: {
          sub: 'user202',
          email: 'api@example.com',
          name: 'API User',
          provider: 'microsoft'
        }
      }
    ));

    it('throws when Microsoft user info cannot be retrieved', testGetUserInfoError(
      createProvider,
      {
        accessToken: 'token',
        errorStatus: 403,
        errorStatusText: 'Forbidden',
        expectedErrorMessage: 'Failed to get user information'
      }
    ));
  });

  describe('provider metadata', testProviderMetadata(
    createProvider,
    {
      type: 'microsoft',
      name: 'Microsoft',
      authEndpoint: '/auth/microsoft',
      callbackEndpoint: '/auth/microsoft/callback',
      refreshEndpoint: '/auth/microsoft/refresh',
      logoutEndpoint: '/auth/microsoft/logout',
      defaultScopes: ['openid', 'profile', 'email']
    }
  ));

  describe('JWT Validation (ADR 006)', () => {
    it('should validate ID token locally by checking expiry and audience', async () => {
      const provider = createProvider();

      const validPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        aud: baseConfig.clientId,
        exp: Math.floor(Date.now() / 1000) + 3600 // Valid for 1 hour
      };

      const authCache = createTestAuthCache({
        provider: 'microsoft',
        clientId: baseConfig.clientId,
        idToken: createTestJWT(validPayload),
        userInfo: {
          sub: 'user-123',
          email: 'test@example.com'
        }
      });

      const result = await (provider as any).canUseCachedAuthentication(authCache);

      expect(result).toBe(true);

      provider.dispose();
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests
    it('should reject expired ID tokens', async () => {
      const expiredPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        aud: baseConfig.clientId,
        exp: Math.floor(Date.now() / 1000) - 3600 // Expired 1 hour ago
      };

      await testCachedAuthentication(
        createProvider,
        {
          provider: 'microsoft',
          clientId: baseConfig.clientId,
          idToken: createTestJWT(expiredPayload),
          userInfo: { sub: 'user-123', email: 'test@example.com' }
        },
        false
      );
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests
    it('should reject tokens with audience mismatch', async () => {
      const mismatchedPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        aud: 'wrong-client-id',
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      await testCachedAuthentication(
        createProvider,
        {
          provider: 'microsoft',
          clientId: baseConfig.clientId,
          idToken: createTestJWT(mismatchedPayload),
          userInfo: { sub: 'user-123', email: 'test@example.com' }
        },
        false
      );
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests
    it('should reject malformed JWT tokens (invalid structure)', async () => {
      await testCachedAuthentication(
        createProvider,
        {
          provider: 'microsoft',
          clientId: baseConfig.clientId,
          idToken: 'invalid.jwt', // Only 2 parts instead of 3
          userInfo: { sub: 'user-123', email: 'test@example.com' }
        },
        false
      );
    });

    it('should reject JWT with invalid JSON payload', async () => {
      const provider = createProvider();

      // Create JWT with invalid JSON in payload
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const invalidPayload = Buffer.from('not-valid-json{').toString('base64url');
      const signature = Buffer.from('fake-signature').toString('base64url');
      const invalidJWT = `${header}.${invalidPayload}.${signature}`;

      const authCache = createTestAuthCache({
        provider: 'microsoft',
        clientId: baseConfig.clientId,
        idToken: invalidJWT,
        userInfo: {
          sub: 'user-123',
          email: 'test@example.com'
        }
      });

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

      const authCache = createTestAuthCache({
        provider: 'microsoft',
        clientId: baseConfig.clientId,
        idToken: createTestJWT(payloadNoExp),
        userInfo: {
          sub: 'user-123',
          email: 'test@example.com'
        }
      });

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

      const authCache = createTestAuthCache({
        provider: 'microsoft',
        clientId: baseConfig.clientId,
        idToken: createTestJWT(payloadNoAud),
        userInfo: {
          sub: 'user-123',
          email: 'test@example.com'
        }
      });

      const result = await (provider as any).canUseCachedAuthentication(authCache);

      // Should accept token without audience (validation is optional)
      expect(result).toBe(true);

      provider.dispose();
    });

    it('should fallback to TTL-based caching when no ID token available', async () => {
      const provider = createProvider();

      const authCache = createTestAuthCache({
        provider: 'microsoft',
        clientId: baseConfig.clientId,
        // No idToken - only userInfo
        userInfo: {
          sub: 'user-123',
          email: 'test@example.com'
        }
      });

      const result = await (provider as any).canUseCachedAuthentication(authCache);

      // Should return true because within TTL
      expect(result).toBe(true);

      provider.dispose();
    });

    it('should fallback to TTL-based caching and return false when TTL expired', async () => {
      const provider = createProvider();

      const authCache = createTestAuthCache({
        provider: 'microsoft',
        clientId: baseConfig.clientId,
        lastValidated: Date.now() - 600000, // 10 minutes ago (beyond 5-minute TTL)
        // No idToken - only userInfo
        userInfo: {
          sub: 'user-123',
          email: 'test@example.com'
        }
      });

      const result = await (provider as any).canUseCachedAuthentication(authCache);

      // Should return false because TTL expired
      expect(result).toBe(false);

      provider.dispose();
    });
  });
});
