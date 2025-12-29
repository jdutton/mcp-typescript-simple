/**
 * Shared test helpers for OAuth provider tests
 *
 * This file contains common mock utilities and helper functions used across
 * provider test files to reduce code duplication.
 */

import { expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { BaseOAuthProvider, OAuthSession } from '@mcp-typescript-simple/auth';
import { logger } from '@mcp-typescript-simple/observability';

/**
 * Setup common fetch mocking for provider tests
 *
 * This helper consolidates the beforeAll/afterAll/beforeEach pattern
 * used across provider test files.
 *
 * @param fetchMock - The mocked fetch function from vitest
 * @returns Lifecycle functions and originalFetch reference
 */
export function setupFetchMocking(fetchMock: ReturnType<typeof vi.fn>) {
  let originalFetch: typeof globalThis.fetch;

  return {
    setupFetchBeforeAll: () => {
      originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as unknown as typeof fetch;
    },
    restoreFetchAfterAll: () => {
      globalThis.fetch = originalFetch;
    },
    resetMocksBeforeEach: () => {
      fetchMock.mockReset();
      vi.clearAllMocks();
    }
  };
}

/**
 * Mock Response type with additional tracking properties
 */
export type MockResponse = Response & {
  statusCode?: number;
  jsonPayload?: unknown;
  redirectUrl?: string;
  headers?: Record<string, string>;
};

/**
 * Creates a mock Express Response object for testing
 *
 * Tracks calls to status(), json(), redirect(), and setHeader() methods
 * for assertion in tests.
 *
 * @returns Mock Response object with spy functions
 */
export const createMockResponse = (): MockResponse => {
  const data: Partial<Response> & {
    statusCode?: number;
    jsonPayload?: unknown;
    redirectUrl?: string;
    headers?: Record<string, string>;
  } = {
    headers: {}
  };

  data.status = vi.fn((code: number) => {
    data.statusCode = code;
    return data as Response;
  });

  data.json = vi.fn((payload: unknown) => {
    data.jsonPayload = payload;
    return data as Response;
  });

  data.redirect = vi.fn((statusOrUrl: number | string, maybeUrl?: string) => {
    if (typeof statusOrUrl === 'number') {
      data.statusCode = statusOrUrl;
      data.redirectUrl = maybeUrl ?? '';
    } else {
      data.redirectUrl = statusOrUrl;
    }
    return data as Response;
  });

  data.set = vi.fn((name: string, value?: string | string[]) => {
    if (data.headers && typeof value === 'string') {
      data.headers[name] = value;
    }
    return data as Response;
  });

  data.setHeader = vi.fn((name: string, value: string | string[]) => {
    if (data.headers && typeof value === 'string') {
      data.headers[name] = value;
    }
    return data as Response;
  });

  return data as MockResponse;
};

/**
 * Creates a mock fetch Response with JSON body
 *
 * Utility for mocking OAuth provider API responses in tests.
 *
 * @param body - JSON response body
 * @param init - Optional response initialization (status, statusText)
 * @returns Mock Response object
 */
export const jsonReply = <T>(body: T, init?: { status?: number; statusText?: string }) => {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(payload, {
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    headers: {
      'Content-Type': 'application/json'
    }
  });
};

/**
 * Helper to run a test with provider setup/teardown
 */
const withProviderTest = async <T>(
  createProviderFn: () => BaseOAuthProvider,
  testFn: (_provider: BaseOAuthProvider, _res: MockResponse) => Promise<T>
): Promise<T> => {
  const provider = createProviderFn();
  const res = createMockResponse();
  const loggerInfoSpy = vi.spyOn(logger, 'oauthInfo').mockImplementation(() => {});

  try {
    return await testFn(provider, res);
  } finally {
    loggerInfoSpy.mockRestore();
    provider.dispose();
  }
};

/**
 * Common test for authorization request parameters
 *
 * @param createProviderFn - Function to create a fresh provider instance
 * @param expectedAuthUrl - Expected authorization URL (provider-specific)
 */
export const testAuthorizationRequestParams = async (
  createProviderFn: () => BaseOAuthProvider,
  expectedAuthUrl: string
) => {
  return withProviderTest(createProviderFn, async (provider, res) => {
    await provider.handleAuthorizationRequest({} as Request, res);

    const redirectUrl = res.redirectUrl ?? '';
    expect(redirectUrl).toContain(expectedAuthUrl);
    expect(redirectUrl).toContain('client_id=client-id');
    expect(redirectUrl).toContain('redirect_uri=');
    expect(redirectUrl).toContain('response_type=code');
    expect(redirectUrl).toContain('scope=');
    expect(redirectUrl).toContain('state=');
    expect(redirectUrl).toContain('code_challenge=');
    expect(redirectUrl).toContain('code_challenge_method=S256');
  });
};

/**
 * Common test for anti-caching headers
 *
 * @param createProviderFn - Function to create a fresh provider instance
 */
export const testAntiCachingHeaders = async (
  createProviderFn: () => BaseOAuthProvider
) => {
  return withProviderTest(createProviderFn, async (provider, res) => {
    await provider.handleAuthorizationRequest({} as Request, res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('no-store'));
  });
};

/**
 * Common test for authorization callback success flow
 *
 * Eliminates duplication across provider tests for the successful token exchange flow.
 *
 * @param createProviderFn - Function to create provider instance
 * @param config - Test configuration
 */
export const testAuthorizationCallbackSuccess = (
  createProviderFn: () => BaseOAuthProvider,
  config: {
    provider: string;
    redirectUri: string;
    scopes: string[];
    mockTokenResponse: Record<string, unknown>;
    mockUserResponses: Record<string, unknown>[];
    expectedUser: {
      sub: string;
      email: string;
      name: string;
      provider: string;
    };
    expectedTokenResponse: Record<string, unknown>;
  }
) => {
  return async () => {
    const provider = createProviderFn();

    // Store a session first
    createAndStoreSession(provider, 'state123', {
      redirectUri: config.redirectUri,
      scopes: config.scopes,
      provider: config.provider
    });

    // Mock token exchange response
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(jsonReply(config.mockTokenResponse));

    // Mock any additional user info responses (e.g., GitHub emails endpoint)
    for (const userResponse of config.mockUserResponses) {
      fetchMock.mockResolvedValueOnce(jsonReply(userResponse));
    }

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
      ...config.expectedTokenResponse,
      user: config.expectedUser
    });

    provider.dispose();
  };
};

