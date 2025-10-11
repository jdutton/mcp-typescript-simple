import { vi } from 'vitest';

import type { Request, Response } from 'express';
import type {
  MicrosoftOAuthConfig,
  OAuthSession,
  StoredTokenInfo,
  OAuthUserInfo
} from '../../../../src/auth/providers/types.js';
import { logger } from '../../../../src/utils/logger.js';
import { MemoryPKCEStore } from '../../../../src/auth/stores/memory-pkce-store.js';

let originalFetch: typeof globalThis.fetch;
const fetchMock = vi.fn() as jest.MockedFunction<typeof fetch>;

const baseConfig: MicrosoftOAuthConfig = {
  type: 'microsoft',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://example.com/callback',
  scopes: ['openid', 'profile', 'email'],
  tenantId: 'common'
};

type MockResponse = Response & {
  statusCode?: number;
  jsonPayload?: unknown;
  redirectUrl?: string;
  headers?: Record<string, string>;
};

const createMockResponse = (): MockResponse => {
  const data: Partial<Response> & {
    statusCode?: number;
    jsonPayload?: unknown;
    redirectUrl?: string;
    headers?: Record<string, string>;
  } = {
    headers: {}
  };

  data.status = jest.fn((code: number) => {
    data.statusCode = code;
    return data as Response;
  });
  data.json = jest.fn((payload: unknown) => {
    data.jsonPayload = payload;
    return data as Response;
  });
  data.redirect = jest.fn((statusOrUrl: number | string, maybeUrl?: string) => {
    if (typeof statusOrUrl === 'number') {
      data.statusCode = statusOrUrl;
      data.redirectUrl = maybeUrl ?? '';
    } else {
      data.redirectUrl = statusOrUrl;
    }
    return data as Response;
  });
  data.set = jest.fn((name: string, value?: string | string[]) => {
    if (data.headers && typeof value === 'string') {
      data.headers[name] = value;
    }
    return data as Response;
  });
  data.setHeader = jest.fn((name: string, value: string | string[]) => {
    if (data.headers && typeof value === 'string') {
      data.headers[name] = value;
    }
    return data as Response;
  });

  return data as MockResponse;
};

const jsonReply = <T>(body: T, init?: { status?: number; statusText?: string }) => {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(payload, {
    status: init?.status ?? 200,
    statusText: init?.statusText,
    headers: { 'Content-Type': 'application/json' }
  });
};

let MicrosoftOAuthProvider: typeof import('../../../../src/auth/providers/microsoft-provider.js').MicrosoftOAuthProvider;

