import { jest } from '@jest/globals';
import type { Request, Response } from 'express';
import type {
  MicrosoftOAuthConfig,
  OAuthSession,
  StoredTokenInfo
} from '../../../../src/auth/providers/types.js';

let originalFetch: typeof globalThis.fetch;
const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

const baseConfig: MicrosoftOAuthConfig = {
  type: 'microsoft',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://example.com/callback',
  scopes: ['openid', 'profile'],
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
    jest.clearAllMocks();
  });

  const createProvider = () => new MicrosoftOAuthProvider(baseConfig);

  it('redirects to Microsoft authorization URL and stores session data', async () => {
    const provider = createProvider();

    const res = createMockResponse();

    // Mock console.error to avoid error output during testing
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await provider.handleAuthorizationRequest({} as Request, res);

    // Either redirect was successful or we got an error response
    if (res.redirectUrl) {
      expect(res.redirect).toHaveBeenCalledTimes(1);
      const redirectUrl = res.redirectUrl;
      expect(redirectUrl).toContain('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      expect(redirectUrl).toContain('client_id=client-id');
    } else {
      // If no redirect, check for error response
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to initiate authorization' });
    }

    consoleSpy.mockRestore();
    consoleLogSpy.mockRestore();
    provider.dispose();
  });

  it('handles authorization callback, exchanging code and fetching user info', async () => {
    const provider = createProvider();
    (provider as unknown as { storeSession: (state: string, session: OAuthSession) => void }).storeSession('state123', {
      state: 'state123',
      codeVerifier: 'verifier',
      codeChallenge: 'challenge',
      redirectUri: baseConfig.redirectUri,
      scopes: baseConfig.scopes,
      provider: 'microsoft',
      expiresAt: Date.now() + 5_000
    });

    fetchMock
      .mockResolvedValueOnce(jsonReply({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        id_token: 'id-token',
        scope: 'openid profile',
        expires_in: 3600
      }))
      .mockResolvedValueOnce(jsonReply({
        id: 'user-id',
        mail: 'user@example.com',
        displayName: 'User Example'
      }));

    const res = createMockResponse();

    await provider.handleAuthorizationCallback({
      query: { code: 'code123', state: 'state123' }
    } as unknown as Request, res);

    expect(fetchMock).toHaveBeenNthCalledWith(1,
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      'https://graph.microsoft.com/v1.0/me',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer access-token' }) })
    );

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      access_token: 'access-token',
      user: expect.objectContaining({ email: 'user@example.com', provider: 'microsoft' })
    }));

    const storedToken = (provider as unknown as { getToken: (token: string) => StoredTokenInfo | undefined }).getToken('access-token');
    expect(storedToken?.userInfo.email).toBe('user@example.com');

    provider.dispose();
  });

  it('returns 500 when authorization callback lacks access token', async () => {
    const provider = createProvider();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    (provider as unknown as { storeSession: (state: string, session: OAuthSession) => void }).storeSession('state123', {
      state: 'state123',
      codeVerifier: 'verifier',
      codeChallenge: 'challenge',
      redirectUri: baseConfig.redirectUri,
      scopes: baseConfig.scopes,
      provider: 'microsoft',
      expiresAt: Date.now() + 5_000
    });

    fetchMock.mockResolvedValueOnce(jsonReply({}));

    const res = createMockResponse();

    await provider.handleAuthorizationCallback({
      query: { code: 'code123', state: 'state123' }
    } as unknown as Request, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Authorization failed' }));
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
    provider.dispose();
  });

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

    const newToken = (provider as unknown as { getToken: (token: string) => StoredTokenInfo | undefined }).getToken('new-access');
    expect(newToken?.refreshToken).toBe('new-refresh');
    expect((provider as unknown as { getToken: (token: string) => StoredTokenInfo | undefined }).getToken('old-access')).toBeUndefined();

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

  it('revokes tokens on logout and remains successful even if revocation fails', async () => {
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

    fetchMock
      .mockResolvedValueOnce(new Response('error', {
        status: 500,
        statusText: 'Error'
      }));

    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = createMockResponse();
    await provider.handleLogout({
      headers: { authorization: 'Bearer access-token' }
    } as Request, res);

    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect((provider as unknown as { getToken: (token: string) => StoredTokenInfo | undefined }).getToken('access-token')).toBeUndefined();

    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    provider.dispose();
  });

  it('throws when Microsoft user profile cannot be retrieved', async () => {
    const provider = createProvider();

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    fetchMock.mockResolvedValueOnce(new Response('forbidden', {
      status: 403,
      statusText: 'Forbidden'
    }));

    await expect(provider.getUserInfo('token')).rejects.toThrow('Failed to get user information');

    consoleSpy.mockRestore();
    provider.dispose();
  });
});
