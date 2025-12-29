import { vi } from 'vitest';

import type { Request } from 'express';
import type {
  GenericOAuthConfig
} from '@mcp-typescript-simple/auth';
import { MemoryPKCEStore } from '@mcp-typescript-simple/persistence';

import {
  createMockResponse,
  setupFetchMocking,
  testAuthorizationRequestParams,
  testAntiCachingHeaders,
  testAuthorizationCallbackSuccess,
  testOAuthCallbackErrors,
  testTokenExchangeSuccess,
  testVerifyAccessTokenValid,
  testVerifyAccessTokenFetchesUserInfo,
  testVerifyAccessTokenInvalid,
  testGetUserInfoSuccess,
  testGetUserInfoFromAPI,
  testProviderMetadata
} from './test-helpers.js';

const fetchMock = vi.fn() as MockFunction<typeof fetch>;
const { setupFetchBeforeAll, restoreFetchAfterAll, resetMocksBeforeEach } = setupFetchMocking(fetchMock);

const baseConfig: GenericOAuthConfig = {
  type: 'generic',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://example.com/callback',
  scopes: ['openid', 'email', 'profile'],
  authorizationUrl: 'https://oauth.example.com/authorize',
  tokenUrl: 'https://oauth.example.com/token',
  userInfoUrl: 'https://oauth.example.com/userinfo',
  providerName: 'Test OAuth Provider'
};

let GenericOAuthProvider: typeof import('@mcp-typescript-simple/auth').GenericOAuthProvider;

beforeAll(async () => {
  ({ GenericOAuthProvider } = await import('@mcp-typescript-simple/auth'));
});

describe('GenericOAuthProvider', () => {
  beforeAll(setupFetchBeforeAll);
  afterAll(restoreFetchAfterAll);
  beforeEach(resetMocksBeforeEach);

  const createProvider = () => {
    return new GenericOAuthProvider(baseConfig, undefined, new MemoryPKCEStore());
  };

  describe('handleAuthorizationRequest', () => {
    // eslint-disable-next-line sonarjs/assertions-in-tests
    it('redirects to authorization URL with correct parameters', async () => {
      await testAuthorizationRequestParams(createProvider, baseConfig.authorizationUrl);
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
        provider: 'generic',
        redirectUri: baseConfig.redirectUri,
        scopes: baseConfig.scopes,
        mockTokenResponse: {
          access_token: 'access-token',
          token_type: 'Bearer',
          expires_in: 3600
        },
        mockUserResponses: [
          {
            sub: 'user123',
            email: 'test@example.com',
            name: 'Test User',
            picture: 'https://example.com/avatar.png'
          }
        ],
        expectedUser: {
          sub: 'user123',
          email: 'test@example.com',
          name: 'Test User',
          provider: 'generic'
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
        provider: 'generic'
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
        provider: 'generic',
        tokenResponse: {
          access_token: 'new-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: 'refresh-token'
        },
        userInfoResponse: {
          sub: 'user456',
          email: 'user@example.com',
          name: 'User Name'
        },
        setupCodeVerifier: async (provider, authCode, codeVerifier) => {
          const pkceStore = (provider as any).pkceStore;
          await pkceStore.storeCodeVerifier(`generic:${authCode}`, {
            codeVerifier,
            state: 'test-state'
          }, 600);
        }
      }
    ));
  });

  describe('handleLogout', () => {
    it('successfully logs out user', async () => {
      const provider = createProvider();
      const accessToken = 'token-to-remove';

      const res = createMockResponse();
      const req = {
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      } as unknown as Request;

      // ADR 006: Tokens are not stored server-side, logout succeeds regardless
      await provider.handleLogout(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true });

      provider.dispose();
    });
  });

  describe('verifyAccessToken', () => {
    it('verifies valid token by fetching user info', testVerifyAccessTokenValid(
      createProvider,
      {
        accessToken: 'valid-token',
        mockUserResponse: {
          sub: 'user789',
          email: 'verified@example.com',
          name: 'Verified User'
        },
        expectedScopes: baseConfig.scopes,
        expectedUserInfo: {
          email: 'verified@example.com',
          name: 'Verified User'
        }
      }
    ));

    it('fetches user info from API', testVerifyAccessTokenFetchesUserInfo(
      createProvider,
      {
        accessToken: 'access-token',
        mockUserResponse: {
          sub: 'user999',
          email: 'fetched@example.com',
          name: 'Fetched User'
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

  describe('getUserInfo', () => {
    it('fetches user info from API', testGetUserInfoSuccess(
      createProvider,
      {
        accessToken: 'info-token',
        mockUserResponse: {
          sub: 'user101',
          email: 'cached@example.com',
          name: 'Cached User'
        },
        expectedUserInfo: {
          sub: 'user101',
          email: 'cached@example.com',
          name: 'Cached User',
          provider: 'generic'
        }
      }
    ));

    it('fetches user info with additional fields', testGetUserInfoFromAPI(
      createProvider,
      {
        accessToken: 'api-fetch-token',
        mockUserResponse: {
          sub: 'user202',
          email: 'api@example.com',
          name: 'API User',
          picture: 'https://example.com/pic.jpg'
        },
        expectedUserInfo: {
          sub: 'user202',
          email: 'api@example.com',
          name: 'API User',
          provider: 'generic'
        }
      }
    ));
  });

  describe('provider metadata', testProviderMetadata(
    createProvider,
    {
      type: 'generic',
      name: 'Test OAuth Provider',
      authEndpoint: '/auth/oauth',
      callbackEndpoint: '/auth/oauth/callback',
      refreshEndpoint: '/auth/oauth/refresh',
      logoutEndpoint: '/auth/oauth/logout',
      defaultScopes: ['openid', 'email', 'profile']
    }
  ));
});