/**
 * Common OAuth callback error handling tests
 *
 * These tests verify standard OAuth error handling behavior that should be
 * consistent across all OAuth providers (GitHub, Google, Microsoft, Generic).
 *
 * @param createProviderFn - Function to create a fresh provider instance
 * @param providerConfig - Provider configuration (for storing sessions)
 */
export const testOAuthCallbackErrors = (
  createProviderFn: () => BaseOAuthProvider,
  providerConfig: { redirectUri: string; scopes: string[]; provider: string }
) => {
  return () => {
    it('returns error if code is missing', async () => {
      const provider = createProviderFn();
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
      const provider = createProviderFn();
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
      const provider = createProviderFn();

      const loggerErrorSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

      createAndStoreSession(provider, 'state123', {
        redirectUri: providerConfig.redirectUri,
        scopes: providerConfig.scopes,
        provider: providerConfig.provider
      });

      // Mock empty token response
      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock.mockResolvedValueOnce(jsonReply({}));

      const res = createMockResponse();
      const req = {
        query: {
          code: 'auth-code',
          state: 'state123'
        }
      } as unknown as Request;

      await provider.handleAuthorizationCallback(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authorization failed',
        details: 'No access token received'
      });

      loggerErrorSpy.mockRestore();
      provider.dispose();
    });
  };
};

/**
 * Helper to create and store an OAuth session on a provider
 *
 * Reduces duplication when setting up sessions for callback tests.
 *
 * @param provider - The OAuth provider instance
 * @param state - State parameter
 * @param options - Optional session configuration
 */
