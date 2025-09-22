import { jest } from '@jest/globals';
import type { Request, Response } from 'express';
import type {
  GitHubOAuthConfig,
  OAuthSession,
  StoredTokenInfo,
  OAuthUserInfo
} from '../../../../src/auth/providers/types.js';

let originalFetch: typeof globalThis.fetch;
const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;

const baseConfig: GitHubOAuthConfig = {
  type: 'github',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://example.com/callback',
  scopes: ['user:email']
};

type MockResponse = Response & {
  statusCode?: number;
  jsonPayload?: unknown;
  redirectUrl?: string;
};

const createMockResponse = (): MockResponse => {
  const data: Partial<Response> & {
    statusCode?: number;
    jsonPayload?: unknown;
    redirectUrl?: string;
  } = {};

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

let GitHubOAuthProvider: typeof import('../../../../src/auth/providers/github-provider.js').GitHubOAuthProvider;

beforeAll(async () => {
  ({ GitHubOAuthProvider } = await import('../../../../src/auth/providers/github-provider.js'));
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
    jest.clearAllMocks();
  });

  const createProvider = () => new GitHubOAuthProvider(baseConfig);

  it('redirects to GitHub authorization URL and stores session data', async () => {
    const provider = createProvider();

    const pkceSpy = jest.spyOn(provider as unknown as { generatePKCE: () => { codeVerifier: string; codeChallenge: string } }, 'generatePKCE')
      .mockReturnValue({ codeVerifier: 'verifier', codeChallenge: 'challenge' });
    const stateSpy = jest.spyOn(provider as unknown as { generateState: () => string }, 'generateState')
      .mockReturnValue('state123');

    const res = createMockResponse();
    await provider.handleAuthorizationRequest({} as Request, res);

    expect(res.redirect).toHaveBeenCalledTimes(1);
    const redirectUrl = res.redirectUrl ?? '';
    expect(redirectUrl).toContain('https://github.com/login/oauth/authorize');
    expect(redirectUrl).toContain('client_id=client-id');
    expect(redirectUrl).toContain('code_challenge=challenge');
    expect(redirectUrl).toContain('state=state123');

    const session = (provider as unknown as { getSession: (state: string) => OAuthSession | undefined }).getSession('state123');
    expect(session).toBeDefined();
    expect(session?.provider).toBe('github');

    pkceSpy.mockRestore();
    stateSpy.mockRestore();
    provider.dispose();
  });

  it('exchanges code for tokens and fetches user info during callback', async () => {
    const provider = createProvider();
    const now = Date.now();
    (provider as unknown as { storeSession: (state: string, session: OAuthSession) => void }).storeSession('state123', {
      state: 'state123',
      codeVerifier: 'verifier',
      codeChallenge: 'challenge',
      redirectUri: baseConfig.redirectUri,
      scopes: baseConfig.scopes,
      provider: 'github',
      expiresAt: now + 5_000
    });

    fetchMock
      .mockResolvedValueOnce(jsonReply({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        scope: 'user:email',
        expires_in: 3600
      }))
      .mockResolvedValueOnce(jsonReply({
        id: 42,
        email: null,
        login: 'octocat',
        name: 'The Octocat',
        avatar_url: 'avatar.png'
      }))
      .mockResolvedValueOnce(jsonReply([
        { email: 'octo@example.com', primary: true }
      ]));

    const res = createMockResponse();

    await provider.handleAuthorizationCallback({
      query: { code: 'code123', state: 'state123' }
    } as unknown as Request, res);

    expect(fetchMock).toHaveBeenNthCalledWith(1,
      'https://github.com/login/oauth/access_token',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      'https://api.github.com/user',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer access-token' }) })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(3,
      'https://api.github.com/user/emails',
      expect.any(Object)
    );

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      access_token: 'access-token',
      user: expect.objectContaining({ email: 'octo@example.com', provider: 'github' })
    }));

    const sessionAfter = (provider as unknown as { getSession: (state: string) => OAuthSession | undefined }).getSession('state123');
    expect(sessionAfter).toBeUndefined();

    const storedToken = (provider as unknown as { getToken: (token: string) => StoredTokenInfo | undefined }).getToken('access-token');
    expect(storedToken?.userInfo.email).toBe('octo@example.com');

    provider.dispose();
  });

  it('returns 500 when token exchange does not provide access token', async () => {
    const provider = createProvider();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (provider as unknown as { storeSession: (state: string, session: OAuthSession) => void }).storeSession('state123', {
      state: 'state123',
      codeVerifier: 'verifier',
      codeChallenge: 'challenge',
      redirectUri: baseConfig.redirectUri,
      scopes: baseConfig.scopes,
      provider: 'github',
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

  it('returns cached token information when refreshing an existing token', async () => {
    const provider = createProvider();
    const future = Date.now() + 3_600_000;
    const stored: StoredTokenInfo = {
      accessToken: 'access-token',
      refreshToken: undefined,
      expiresAt: future,
      userInfo: {
        sub: '42',
        email: 'octo@example.com',
        name: 'The Octocat',
        provider: 'github',
        providerData: {}
      },
      provider: 'github',
      scopes: baseConfig.scopes
    };

    (provider as unknown as { storeToken: (token: string, info: StoredTokenInfo) => void }).storeToken('access-token', stored);

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

  it('rejects refresh requests for unknown tokens', async () => {
    const provider = createProvider();
    const res = createMockResponse();

    await provider.handleTokenRefresh({
      body: { access_token: 'missing-token' }
    } as unknown as Request, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Token is no longer valid' });

    provider.dispose();
  });

  it('verifies access tokens via GitHub API when not cached', async () => {
    const provider = createProvider();

    fetchMock.mockResolvedValueOnce(jsonReply({
      id: 7,
      email: 'code@example.com',
      login: 'coder',
      name: 'Code Master',
      avatar_url: 'avatar.png'
    }));

    const authInfo = await provider.verifyAccessToken('remote-token');

    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/user', expect.any(Object));
    expect(authInfo.extra?.userInfo).toMatchObject({ email: 'code@example.com' });

    provider.dispose();
  });

  it('throws when GitHub user info cannot be retrieved', async () => {
    const provider = createProvider();

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    fetchMock.mockResolvedValueOnce(new Response('error', {
      status: 500,
      statusText: 'Internal Server Error'
    }));

    await expect(provider.getUserInfo('missing-token')).rejects.toThrow('Failed to get user information');

    consoleSpy.mockRestore();
    provider.dispose();
  });
});
