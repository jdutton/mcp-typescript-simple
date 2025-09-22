import { jest } from '@jest/globals';
import type { Request, Response } from 'express';
import type { GoogleOAuthConfig, OAuthSession, StoredTokenInfo } from '../../../../src/auth/providers/types.js';

const mockGenerateAuthUrl = jest.fn<(options: Record<string, unknown>) => string>();
const mockGetToken = jest.fn<(options: Record<string, unknown>) => Promise<{ tokens: Record<string, unknown> }>>();
const mockVerifyIdToken = jest.fn<(options: Record<string, unknown>) => Promise<{ getPayload: () => Record<string, unknown> }>>();
const mockRefreshAccessToken = jest.fn<() => Promise<{ credentials: Record<string, unknown> }>>();
const mockSetCredentials = jest.fn<(options: Record<string, unknown>) => void>();

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn(() => ({
    generateAuthUrl: mockGenerateAuthUrl,
    getToken: mockGetToken,
    verifyIdToken: mockVerifyIdToken,
    refreshAccessToken: mockRefreshAccessToken,
    setCredentials: mockSetCredentials
  }))
}));

let GoogleOAuthProvider: typeof import('../../../../src/auth/providers/google-provider.js').GoogleOAuthProvider;

beforeAll(async () => {
  ({ GoogleOAuthProvider } = await import('../../../../src/auth/providers/google-provider.js'));
});

const baseConfig: GoogleOAuthConfig = {
  type: 'google',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://example.com/callback',
  scopes: ['openid', 'email']
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

describe('GoogleOAuthProvider', () => {
  const createProvider = () => new GoogleOAuthProvider(baseConfig);

  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth?state=state123');
  });

  it('redirects to Google authorization URL and stores session data', async () => {
    const provider = createProvider();

    const pkceSpy = jest.spyOn(provider as unknown as { generatePKCE: () => { codeVerifier: string; codeChallenge: string } }, 'generatePKCE')
      .mockReturnValue({ codeVerifier: 'verifier', codeChallenge: 'challenge' });
    const stateSpy = jest.spyOn(provider as unknown as { generateState: () => string }, 'generateState')
      .mockReturnValue('state123');

    const res = createMockResponse();
    await provider.handleAuthorizationRequest({} as Request, res);

    expect(mockGenerateAuthUrl).toHaveBeenCalledWith({
      access_type: 'offline',
      scope: ['openid', 'email'],
      state: 'state123',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      prompt: 'consent'
    });
    expect(res.redirect).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth?state=state123');

    const session = (provider as unknown as { getSession: (state: string) => OAuthSession | undefined }).getSession('state123');
    expect(session).toMatchObject({
      state: 'state123',
      codeVerifier: 'verifier',
      provider: 'google'
    });

    pkceSpy.mockRestore();
    stateSpy.mockRestore();
    provider.dispose();
  });

  it('exchanges code for tokens and returns user info during callback', async () => {
    const provider = createProvider();
    const now = 1_000_000;
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

    (provider as unknown as { storeSession: (state: string, session: OAuthSession) => void }).storeSession('state123', {
      state: 'state123',
      codeVerifier: 'verifier',
      codeChallenge: 'challenge',
      redirectUri: baseConfig.redirectUri,
      scopes: ['openid', 'email'],
      provider: 'google',
      expiresAt: now + 5_000
    });

    mockGetToken.mockResolvedValueOnce({
      tokens: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        id_token: 'id-token',
        expiry_date: now + 3_600_000
      }
    });
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        sub: '123',
        email: 'user@example.com',
        name: 'Test User',
        picture: 'avatar.png'
      })
    });

    const res = createMockResponse();

    await provider.handleAuthorizationCallback({
      query: { code: 'code123', state: 'state123' }
    } as unknown as Request, res);

    expect(mockGetToken).toHaveBeenCalledWith({
      code: 'code123',
      codeVerifier: 'verifier'
    });
    expect(mockVerifyIdToken).toHaveBeenCalledWith({
      idToken: 'id-token',
      audience: 'client-id'
    });

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_type: 'Bearer',
      user: expect.objectContaining({ email: 'user@example.com', provider: 'google' })
    }));

    const sessionAfter = (provider as unknown as { getSession: (state: string) => OAuthSession | undefined }).getSession('state123');
    expect(sessionAfter).toBeUndefined();

    const storedToken = (provider as unknown as { getToken: (token: string) => StoredTokenInfo | undefined }).getToken('access-token');
    expect(storedToken).toBeDefined();
    expect(storedToken?.userInfo.email).toBe('user@example.com');

    dateSpy.mockRestore();
    provider.dispose();
  });

  it('returns 500 when Google does not supply an access token', async () => {
    const provider = createProvider();
    const now = 2_000_000;
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    (provider as unknown as { storeSession: (state: string, session: OAuthSession) => void }).storeSession('state123', {
      state: 'state123',
      codeVerifier: 'verifier',
      codeChallenge: 'challenge',
      redirectUri: baseConfig.redirectUri,
      scopes: baseConfig.scopes,
      provider: 'google',
      expiresAt: now + 5_000
    });

    mockGetToken.mockResolvedValueOnce({ tokens: {} });

    const res = createMockResponse();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await provider.handleAuthorizationCallback({
      query: { code: 'code123', state: 'state123' }
    } as unknown as Request, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Authorization failed' }));
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
    dateSpy.mockRestore();
    provider.dispose();
  });

  it('refreshes tokens when provided a valid refresh token', async () => {
    const provider = createProvider();
    const now = 3_000_000;
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

    const existingToken: StoredTokenInfo = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken: 'id-token',
      expiresAt: now + 1_000,
      userInfo: {
        sub: '123',
        email: 'user@example.com',
        name: 'Test User',
        provider: 'google'
      },
      provider: 'google',
      scopes: baseConfig.scopes
    };

    (provider as unknown as { storeToken: (accessToken: string, info: StoredTokenInfo) => void }).storeToken('access-token', existingToken);

    mockRefreshAccessToken.mockResolvedValueOnce({
      credentials: {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expiry_date: now + 7_200_000
      }
    });

    const res = createMockResponse();

    await provider.handleTokenRefresh({
      body: { refresh_token: 'refresh-token' }
    } as unknown as Request, res);

    expect(mockSetCredentials).toHaveBeenCalledWith({ refresh_token: 'refresh-token' });
    expect(mockRefreshAccessToken).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token'
    }));

    const updatedToken = (provider as unknown as { getToken: (token: string) => StoredTokenInfo | undefined }).getToken('new-access-token');
    expect(updatedToken).toBeDefined();
    expect(updatedToken?.refreshToken).toBe('new-refresh-token');

    dateSpy.mockRestore();
    provider.dispose();
  });

  it('returns 401 when refresh token is unknown', async () => {
    const provider = createProvider();
    const res = createMockResponse();

    await provider.handleTokenRefresh({
      body: { refresh_token: 'missing-token' }
    } as unknown as Request, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid refresh token' });

    provider.dispose();
  });
});