export const createAndStoreSession = (
  provider: BaseOAuthProvider,
  state: string,
  options?: {
    codeVerifier?: string;
    codeChallenge?: string;
    redirectUri?: string;
    clientRedirectUri?: string;
    scopes?: string[];
    provider?: string;
    expiresAt?: number;
  }
) => {
  const now = Date.now();
  const session: OAuthSession = {
    state,
    codeVerifier: options?.codeVerifier ?? 'verifier',
    codeChallenge: options?.codeChallenge ?? 'challenge',
    redirectUri: options?.redirectUri ?? 'https://example.com/callback',
    scopes: options?.scopes ?? ['openid', 'email'],
    provider: options?.provider ?? 'google',
    expiresAt: options?.expiresAt ?? now + 5_000,
    ...(options?.clientRedirectUri && { clientRedirectUri: options.clientRedirectUri })
  };

  (provider as unknown as { storeSession: (_state: string, _session: OAuthSession) => void })
    .storeSession(state, session);
};

/**
 * Google-specific: Setup mock google-auth-library OAuth2Client
 *
 * Consolidates the mock setup pattern for Google provider tests.
 *
 * @param mockGenerateAuthUrl - Mock function for generateAuthUrl
 * @param mockGetToken - Mock function for getToken
 * @param mockVerifyIdToken - Mock function for verifyIdToken
 * @param mockRefreshAccessToken - Mock function for refreshAccessToken
 * @param mockSetCredentials - Mock function for setCredentials
 * @param mockGetTokenInfo - Mock function for getTokenInfo
 * @returns Object containing all mock functions for easy access
 */
export interface GoogleAuthMocks {
  mockGenerateAuthUrl: ReturnType<typeof vi.fn>;
  mockGetToken: ReturnType<typeof vi.fn>;
  mockVerifyIdToken: ReturnType<typeof vi.fn>;
  mockRefreshAccessToken: ReturnType<typeof vi.fn>;
  mockSetCredentials: ReturnType<typeof vi.fn>;
  mockGetTokenInfo: ReturnType<typeof vi.fn>;
}

export const setupGoogleAuthMocks = (): GoogleAuthMocks => {
  const mockGenerateAuthUrl = vi.fn<(_options: Record<string, unknown>) => string>();
  const mockGetToken = vi.fn<(_options: Record<string, unknown>) => Promise<{ tokens: Record<string, unknown> }>>();
  const mockVerifyIdToken = vi.fn<(_options: Record<string, unknown>) => Promise<{ getPayload: () => Record<string, unknown> }>>();
  const mockRefreshAccessToken = vi.fn<() => Promise<{ credentials: Record<string, unknown> }>>();
  const mockSetCredentials = vi.fn<(_options: Record<string, unknown>) => void>();
  const mockGetTokenInfo = vi.fn<(_token: string) => Promise<Record<string, unknown>>>();

  return {
    mockGenerateAuthUrl,
    mockGetToken,
    mockVerifyIdToken,
    mockRefreshAccessToken,
    mockSetCredentials,
    mockGetTokenInfo
  };
};

/**
 * Google-specific: Setup ID token verification mock with user payload
 *
 * Reduces duplication when mocking successful ID token verification.
 *
 * @param mockVerifyIdToken - The mock verifyIdToken function
 * @param userPayload - User information to return in the payload
 */
export const mockIdTokenVerification = (
  mockVerifyIdToken: ReturnType<typeof vi.fn>,
  userPayload: {
    sub: string;
    email: string;
    name?: string;
    picture?: string;
  }
) => {
  mockVerifyIdToken.mockResolvedValueOnce({
    getPayload: () => ({
      sub: userPayload.sub,
      email: userPayload.email,
      ...(userPayload.name && { name: userPayload.name }),
      ...(userPayload.picture && { picture: userPayload.picture })
    })
  });
};

/**
 * Create a test auth cache object for session-based authentication tests
 *
 * @param options - Configuration for the auth cache
 * @returns Auth cache object for testing
 */
