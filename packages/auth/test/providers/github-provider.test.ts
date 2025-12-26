import { vi } from 'vitest';

import type { Request } from 'express';
import type {
  GitHubOAuthConfig,
  OAuthSession,
  OAuthUserInfo
} from '@mcp-typescript-simple/auth';
import { logger } from '@mcp-typescript-simple/observability';
import { MemoryPKCEStore } from '@mcp-typescript-simple/persistence';

import { createMockResponse, jsonReply } from './test-helpers.js';

/* eslint-disable sonarjs/no-unused-vars */
let originalFetch: typeof globalThis.fetch;
const fetchMock = vi.fn() as MockFunction<typeof fetch>;

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
    return new GitHubOAuthProvider(baseConfig, undefined, new MemoryPKCEStore());
  };

  describe('handleAuthorizationRequest', () => {
    it('redirects to authorization URL with correct parameters', async () => {
      const provider = createProvider();
      const res = createMockResponse();

      const loggerInfoSpy = vi.spyOn(logger, 'oauthInfo').mockImplementation(() => {});

      await provider.handleAuthorizationRequest({} as Request, res);

      expect(res.redirect).toHaveBeenCalledTimes(1);
      const redirectUrl = res.redirectUrl;

      expect(redirectUrl).toContain('https://github.com/login/oauth/authorize');
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
      (provider as unknown as { storeSession: (_state: string, _session: OAuthSession) => void }).storeSession('state123', {
        state: 'state123',
        codeVerifier: 'verifier',
        codeChallenge: 'challenge',
        redirectUri: baseConfig.redirectUri,
        scopes: baseConfig.scopes,
        provider: 'github',
        expiresAt: now + 5_000
      });

      // Mock token exchange response
      fetchMock.mockResolvedValueOnce(jsonReply({
        access_token: 'access-token',
        token_type: 'Bearer',
        scope: 'read:user,user:email',
        expires_in: 28800
      }));

      // Mock GitHub user response (no email in profile)
      fetchMock.mockResolvedValueOnce(jsonReply({
        id: 42,
        login: 'octocat',
        name: 'The Octocat',
        email: null,
        avatar_url: 'https://avatars.githubusercontent.com/u/42'
      }));

      // Mock GitHub emails response
      fetchMock.mockResolvedValueOnce(jsonReply([
        { email: 'octocat@example.com', primary: true, verified: true }
      ]));

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
        expires_in: 28800,
        user: {
          sub: '42',
          email: 'octocat@example.com',
          name: 'The Octocat',
          provider: 'github'
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
        provider: 'github',
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
      await pkceStore.storeCodeVerifier(`github:${authCode}`, {
        codeVerifier,
        state: 'test-state'
      }, 600);

      // Mock token exchange response
      fetchMock.mockResolvedValueOnce(jsonReply({
        access_token: 'new-access-token',
        token_type: 'Bearer',
        scope: 'read:user,user:email',
        expires_in: 28800
      }));

      // Mock GitHub user response
      fetchMock.mockResolvedValueOnce(jsonReply({
        id: 456,
        login: 'developer',
        name: 'Developer User',
        email: 'dev@example.com',
        avatar_url: 'https://avatars.githubusercontent.com/u/456'
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
        expires_in: 28800
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

  describe('handleLogout', () => {
    it('removes token on logout', async () => {
      const provider = createProvider();
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
      const provider = createProvider();
      const res = createMockResponse();
      const req = {
        headers: {}
      } as unknown as Request;

      await provider.handleLogout(req, res);

      expect(res.json).toHaveBeenCalledWith({ success: true });

      provider.dispose();
    });
  });

  describe('handleTokenRefresh', () => {
    it('verifies token validity and returns the token', async () => {
      const provider = createProvider();

      // ADR 006: Tokens are not cached, verified via GitHub API
      // Mock GitHub user response for token verification
      fetchMock.mockResolvedValueOnce(jsonReply({
        id: 42,
        login: 'octocat',
        name: 'The Octocat',
        email: 'octo@example.com',
        avatar_url: 'https://avatars.githubusercontent.com/u/42'
      }));

      const res = createMockResponse();
      await provider.handleTokenRefresh({
        body: { access_token: 'access-token' }
      } as unknown as Request, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        access_token: 'access-token',
        token_type: 'Bearer'
      }));

      provider.dispose();
    });

    it('rejects refresh requests for invalid tokens', async () => {
      const provider = createProvider();
      const res = createMockResponse();

      // Mock failed GitHub API response for invalid token
      fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      await provider.handleTokenRefresh({
        body: { access_token: 'invalid-token' },
        headers: { host: 'localhost:3000' },
        secure: false
      } as unknown as Request, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Token is no longer valid' });

      provider.dispose();
    });
  });

  describe('verifyAccessToken', () => {
    it('verifies valid token by fetching user info', async () => {
      const provider = createProvider();
      const accessToken = 'valid-token';

      // ADR 006: Tokens are not cached, always verified via GitHub API
      // Mock GitHub user response
      fetchMock.mockResolvedValueOnce(jsonReply({
        id: 789,
        login: 'verified',
        name: 'Verified User',
        email: 'verified@example.com',
        avatar_url: 'https://avatars.githubusercontent.com/u/789'
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

    it('fetches user info from API', async () => {
      const provider = createProvider();
      const accessToken = 'access-token';

      // Mock GitHub user response
      fetchMock.mockResolvedValueOnce(jsonReply({
        id: 999,
        login: 'fetched',
        name: 'Fetched User',
        email: 'fetched@example.com',
        avatar_url: 'https://avatars.githubusercontent.com/u/999'
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

      // Mock failed GitHub response
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
        sub: '101',
        email: 'cached@example.com',
        name: 'Cached User',
        provider: 'github'
      };

      // ADR 006: Always fetch from GitHub API (no server-side caching)
      fetchMock.mockResolvedValueOnce(jsonReply({
        id: 101,
        login: 'cacheduser',
        name: 'Cached User',
        email: 'cached@example.com',
        avatar_url: 'https://avatars.githubusercontent.com/u/101'
      }));

      const result = await provider.getUserInfo(accessToken);

      expect(result).toMatchObject(userInfo);

      provider.dispose();
    });

    it('fetches user info from API if not cached', async () => {
      const provider = createProvider();
      const accessToken = 'api-fetch-token';

      // Mock GitHub user response
      fetchMock.mockResolvedValueOnce(jsonReply({
        id: 202,
        login: 'apiuser',
        name: 'API User',
        email: 'api@example.com',
        avatar_url: 'https://avatars.githubusercontent.com/u/202'
      }));

      const result = await provider.getUserInfo(accessToken);

      expect(result).toMatchObject({
        sub: '202',
        email: 'api@example.com',
        name: 'API User',
        provider: 'github'
      });

      provider.dispose();
    });

    it('throws when GitHub user info cannot be retrieved', async () => {
      const provider = createProvider();

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const loggerErrorSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

      fetchMock.mockResolvedValueOnce(new Response('error', {
        status: 500,
        statusText: 'Internal Server Error'
      }));

      await expect(provider.getUserInfo('missing-token')).rejects.toThrow('Failed to get user information');

      consoleSpy.mockRestore();
      loggerErrorSpy.mockRestore();
      provider.dispose();
    });
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
