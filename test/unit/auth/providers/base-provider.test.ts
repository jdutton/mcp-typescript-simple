import { jest } from '@jest/globals';
import type { Request, Response } from 'express';
import {
  BaseOAuthProvider
} from '../../../../src/auth/providers/base-provider.js';
import type {
  OAuthConfig,
  OAuthEndpoints,
  OAuthProviderType,
  OAuthSession,
  OAuthUserInfo,
  ProviderTokenResponse,
  StoredTokenInfo
} from '../../../../src/auth/providers/types.js';
import { OAuthTokenError } from '../../../../src/auth/providers/types.js';

type MockResponse = Response & {
  statusCode?: number;
  jsonPayload?: unknown;
};

const createResponse = (): MockResponse => {
  const res: Partial<Response> & {
    statusCode?: number;
    jsonPayload?: unknown;
  } = {};
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = jest.fn((payload: unknown) => {
    res.jsonPayload = payload;
    return res as Response;
  });
  res.redirect = jest.fn(() => res as Response);
  return res as MockResponse;
};

type SessionAccess = {
  storeSession(state: string, session: OAuthSession): void;
  getSession(state: string): OAuthSession | undefined;
  removeSession(state: string): void;
  storeToken(token: string, info: StoredTokenInfo): void;
  getToken(token: string): StoredTokenInfo | undefined;
  removeToken(token: string): void;
  cleanup(): void;
};

class TestOAuthProvider extends BaseOAuthProvider {
  constructor(config: OAuthConfig) {
    super(config);
  }

  getProviderType(): OAuthProviderType {
    return 'google';
  }

  getProviderName(): string {
    return 'Test';
  }

  getEndpoints(): OAuthEndpoints {
    return {
      authEndpoint: '/auth',
      callbackEndpoint: '/callback',
      refreshEndpoint: '/refresh',
      logoutEndpoint: '/logout'
    };
  }

  getDefaultScopes(): string[] {
    return ['scope'];
  }

  async handleAuthorizationRequest(_req: Request, _res: Response): Promise<void> {}

  async handleAuthorizationCallback(_req: Request, _res: Response): Promise<void> {}

  async handleTokenRefresh(_req: Request, _res: Response): Promise<void> {}

  async handleLogout(_req: Request, _res: Response): Promise<void> {}

  async verifyAccessToken(token: string) {
    return {
      token,
      clientId: this.config.clientId,
      scopes: ['scope'],
      expiresAt: Math.floor((Date.now() + 1000) / 1000),
      extra: {
        userInfo: await this.getUserInfo(token),
        provider: 'google'
      }
    };
  }

  async getUserInfo(_accessToken: string): Promise<OAuthUserInfo> {
    return {
      sub: '123',
      provider: 'google',
      email: 'user@example.com',
      name: 'User'
    };
  }
}

const baseConfig: OAuthConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://example.com/callback',
  scopes: ['scope'],
  type: 'google'
};

describe('BaseOAuthProvider', () => {
  let provider: TestOAuthProvider;
  let sessionAccess: SessionAccess;
  let originalFetch: typeof globalThis.fetch;
  const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    fetchMock.mockReset();
    provider = new TestOAuthProvider(baseConfig);
    sessionAccess = provider as unknown as SessionAccess;
  });

  afterEach(() => {
    provider.dispose();
    jest.useRealTimers();
  });

  const jsonReply = <T>(body: T, init?: { status?: number; statusText?: string }) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(payload, {
      status: init?.status ?? 200,
      statusText: init?.statusText,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  it('cleans up expired sessions and tokens', () => {
    const now = Date.now();
    const expiredSession: OAuthSession = {
      state: 'expired',
      codeVerifier: 'verifier',
      codeChallenge: 'challenge',
      redirectUri: baseConfig.redirectUri,
      scopes: ['scope'],
      provider: 'google',
      expiresAt: now - 10
    };

    sessionAccess.storeSession('expired', expiredSession);
    sessionAccess.storeSession('valid', { ...expiredSession, state: 'valid', expiresAt: now + 5000 });

    sessionAccess.storeToken('expired-token', {
      accessToken: 'expired-token',
      expiresAt: now - 10,
      provider: 'google',
      scopes: ['scope'],
      userInfo: {
        sub: '123',
        provider: 'google',
        email: 'user@example.com',
        name: 'User'
      }
    });

    sessionAccess.storeToken('valid-token', {
      accessToken: 'valid-token',
      expiresAt: now + 60_000,
      provider: 'google',
      scopes: ['scope'],
      userInfo: {
        sub: '123',
        provider: 'google',
        email: 'user@example.com',
        name: 'User'
      }
    });

    sessionAccess.cleanup();

    const tokenStore = provider as unknown as { tokens: Map<string, StoredTokenInfo> };

    expect(sessionAccess.getSession('expired')).toBeUndefined();
    expect(sessionAccess.getSession('valid')).toBeDefined();
    expect(sessionAccess.getToken('expired-token')).toBeUndefined();
    expect(tokenStore.tokens.has('valid-token')).toBe(true);
  });

  it('removes tokens that are expiring within buffer during validation', async () => {
    const now = Date.now();
    sessionAccess.storeToken('token', {
      accessToken: 'token',
      expiresAt: now + 500,
      provider: 'google',
      scopes: ['scope'],
      userInfo: {
        sub: '123',
        provider: 'google',
        email: 'user@example.com',
        name: 'User'
      }
    });

    const result = await provider.isTokenValid('token');
    expect(result).toBe(false);
    expect(sessionAccess.getToken('token')).toBeUndefined();
  });

  it('exchanges authorization code for tokens and returns JSON response', async () => {
    fetchMock.mockResolvedValueOnce(jsonReply<ProviderTokenResponse>({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_type: 'Bearer',
      scope: 'scope'
    }));

    const response = await provider['exchangeCodeForTokens']('https://token.url', 'code', 'verifier', { audience: 'value' });

    expect(fetchMock).toHaveBeenCalledWith('https://token.url', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
    }));
    expect(response).toEqual(expect.objectContaining({ access_token: 'access-token' }));
  });

  it('throws OAuthTokenError when token exchange fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad request', {
      status: 400,
      statusText: 'Bad Request'
    }));

    await expect(
      provider['exchangeCodeForTokens']('https://token.url', 'code', 'verifier')
    ).rejects.toThrow(OAuthTokenError);
  });

  it('refreshes tokens via refreshAccessToken helper', async () => {
    fetchMock.mockResolvedValueOnce(jsonReply<ProviderTokenResponse>({
      access_token: 'new-access',
      token_type: 'Bearer'
    }));

    const response = await provider['refreshAccessToken']('https://token.url', 'refresh-token');

    expect(fetchMock).toHaveBeenCalledWith('https://token.url', expect.objectContaining({
      method: 'POST'
    }));
    expect(response.access_token).toBe('new-access');
  });

  it('throws when refreshAccessToken receives an error response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad refresh', {
      status: 500,
      statusText: 'Server Error'
    }));

    await expect(
      provider['refreshAccessToken']('https://token.url', 'refresh-token')
    ).rejects.toThrow(OAuthTokenError);
  });

  it('clears cleanup timers on dispose', () => {
    const clearSpy = jest.spyOn(global, 'clearInterval');
    provider.dispose();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
