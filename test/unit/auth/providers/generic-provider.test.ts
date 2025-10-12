import { vi } from 'vitest';

import type { Request, Response } from 'express';
import type {
  GenericOAuthConfig,
  OAuthSession,
  OAuthUserInfo
} from '../../../../src/auth/providers/types.js';
import { logger } from '../../../../src/utils/logger.js';
import { MemoryPKCEStore } from '../../../../src/auth/stores/memory-pkce-store.js';

let originalFetch: typeof globalThis.fetch;
const fetchMock = vi.fn() as MockFunction<typeof fetch>;

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

const jsonReply = <T>(body: T, init?: { status?: number; statusText?: string }) => {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(payload, {
    status: init?.status ?? 200,
    statusText: init?.statusText,
    headers: { 'Content-Type': 'application/json' }
  });
};

let GenericOAuthProvider: typeof import('../../../../src/auth/providers/generic-provider.js').GenericOAuthProvider;

beforeAll(async () => {
  ({ GenericOAuthProvider } = await import('../../../../src/auth/providers/generic-provider.js'));
});

describe('GenericOAuthProvider', () => {
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
    return new GenericOAuthProvider(baseConfig, undefined, undefined, new MemoryPKCEStore());
  };

  describe('handleAuthorizationRequest', () => {
    it('redirects to authorization URL with correct parameters', async () => {
      const provider = createProvider();
      const res = createMockResponse();

      const loggerInfoSpy = vi.spyOn(logger, 'oauthInfo').mockImplementation(() => {});
      const loggerErrorSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

      await provider.handleAuthorizationRequest({} as Request, res);

      // Check if error path was taken
      if (res.statusCode === 500) {
        console.error('handleAuthorizationRequest failed:', res.jsonPayload);
      }

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const redirectUrl = res.redirectUrl;

      expect(redirectUrl).toContain(baseConfig.authorizationUrl);
      expect(redirectUrl).toContain('client_id=client-id');
      expect(redirectUrl).toContain('redirect_uri=');
      expect(redirectUrl).toContain('response_type=code');
      expect(redirectUrl).toContain('scope=');
      expect(redirectUrl).toContain('state=');
      expect(redirectUrl).toContain('code_challenge=');
      expect(redirectUrl).toContain('code_challenge_method=S256');

      loggerInfoSpy.mockRestore();
      loggerErrorSpy.mockRestore();
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
        provider: 'generic',
        expiresAt: now + 5_000
      });

      // Mock token exchange response
      fetchMock.mockResolvedValueOnce(jsonReply({
        access_token: 'access-token',
        token_type: 'Bearer',
        expires_in: 3600
      }));

      // Mock userinfo response
      fetchMock.mockResolvedValueOnce(jsonReply({
        sub: 'user123',
        email: 'test@example.com',
        name: 'Test User',
        picture: 'https://example.com/avatar.png'
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
          provider: 'generic'
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
  });

  describe('handleTokenExchange', () => {
    it('exchanges authorization code for access token', async () => {
      const provider = createProvider();
      const now = Date.now();

      const authCode = 'auth-code-123';
      const codeVerifier = 'verifier-123';

      // Store PKCE mapping using pkceStore
      const pkceStore = (provider as any).pkceStore;
      await pkceStore.storeCodeVerifier(`generic:${authCode}`, {
        codeVerifier,
        state: 'test-state'
      }, 600);

      // Mock token exchange response
      fetchMock.mockResolvedValueOnce(jsonReply({
        access_token: 'new-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'refresh-token'
      }));

      // Mock userinfo response
      fetchMock.mockResolvedValueOnce(jsonReply({
        sub: 'user456',
        email: 'user@example.com',
        name: 'User Name'
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
        provider: 'generic'
      };

      (provider as unknown as { storeToken: (token: string, info: any) => Promise<void> })
        .storeToken(accessToken, {
          accessToken,
          expiresAt: Date.now() + 3600_000,
          userInfo,
          provider: 'generic',
          scopes: baseConfig.scopes
        });

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
  });

  describe('verifyAccessToken', () => {
    it('verifies valid token from cache', async () => {
      const provider = createProvider();
      const accessToken = 'valid-token';
      const userInfo: OAuthUserInfo = {
        sub: 'user789',
        email: 'verified@example.com',
        name: 'Verified User',
        provider: 'generic'
      };

      // Store token
      (provider as unknown as { storeToken: (token: string, info: any) => Promise<void> })
        .storeToken(accessToken, {
          accessToken,
          expiresAt: Date.now() + 3600_000,
          userInfo,
          provider: 'generic',
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

      // Mock userinfo response
      fetchMock.mockResolvedValueOnce(jsonReply({
        sub: 'user999',
        email: 'fetched@example.com',
        name: 'Fetched User'
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

      // Mock failed userinfo response
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
        provider: 'generic'
      };

      // Store token with user info
      (provider as unknown as { storeToken: (token: string, info: any) => Promise<void> })
        .storeToken(accessToken, {
          accessToken,
          expiresAt: Date.now() + 3600_000,
          userInfo,
          provider: 'generic',
          scopes: baseConfig.scopes
        });

      const result = await provider.getUserInfo(accessToken);

      expect(result).toEqual(userInfo);

      provider.dispose();
    });

    it('fetches user info from API if not cached', async () => {
      const provider = createProvider();
      const accessToken = 'api-fetch-token';

      // Mock userinfo response
      fetchMock.mockResolvedValueOnce(jsonReply({
        sub: 'user202',
        email: 'api@example.com',
        name: 'API User',
        picture: 'https://example.com/pic.jpg'
      }));

      const result = await provider.getUserInfo(accessToken);

      expect(result).toMatchObject({
        sub: 'user202',
        email: 'api@example.com',
        name: 'API User',
        provider: 'generic'
      });

      provider.dispose();
    });
  });

  describe('provider metadata', () => {
    it('returns correct provider type', () => {
      const provider = createProvider();
      expect(provider.getProviderType()).toBe('generic');
      provider.dispose();
    });

    it('returns correct provider name', () => {
      const provider = createProvider();
      expect(provider.getProviderName()).toBe('Test OAuth Provider');
      provider.dispose();
    });

    it('returns correct endpoints', () => {
      const provider = createProvider();
      const endpoints = provider.getEndpoints();

      expect(endpoints).toEqual({
        authEndpoint: '/auth/oauth',
        callbackEndpoint: '/auth/oauth/callback',
        refreshEndpoint: '/auth/oauth/refresh',
        logoutEndpoint: '/auth/oauth/logout'
      });

      provider.dispose();
    });

    it('returns correct default scopes', () => {
      const provider = createProvider();
      expect(provider.getDefaultScopes()).toEqual(['openid', 'email', 'profile']);
      provider.dispose();
    });
  });
});