export const createTestAuthCache = (options: {
  provider: 'google' | 'github' | 'microsoft';
  userId?: string;
  token?: string;
  clientId?: string;
  scopes?: string[];
  tokenHash?: string;
  tokenBindingTime?: number;
  lastValidated?: number;
  validationTTL?: number;
  expiresAt?: number;
  idToken?: string;
  userInfo?: Record<string, unknown>;
}) => {
  const now = Date.now();
  return {
    provider: options.provider,
    userId: options.userId ?? 'user-123',
    tokenHash: options.tokenHash ?? 'test-hash',
    tokenBindingTime: options.tokenBindingTime ?? now,
    lastValidated: options.lastValidated ?? now,
    validationTTL: options.validationTTL ?? 300000,
    scopes: options.scopes ?? ['openid', 'email'],
    authInfo: {
      token: options.token ?? 'test-token',
      clientId: options.clientId ?? 'client-id',
      scopes: options.scopes ?? ['openid', 'email'],
      expiresAt: options.expiresAt ?? Math.floor(now / 1000) + 3600,
      ...(options.idToken || options.userInfo ? {
        extra: {
          ...(options.idToken && { idToken: options.idToken }),
          ...(options.userInfo && { userInfo: options.userInfo })
        }
      } : {})
    }
  };
};

/**
 * Test cached authentication validation
 * Reduces duplication in JWT validation tests
 *
 * @param createProviderFn - Function to create provider instance
 * @param authCacheOptions - Options for creating test auth cache
 * @param expectedResult - Expected boolean result from canUseCachedAuthentication
 */
export const testCachedAuthentication = async (
  createProviderFn: () => any,
  authCacheOptions: Parameters<typeof createTestAuthCache>[0],
  expectedResult: boolean
) => {
  const provider = createProviderFn();
  const authCache = createTestAuthCache(authCacheOptions);
  const result = await provider.canUseCachedAuthentication(authCache);
  expect(result).toBe(expectedResult);
  provider.dispose();
};

/**
 * Provider-agnostic test for successful token exchange flow
 *
 * This helper eliminates duplication across OAuth provider tests by providing
 * a generic test harness for the token exchange success scenario.
 *
 * @param createProviderFn - Function to create provider instance
 * @param config - Configuration for the test
 */
export const testTokenExchangeSuccess = (
  createProviderFn: () => BaseOAuthProvider,
  config: {
    authCode: string;
    codeVerifier: string;
    redirectUri: string;
    provider: string;
    tokenResponse: Record<string, unknown>;
    userInfoResponse: Record<string, unknown>;
    setupCodeVerifier?: (_provider: BaseOAuthProvider, _authCode: string, _codeVerifier: string) => Promise<void>;
  }
) => {
  return async () => {
    const provider = createProviderFn();

    // Setup PKCE code verifier (provider-specific)
    if (config.setupCodeVerifier) {
      await config.setupCodeVerifier(provider, config.authCode, config.codeVerifier);
    }

    // Mock token exchange response
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(jsonReply(config.tokenResponse));

    // Mock user info response
    fetchMock.mockResolvedValueOnce(jsonReply(config.userInfoResponse));

    const res = createMockResponse();
    const req = {
      body: {
        grant_type: 'authorization_code',
        code: config.authCode,
        code_verifier: config.codeVerifier,
        redirect_uri: config.redirectUri
      }
    } as unknown as Request;

    await provider.handleTokenExchange(req, res);

    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.jsonPayload).toMatchObject(config.tokenResponse);

    provider.dispose();
  };
};

/**
 * Provider-agnostic test for silent return when code_verifier is missing
 *
 * This tests the "not my code" pattern where a provider silently returns
 * without handling the request if code_verifier is missing.
 *
 * @param createProviderFn - Function to create provider instance
 * @param redirectUri - Redirect URI for the test
 */
export const testSilentCodeVerifierMissing = (
  createProviderFn: () => BaseOAuthProvider,
  redirectUri: string
) => {
  return async () => {
    const provider = createProviderFn();

    const res = createMockResponse();
    const req = {
      body: {
        grant_type: 'authorization_code',
        code: 'some-code',
        redirect_uri: redirectUri
      }
    } as unknown as Request;

    await provider.handleTokenExchange(req, res);

    // Should return without sending any response (let loop try next provider)
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();

    provider.dispose();
  };
};

/**
 * Provider-agnostic test for token refresh flow
 *
 * @param createProviderFn - Function to create provider instance
 * @param config - Configuration for the test
 */
