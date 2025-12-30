import { vi } from 'vitest';

import type {
  GitHubOAuthConfig
} from '@mcp-typescript-simple/auth';
import { MemoryPKCEStore } from '@mcp-typescript-simple/persistence';

import {
  setupFetchMocking,
  testAuthorizationRequestParams,
  testAntiCachingHeaders,
  testAuthorizationCallbackSuccess,
  testOAuthCallbackErrors,
  testTokenExchangeSuccess,
  testSilentCodeVerifierMissing,
  testLogoutFlow,
  testVerifyAccessTokenValid,
  testVerifyAccessTokenFetchesUserInfo,
  testVerifyAccessTokenInvalid,
  testGetUserInfoSuccess,
  testGetUserInfoFromAPI,
  testGetUserInfoError,
  testTokenRefreshVerification,
  testTokenRefreshInvalidToken
} from './test-helpers.js';

const fetchMock = vi.fn() as MockFunction<typeof fetch>;
const { setupFetchBeforeAll, restoreFetchAfterAll, resetMocksBeforeEach } = setupFetchMocking(fetchMock);

const baseConfig: GitHubOAuthConfig = {
  type: 'github',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://example.com/callback',
  scopes: ['read:user', 'user:email']
};

let GitHubOAuthProvider: typeof import('@mcp-typescript-simple/auth').GitHubOAuthProvider;

beforeAll(async () => {
  ({ GitHubOAuthProvider } = await import('@mcp-typescript-simple/auth'));
});

describe('GitHubOAuthProvider', () => {
  beforeAll(setupFetchBeforeAll);
  afterAll(restoreFetchAfterAll);
  beforeEach(resetMocksBeforeEach);

  const createProvider = () => {
    return new GitHubOAuthProvider(baseConfig, undefined, new MemoryPKCEStore());
  };

  describe('handleAuthorizationRequest', () => {
    // eslint-disable-next-line sonarjs/assertions-in-tests
    it('redirects to authorization URL with correct parameters', async () => {
      await testAuthorizationRequestParams(createProvider, 'https://github.com/login/oauth/authorize');
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
        provider: 'github',
        redirectUri: baseConfig.redirectUri,
        scopes: baseConfig.scopes,
        mockTokenResponse: {
          access_token: 'access-token',
          token_type: 'Bearer',
          scope: 'read:user,user:email',
          expires_in: 28800
        },
        mockUserResponses: [
          // GitHub user response (no email in profile)
          {
            id: 42,
            login: 'octocat',
            name: 'The Octocat',
            email: null,
            avatar_url: 'https://avatars.githubusercontent.com/u/42'
          },
          // GitHub emails response
          [{ email: 'octocat@example.com', primary: true, verified: true }]
        ],
        expectedUser: {
          sub: '42',
          email: 'octocat@example.com',
          name: 'The Octocat',
          provider: 'github'
        },
        expectedTokenResponse: {
          access_token: 'access-token',
          token_type: 'Bearer',
          expires_in: 28800
        }
      }
    ));

    describe('OAuth callback error handling', testOAuthCallbackErrors(
      createProvider,
      {
        redirectUri: baseConfig.redirectUri,
        scopes: baseConfig.scopes,
        provider: 'github'
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
        provider: 'github',
        tokenResponse: {
          access_token: 'new-access-token',
          token_type: 'Bearer',
          scope: 'read:user,user:email',
          expires_in: 28800
        },
        userInfoResponse: {
          id: 456,
          login: 'developer',
          name: 'Developer User',
          email: 'dev@example.com',
          avatar_url: 'https://avatars.githubusercontent.com/u/456'
        },
        setupCodeVerifier: async (provider, authCode, codeVerifier) => {
          const pkceStore = (provider as any).pkceStore;
          await pkceStore.storeCodeVerifier(`github:${authCode}`, {
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

  describe('handleLogout', testLogoutFlow(createProvider));

  describe('handleTokenRefresh', () => {
    it('verifies token validity and returns the token', testTokenRefreshVerification(
      createProvider,
      {
        accessToken: 'access-token',
        mockUserResponse: {
          id: 42,
          login: 'octocat',
          name: 'The Octocat',
          email: 'octo@example.com',
          avatar_url: 'https://avatars.githubusercontent.com/u/42'
        }
      }
    ));

    it('rejects refresh requests for invalid tokens', testTokenRefreshInvalidToken(
      createProvider,
      {
        accessToken: 'invalid-token',
        errorStatus: 401
      }
    ));
  });

  describe('verifyAccessToken', () => {
    it('verifies valid token by fetching user info', testVerifyAccessTokenValid(
      createProvider,
      {
        accessToken: 'valid-token',
        mockUserResponse: {
          id: 789,
          login: 'verified',
          name: 'Verified User',
          email: 'verified@example.com',
          avatar_url: 'https://avatars.githubusercontent.com/u/789'
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
          id: 999,
          login: 'fetched',
          name: 'Fetched User',
          email: 'fetched@example.com',
          avatar_url: 'https://avatars.githubusercontent.com/u/999'
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

  // GitHub-specific: Tests caching of user info with GitHub's id/login structure
  describe('getUserInfo', () => {
    it('returns cached user info', testGetUserInfoSuccess(
      createProvider,
      {
        accessToken: 'cached-info-token',
        mockUserResponse: {
          id: 101,
          login: 'cacheduser',
          name: 'Cached User',
          email: 'cached@example.com',
          avatar_url: 'https://avatars.githubusercontent.com/u/101'
        },
        expectedUserInfo: {
          sub: '101',
          email: 'cached@example.com',
          name: 'Cached User',
          provider: 'github'
        }
      }
    ));

    it('fetches user info from API if not cached', testGetUserInfoFromAPI(
      createProvider,
      {
        accessToken: 'api-fetch-token',
        mockUserResponse: {
          id: 202,
          login: 'apiuser',
          name: 'API User',
          email: 'api@example.com',
          avatar_url: 'https://avatars.githubusercontent.com/u/202'
        },
        expectedUserInfo: {
          sub: '202',
          email: 'api@example.com',
          name: 'API User',
          provider: 'github'
        }
      }
    ));

    it('throws when GitHub user info cannot be retrieved', testGetUserInfoError(
      createProvider,
      {
        accessToken: 'missing-token',
        errorStatus: 500,
        errorStatusText: 'Internal Server Error',
        expectedErrorMessage: 'Failed to get user information'
      }
    ));
  });

  describe('provider metadata', () => {
    it('returns correct provider type', () => {
      const provider = createProvider();
      expect(provider.getProviderType()).toBe('github');
      provider.dispose();
    });

    it('returns correct provider name', () => {
      const provider = createProvider();
      expect(provider.getProviderName()).toBe('GitHub');
      provider.dispose();
    });

    it('returns correct endpoints', () => {
      const provider = createProvider();
      const endpoints = provider.getEndpoints();

      expect(endpoints).toEqual({
        authEndpoint: '/auth/github',
        callbackEndpoint: '/auth/github/callback',
        refreshEndpoint: '/auth/github/refresh',
        logoutEndpoint: '/auth/github/logout'
      });

      provider.dispose();
    });

    it('returns correct default scopes', () => {
      const provider = createProvider();
      expect(provider.getDefaultScopes()).toEqual(['read:user', 'user:email']);
      provider.dispose();
    });
  });
});
