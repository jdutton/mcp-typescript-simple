import { vi } from 'vitest';

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
import { OAuthSessionStore } from '../../../../src/auth/stores/session-store-interface.js';
import { OAuthTokenStore } from '../../../../src/auth/stores/oauth-token-store-interface.js';
import { PKCEStore } from '@mcp-typescript-simple/persistence';
import { MemoryPKCEStore } from '@mcp-typescript-simple/persistence';

type MockResponse = Response & {
  statusCode?: number;
  jsonPayload?: unknown;
};

const createResponse = (): MockResponse => {
  const res: Partial<Response> & {
    statusCode?: number;
    jsonPayload?: unknown;
  } = {};
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = vi.fn((payload: unknown) => {
    res.jsonPayload = payload;
    return res as Response;
  });
  res.redirect = vi.fn(() => res as Response);
  res.setHeader = vi.fn(() => res as Response);
  return res as MockResponse;
};

type SessionAccess = {
  storeSession(state: string, session: OAuthSession): Promise<void>;
  getSession(state: string): Promise<OAuthSession | null>;
  removeSession(state: string): Promise<void>;
  storeToken(token: string, info: StoredTokenInfo): Promise<void>;
  getToken(token: string): Promise<StoredTokenInfo | null>;
  removeToken(token: string): Promise<void>;
  cleanup(): Promise<void>;
  getTokenCount(): Promise<number>;
};

class TestOAuthProvider extends BaseOAuthProvider {
  constructor(config: OAuthConfig, sessionStore?: OAuthSessionStore, tokenStore?: OAuthTokenStore, pkceStore?: PKCEStore) {
    super(config, sessionStore, tokenStore, pkceStore);
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

  protected getTokenUrl(): string {
    return 'https://example.com/token';
  }

  protected async fetchUserInfo(_accessToken: string): Promise<OAuthUserInfo> {
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
  const fetchMock = vi.fn() as MockFunction<typeof fetch>;

  beforeAll(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    fetchMock.mockReset();
    provider = new TestOAuthProvider(baseConfig, undefined, undefined, new MemoryPKCEStore());
    sessionAccess = provider as unknown as SessionAccess;
  });

  afterEach(() => {
    provider.dispose();
    vi.useRealTimers();
  });

  const jsonReply = <T>(body: T, init?: { status?: number; statusText?: string }) => {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(payload, {
      status: init?.status ?? 200,
      statusText: init?.statusText,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  it('cleans up expired sessions and tokens', async () => {
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

    await sessionAccess.cleanup();

    const tokenStore = provider as unknown as { tokens: Map<string, StoredTokenInfo> };

    expect(await sessionAccess.getSession('expired')).toBeNull();
    expect(await sessionAccess.getSession('valid')).toBeDefined();
    expect(await sessionAccess.getToken('expired-token')).toBeNull();
    expect(await sessionAccess.getToken('valid-token')).toBeDefined();
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
    expect(await sessionAccess.getToken('token')).toBeNull();
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
    const clearSpy = vi.spyOn(global, 'clearInterval');
    provider.dispose();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  describe('OAuth Client State Preservation (Claude Code / MCP Inspector compatibility)', () => {
    it('stores and retrieves client state in OAuth session', () => {
      const serverState = 'server-state-123';
      const clientState = 'client-state-456';
      const codeVerifier = 'verifier';
      const codeChallenge = 'challenge';
      const clientRedirectUri = 'http://localhost:3000/callback';

      const session = provider['createOAuthSession'](
        serverState,
        codeVerifier,
        codeChallenge,
        clientRedirectUri,
        undefined,
        clientState
      );

      expect(session.state).toBe(serverState);
      expect(session.clientState).toBe(clientState);
      expect(session.clientRedirectUri).toBe(clientRedirectUri);
    });

    it('handles client redirect with client original state', async () => {
      const res = createResponse();
      const serverState = 'server-state-abc';
      const clientState = 'client-state-xyz';
      const authCode = 'auth-code-123';

      const session: OAuthSession = {
        state: serverState,
        codeVerifier: 'verifier',
        codeChallenge: 'challenge',
        redirectUri: 'http://localhost:3000/auth/callback',
        clientRedirectUri: 'http://localhost:50151/callback',
        clientState: clientState,
        scopes: ['openid', 'profile', 'email'],
        provider: 'google',
        expiresAt: Date.now() + 600000
      };

      sessionAccess.storeSession(serverState, session);

      const handled = await provider['handleClientRedirect'](session, authCode, serverState, res as Response);

      expect(handled).toBe(true);
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining(`code=${authCode}`)
      );
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining(`state=${clientState}`)
      );
      expect(res.redirect).not.toHaveBeenCalledWith(
        expect.stringContaining(`state=${serverState}`)
      );
    });

    it('falls back to server state when client state not provided', async () => {
      const res = createResponse();
      const serverState = 'server-state-only';
      const authCode = 'auth-code-456';

      const session: OAuthSession = {
        state: serverState,
        codeVerifier: 'verifier',
        codeChallenge: 'challenge',
        redirectUri: 'http://localhost:3000/auth/callback',
        clientRedirectUri: 'http://localhost:6274/callback',
        // No clientState provided
        scopes: ['openid', 'profile'],
        provider: 'google',
        expiresAt: Date.now() + 600000
      };

      sessionAccess.storeSession(serverState, session);

      const handled = await provider['handleClientRedirect'](session, authCode, serverState, res as Response);

      expect(handled).toBe(true);
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining(`state=${serverState}`)
      );
    });

    it('does not handle redirect when clientRedirectUri not provided', async () => {
      const res = createResponse();
      const serverState = 'server-state-123';
      const authCode = 'auth-code-789';

      const session: OAuthSession = {
        state: serverState,
        codeVerifier: 'verifier',
        codeChallenge: 'challenge',
        redirectUri: 'http://localhost:3000/auth/callback',
        // No clientRedirectUri
        scopes: ['openid'],
        provider: 'google',
        expiresAt: Date.now() + 600000
      };

      const handled = await provider['handleClientRedirect'](session, authCode, serverState, res as Response);

      expect(handled).toBe(false);
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it('creates session without client state for direct server usage', () => {
      const serverState = 'server-only-state';
      const codeVerifier = 'verifier';
      const codeChallenge = 'challenge';

      const session = provider['createOAuthSession'](
        serverState,
        codeVerifier,
        codeChallenge
      );

      expect(session.state).toBe(serverState);
      expect(session.clientState).toBeUndefined();
      expect(session.clientRedirectUri).toBeUndefined();
    });
  });
});