export const testTokenRefreshFlow = (
  createProviderFn: () => BaseOAuthProvider,
  config: {
    refreshToken: string;
    tokenResponse: Record<string, unknown>;
    expectedTokenEndpoint: string;
  }
) => {
  return async () => {
    const provider = createProviderFn();

    // Mock token refresh response
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(jsonReply(config.tokenResponse));

    const res = createMockResponse();

    await provider.handleTokenRefresh({
      body: { refresh_token: config.refreshToken }
    } as unknown as Request, res);

    expect(fetchMock).toHaveBeenCalledWith(
      config.expectedTokenEndpoint,
      expect.objectContaining({ method: 'POST' })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining(config.tokenResponse));

    provider.dispose();
  };
};

/**
 * Provider-agnostic test for token refresh with invalid token
 *
 * @param createProviderFn - Function to create provider instance
 */
export const testTokenRefreshWithInvalidToken = (
  createProviderFn: () => BaseOAuthProvider
) => {
  return async () => {
    const provider = createProviderFn();
    const res = createMockResponse();

    // Mock API returning error for invalid refresh token
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(new Response('Invalid grant', { status: 400 }));

    await provider.handleTokenRefresh({
      body: { refresh_token: 'unknown' }
    } as unknown as Request, res);

    expect(res.status).toHaveBeenCalledWith(400);

    provider.dispose();
  };
};

/**
 * Provider-agnostic test for logout flow
 *
 * @param createProviderFn - Function to create provider instance
 */
export const testLogoutFlow = (
  createProviderFn: () => BaseOAuthProvider
) => {
  return () => {
    it('removes token on logout', async () => {
      const provider = createProviderFn();
      const accessToken = 'token-to-remove';

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
      const provider = createProviderFn();
      const res = createMockResponse();
      const req = {
        headers: {}
      } as unknown as Request;

      await provider.handleLogout(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true });

      provider.dispose();
    });
  };
};

/**
 * Provider-agnostic test for verifyAccessToken - valid token scenario
 *
 * Tests successful token verification by fetching user info from the provider's API.
 * All providers verify tokens via API call (no server-side caching per ADR 006).
 *
 * @param createProviderFn - Function to create provider instance
 * @param config - Test configuration
 */
export const testVerifyAccessTokenValid = (
  createProviderFn: () => BaseOAuthProvider,
  config: {
    accessToken: string;
    mockUserResponse: Record<string, unknown>;
    expectedScopes?: string[];
    expectedUserInfo: { email: string; name: string };
  }
) => {
  return async () => {
    const provider = createProviderFn();

    // Mock provider's user API response
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(jsonReply(config.mockUserResponse));

    const authInfo = await provider.verifyAccessToken(config.accessToken);

    const expected: any = {
      extra: {
        userInfo: config.expectedUserInfo
      }
    };

    // Only check scopes if explicitly provided
    if (config.expectedScopes !== undefined) {
      expected.scopes = config.expectedScopes;
    }

    expect(authInfo).toMatchObject(expected);

    provider.dispose();
  };
};

/**
 * Provider-agnostic test for verifyAccessToken - fetching user info
 *
 * Tests successful user info retrieval when verifying token.
 * This is an alias for testVerifyAccessTokenValid that accepts simplified config.
 *
 * @param createProviderFn - Function to create provider instance
 * @param config - Test configuration
 */
export const testVerifyAccessTokenFetchesUserInfo = (
  createProviderFn: () => BaseOAuthProvider,
  config: {
    accessToken: string;
    mockUserResponse: Record<string, unknown>;
    expectedUserInfo: { email: string; name: string };
  }
) => {
  // Delegate to the full version without checking scopes
  return testVerifyAccessTokenValid(createProviderFn, config);
};

/**
 * Provider-agnostic test for verifyAccessToken - invalid token scenario
 *
 * Tests error handling when provider API rejects an invalid token.
 *
 * @param createProviderFn - Function to create provider instance
 * @param accessToken - Invalid token to test with
 */