beforeAll(async () => {
  ({ MicrosoftOAuthProvider } = await import('../../../../src/auth/providers/microsoft-provider.js'));
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
    return new MicrosoftOAuthProvider(baseConfig, undefined, undefined, new MemoryPKCEStore());
  };

  describe('handleAuthorizationRequest', () => {
    it('redirects to authorization URL with correct parameters', async () => {
      const provider = createProvider();
      const res = createMockResponse();

      const loggerInfoSpy = vi.spyOn(logger, 'oauthInfo').mockImplementation(() => {});

      await provider.handleAuthorizationRequest({} as Request, res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const redirectUrl = res.redirectUrl;

      expect(redirectUrl).toContain('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      expect(redirectUrl).toContain('client_id=client-id');
      expect(redirectUrl).toContain('redirect_uri=');
      expect(redirectUrl).toContain('response_type=code');
      expect(redirectUrl).toContain('scope=');
      expect(redirectUrl).toContain('state=');
      expect(redirectUrl).toContain('code_challenge=');
      expect(redirectUrl).toContain('code_challenge_method=S256');

      loggerInfoSpy.mockRestore();
      provider.dispose();
    });

    it('sets anti-caching headers', async () => {
      const provider = createProvider();
      const res = createMockResponse();

      const loggerInfoSpy = vi.spyOn(logger, 'oauthInfo').mockImplementation(() => {});

      await provider.handleAuthorizationRequest({} as Request, res);

      // Anti-caching headers should be set
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('no-store'));

      loggerInfoSpy.mockRestore();
      provider.dispose();
    });
  });

  describe('handleAuthorizationCallback', () => {
    it('exchanges code for tokens and fetches user info', async () => {
      const provider = createProvider();
      const now = Date.now();

      // Store a session first
      (provider as unknown as { storeSession: (state: string, session: OAuthSession) => void }).storeSession('state123', {
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

      (provider as unknown as { storeSession: (state: string, session: OAuthSession) => void }).storeSession('state123', {
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
      const now = Date.now();

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
      const now = Date.now();
      const stored: StoredTokenInfo = {
        accessToken: 'old-access',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        expiresAt: now + 1_000,
        userInfo: {
          sub: 'user-id',
          email: 'user@example.com',
          name: 'User Example',
          provider: 'microsoft'
        },
        provider: 'microsoft',
        scopes: baseConfig.scopes
      };

      (provider as unknown as { storeToken: (token: string, info: StoredTokenInfo) => void }).storeToken('old-access', stored);

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

      const newToken = await (provider as unknown as { getToken: (token: string) => Promise<StoredTokenInfo | null> }).getToken('new-access');
      expect(newToken?.refreshToken).toBe('new-refresh');

      const oldToken = await (provider as unknown as { getToken: (token: string) => Promise<StoredTokenInfo | null> }).getToken('old-access');
      expect(oldToken).toBeNull();

      provider.dispose();
    });

    it('rejects refresh requests with unknown refresh tokens', async () => {
      const provider = createProvider();
      const res = createMockResponse();

      await provider.handleTokenRefresh({
        body: { refresh_token: 'unknown' },
        headers: { host: 'localhost:3000' },
        secure: false
      } as unknown as Request, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid refresh token' });

      provider.dispose();
    });
  });

  describe('handleLogout', () => {
    it('removes token on logout', async () => {
      const provider = createProvider();
      const accessToken = 'token-to-remove';

      // Store a token first
      const userInfo: OAuthUserInfo = {
        sub: 'user123',
        email: 'test@example.com',
        name: 'Test User',
        provider: 'microsoft'
      };

      (provider as unknown as { storeToken: (token: string, info: any) => Promise<void> })
        .storeToken(accessToken, {
          accessToken,
          expiresAt: Date.now() + 3600_000,
          userInfo,
          provider: 'microsoft',
          scopes: baseConfig.scopes
        });

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

      const stored: StoredTokenInfo = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        expiresAt: Date.now() + 3_600_000,
        userInfo: {
          sub: 'user-id',
          email: 'user@example.com',
          name: 'User Example',
          provider: 'microsoft'
        },
        provider: 'microsoft',
        scopes: baseConfig.scopes
      };
      (provider as unknown as { storeToken: (token: string, info: StoredTokenInfo) => void }).storeToken('access-token', stored);

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
      expect(await (provider as unknown as { getToken: (token: string) => Promise<StoredTokenInfo | null> }).getToken('access-token')).toBeNull();

      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      provider.dispose();
    });
  });

  describe('verifyAccessToken', () => {
    it('verifies valid token from cache', async () => {
      const provider = createProvider();
      const accessToken = 'valid-token';
      const userInfo: OAuthUserInfo = {
        sub: 'user789',
        email: 'verified@example.com',
        name: 'Verified User',
        provider: 'microsoft'
      };

      // Store token
      (provider as unknown as { storeToken: (token: string, info: any) => Promise<void> })
        .storeToken(accessToken, {
          accessToken,
          expiresAt: Date.now() + 3600_000,
          userInfo,
          provider: 'microsoft',
          scopes: baseConfig.scopes
        });

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

      // Store token with user info
      (provider as unknown as { storeToken: (token: string, info: any) => Promise<void> })
        .storeToken(accessToken, {
          accessToken,
          expiresAt: Date.now() + 3600_000,
          userInfo,
          provider: 'microsoft',
          scopes: baseConfig.scopes
        });

      const result = await provider.getUserInfo(accessToken);

      expect(result).toEqual(userInfo);

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
});