export const testVerifyAccessTokenInvalid = (
  createProviderFn: () => BaseOAuthProvider,
  accessToken: string
) => {
  return async () => {
    const provider = createProviderFn();

    // Mock failed provider API response
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

    const loggerErrorSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

    await expect(provider.verifyAccessToken(accessToken)).rejects.toThrow();

    loggerErrorSpy.mockRestore();
    provider.dispose();
  };
};

/**
 * Provider-agnostic test for getUserInfo - cached/fetched user info
 *
 * Tests successful user info retrieval. Despite the test name suggesting "cached",
 * ADR 006 mandates all providers fetch from API (no server-side caching).
 *
 * @param createProviderFn - Function to create provider instance
 * @param config - Test configuration
 */
export const testGetUserInfoSuccess = (
  createProviderFn: () => BaseOAuthProvider,
  config: {
    accessToken: string;
    mockUserResponse: Record<string, unknown>;
    expectedUserInfo: {
      sub: string;
      email: string;
      name: string;
      provider: string;
    };
  }
) => {
  return async () => {
    const provider = createProviderFn();

    // Mock provider's user API response
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(jsonReply(config.mockUserResponse));

    const result = await provider.getUserInfo(config.accessToken);

    expect(result).toMatchObject(config.expectedUserInfo);

    provider.dispose();
  };
};

/**
 * Provider-agnostic test for getUserInfo - API fetch scenario
 *
 * Tests user info fetching from API. This is an alias for testGetUserInfoSuccess
 * (ADR 006 mandates all providers fetch from API - no server-side caching).
 *
 * @param createProviderFn - Function to create provider instance
 * @param config - Test configuration
 */
export const testGetUserInfoFromAPI = testGetUserInfoSuccess;

/**
 * Provider-agnostic test for getUserInfo - error scenario
 *
 * Tests error handling when provider API fails to return user information.
 *
 * @param createProviderFn - Function to create provider instance
 * @param config - Test configuration
 */
export const testGetUserInfoError = (
  createProviderFn: () => BaseOAuthProvider,
  config: {
    accessToken: string;
    errorStatus: number;
    errorStatusText: string;
    expectedErrorMessage: string;
  }
) => {
  return async () => {
    const provider = createProviderFn();

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const loggerErrorSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

    // Mock failed provider API response
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(new Response('error', {
      status: config.errorStatus,
      statusText: config.errorStatusText
    }));

    await expect(provider.getUserInfo(config.accessToken)).rejects.toThrow(config.expectedErrorMessage);

    consoleSpy.mockRestore();
    loggerErrorSpy.mockRestore();
    provider.dispose();
  };
};

/**
 * Provider-agnostic test for handleTokenRefresh - verifies and returns token
 *
 * Tests token refresh for providers that verify tokens via user info API
 * (e.g., GitHub which doesn't have a native refresh token mechanism).
 *
 * @param createProviderFn - Function to create provider instance
 * @param config - Test configuration
 */
export const testTokenRefreshVerification = (
  createProviderFn: () => BaseOAuthProvider,
  config: {
    accessToken: string;
    mockUserResponse: Record<string, unknown>;
  }
) => {
  return async () => {
    const provider = createProviderFn();

    // Mock provider's user API response for token verification
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(jsonReply(config.mockUserResponse));

    const res = createMockResponse();
    await provider.handleTokenRefresh({
      body: { access_token: config.accessToken }
    } as unknown as Request, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      access_token: config.accessToken,
      token_type: 'Bearer'
    }));

    provider.dispose();
  };
};

/**
 * Provider-agnostic test for handleTokenRefresh - rejects invalid token
 *
 * Tests token refresh rejection when token verification fails.
 *
 * @param createProviderFn - Function to create provider instance
 * @param config - Test configuration
 */
export const testTokenRefreshInvalidToken = (
  createProviderFn: () => BaseOAuthProvider,
  config: {
    accessToken: string;
    errorStatus: number;
  }
) => {
  return async () => {
    const provider = createProviderFn();
    const res = createMockResponse();

    // Mock failed provider API response for invalid token
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: config.errorStatus }));

    await provider.handleTokenRefresh({
      body: { access_token: config.accessToken },
      headers: { host: 'localhost:3000' },
      secure: false
    } as unknown as Request, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token is no longer valid' });

    provider.dispose();
  };
};
