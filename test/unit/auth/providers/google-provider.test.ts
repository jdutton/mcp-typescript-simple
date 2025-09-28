import { jest } from '@jest/globals';
import type { Request, Response } from 'express';
import type { GoogleOAuthConfig, OAuthSession, StoredTokenInfo } from '../../../../src/auth/providers/types.js';

const mockGenerateAuthUrl = jest.fn<(options: Record<string, unknown>) => string>();
const mockGetToken = jest.fn<(options: Record<string, unknown>) => Promise<{ tokens: Record<string, unknown> }>>();
const mockVerifyIdToken = jest.fn<(options: Record<string, unknown>) => Promise<{ getPayload: () => Record<string, unknown> }>>();
const mockRefreshAccessToken = jest.fn<() => Promise<{ credentials: Record<string, unknown> }>>();
const mockSetCredentials = jest.fn<(options: Record<string, unknown>) => void>();
const mockGetTokenInfo = jest.fn<(token: string) => Promise<Record<string, unknown>>>();

// Mock global fetch for Google API calls
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
(global as any).fetch = mockFetch;

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn(() => ({
    generateAuthUrl: mockGenerateAuthUrl,
    getToken: mockGetToken,
    verifyIdToken: mockVerifyIdToken,
    refreshAccessToken: mockRefreshAccessToken,
    setCredentials: mockSetCredentials,
    getTokenInfo: mockGetTokenInfo
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

describe('GoogleOAuthProvider', () => {
  const createProvider = () => new GoogleOAuthProvider(baseConfig);

  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth?state=state123');
    mockFetch.mockClear();
  });

  it('redirects to Google authorization URL and stores session data', async () => {
    const provider = createProvider();

    const pkceSpy = jest.spyOn(provider as unknown as { generatePKCE: () => { codeVerifier: string; codeChallenge: string } }, 'generatePKCE')
      .mockReturnValue({ codeVerifier: 'verifier', codeChallenge: 'challenge' });
    const stateSpy = jest.spyOn(provider as unknown as { generateState: () => string }, 'generateState')
      .mockReturnValue('state123');

    const res = createMockResponse();
    const req = { query: {} } as Request;  // Add query object to prevent undefined errors
    await provider.handleAuthorizationRequest(req, res);

    expect(mockGenerateAuthUrl).toHaveBeenCalledWith({
      access_type: 'offline',
      scope: ['openid', 'email'],
      state: 'state123',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      prompt: 'consent',
      redirect_uri: baseConfig.redirectUri
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
      body: { refresh_token: 'missing-token' },
      headers: { host: 'localhost:3000' },
      secure: false
    } as unknown as Request, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid refresh token' });

    provider.dispose();
  });

  // Authorization Request Flow Tests
  describe('Authorization Request Flow', () => {
    it('handles MCP Inspector client redirect flow with provided parameters', async () => {
      const provider = createProvider();

      // Mock the setupPKCE method to use client challenge and return a server state
      const setupPKCESpy = jest.spyOn(provider as unknown as { setupPKCE: (clientCodeChallenge?: string) => { state: string; codeVerifier: string; codeChallenge: string } }, 'setupPKCE')
        .mockReturnValue({ state: 'generated_state', codeVerifier: '', codeChallenge: 'client_challenge' });

      const res = createMockResponse();
      const req = {
        query: {
          redirect_uri: 'https://client.example.com/callback',
          code_challenge: 'client_challenge',
          code_challenge_method: 'S256',
          state: 'client_state',
          client_id: 'client-123'
        }
      } as unknown as Request;

      await provider.handleAuthorizationRequest(req, res);

      expect(mockGenerateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({
        code_challenge: 'client_challenge',
        code_challenge_method: 'S256',
        state: 'generated_state'
      }));
      expect(res.redirect).toHaveBeenCalled();

      const session = (provider as unknown as { getSession: (state: string) => OAuthSession | undefined }).getSession('generated_state');
      expect(session).toMatchObject({
        state: 'generated_state',
        codeVerifier: '', // Empty because client provided challenge
        codeChallenge: 'client_challenge',
        clientRedirectUri: 'https://client.example.com/callback'
      });

      setupPKCESpy.mockRestore();
      provider.dispose();
    });

    it('generates PKCE when client parameters are missing', async () => {
      const provider = createProvider();

      const pkceSpy = jest.spyOn(provider as unknown as { generatePKCE: () => { codeVerifier: string; codeChallenge: string } }, 'generatePKCE')
        .mockReturnValue({ codeVerifier: 'generated_verifier', codeChallenge: 'generated_challenge' });
      const stateSpy = jest.spyOn(provider as unknown as { generateState: () => string }, 'generateState')
        .mockReturnValue('generated_state');

      const res = createMockResponse();
      const req = { query: {} } as Request;

      await provider.handleAuthorizationRequest(req, res);

      expect(pkceSpy).toHaveBeenCalled();
      expect(stateSpy).toHaveBeenCalled();
      expect(mockGenerateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({
        code_challenge: 'generated_challenge',
        state: 'generated_state'
      }));

      const session = (provider as unknown as { getSession: (state: string) => OAuthSession | undefined }).getSession('generated_state');
      expect(session).toMatchObject({
        codeVerifier: 'generated_verifier',
        codeChallenge: 'generated_challenge'
      });

      pkceSpy.mockRestore();
      stateSpy.mockRestore();
      provider.dispose();
    });

    it('uses default scopes when config scopes are empty', async () => {
      const configWithEmptyScopes: GoogleOAuthConfig = {
        ...baseConfig,
        scopes: []
      };
      const provider = new GoogleOAuthProvider(configWithEmptyScopes);

      const pkceSpy = jest.spyOn(provider as unknown as { generatePKCE: () => { codeVerifier: string; codeChallenge: string } }, 'generatePKCE')
        .mockReturnValue({ codeVerifier: 'verifier', codeChallenge: 'challenge' });
      const stateSpy = jest.spyOn(provider as unknown as { generateState: () => string }, 'generateState')
        .mockReturnValue('state123');

      const res = createMockResponse();
      const req = { query: {} } as Request;

      await provider.handleAuthorizationRequest(req, res);

      expect(mockGenerateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({
        scope: ['openid', 'email', 'profile'] // Default scopes
      }));

      const session = (provider as unknown as { getSession: (state: string) => OAuthSession | undefined }).getSession('state123');
      expect(session?.scopes).toEqual(['openid', 'email', 'profile']);

      pkceSpy.mockRestore();
      stateSpy.mockRestore();
      provider.dispose();
    });

    it('stores session with correct expiration timeout', async () => {
      const provider = createProvider();
      const now = 5_000_000;
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

      const pkceSpy = jest.spyOn(provider as unknown as { generatePKCE: () => { codeVerifier: string; codeChallenge: string } }, 'generatePKCE')
        .mockReturnValue({ codeVerifier: 'verifier', codeChallenge: 'challenge' });
      const stateSpy = jest.spyOn(provider as unknown as { generateState: () => string }, 'generateState')
        .mockReturnValue('state123');

      const res = createMockResponse();
      const req = { query: {} } as Request;

      await provider.handleAuthorizationRequest(req, res);

      const session = (provider as unknown as { getSession: (state: string) => OAuthSession | undefined }).getSession('state123');
      expect(session?.expiresAt).toBe(now + 10 * 60 * 1000); // 10 minute timeout

      pkceSpy.mockRestore();
      stateSpy.mockRestore();
      dateSpy.mockRestore();
      provider.dispose();
    });

    it('handles error during authorization URL generation', async () => {
      const provider = createProvider();
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Make generateAuthUrl throw an error
      mockGenerateAuthUrl.mockImplementation(() => {
        throw new Error('Auth URL generation failed');
      });

      const res = createMockResponse();
      const req = { query: {} } as Request;

      await provider.handleAuthorizationRequest(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'Failed to initiate authorization' });
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      provider.dispose();
    });
  });

  // Authorization Callback Flow Tests
  describe('Authorization Callback Flow', () => {
    it('handles OAuth error parameter from Google', async () => {
      const provider = createProvider();
      const res = createMockResponse();
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await provider.handleAuthorizationCallback({
        query: { error: 'access_denied', error_description: 'User denied access' }
      } as unknown as Request, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Authorization failed',
        details: 'access_denied'
      });
      expect(consoleSpy).toHaveBeenCalledWith('Google OAuth error:', 'access_denied');

      consoleSpy.mockRestore();
      provider.dispose();
    });

    it('validates missing code parameter', async () => {
      const provider = createProvider();
      const res = createMockResponse();

      await provider.handleAuthorizationCallback({
        query: { state: 'valid_state' } // Missing code
      } as unknown as Request, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Missing authorization code or state' });

      provider.dispose();
    });

    it('validates missing state parameter', async () => {
      const provider = createProvider();
      const res = createMockResponse();

      await provider.handleAuthorizationCallback({
        query: { code: 'valid_code' } // Missing state
      } as unknown as Request, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Missing authorization code or state' });

      provider.dispose();
    });

    it('handles invalid state parameter with detailed error', async () => {
      const provider = createProvider();
      const res = createMockResponse();

      await provider.handleAuthorizationCallback({
        query: { code: 'valid_code', state: 'invalid_state' }
      } as unknown as Request, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'oauth_state_error',
        error_description: expect.stringContaining('Invalid or expired state parameter'),
        retry_suggestion: 'Please start the OAuth flow again by visiting /auth/google'
      });

      provider.dispose();
    });

    it('redirects to client when clientRedirectUri is provided', async () => {
      const provider = createProvider();
      const now = 6_000_000;
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

      // Store session with client redirect URI
      (provider as unknown as { storeSession: (state: string, session: OAuthSession) => void }).storeSession('state123', {
        state: 'state123',
        codeVerifier: '',
        codeChallenge: 'challenge',
        redirectUri: baseConfig.redirectUri,
        clientRedirectUri: 'https://client.example.com/callback',
        scopes: ['openid', 'email'],
        provider: 'google',
        expiresAt: now + 5_000
      });

      const res = createMockResponse();

      await provider.handleAuthorizationCallback({
        query: { code: 'auth_code', state: 'state123' }
      } as unknown as Request, res);

      expect(res.redirect).toHaveBeenCalledWith('https://client.example.com/callback?code=auth_code&state=state123');

      // Session should be cleaned up
      const sessionAfter = (provider as unknown as { getSession: (state: string) => OAuthSession | undefined }).getSession('state123');
      expect(sessionAfter).toBeUndefined();

      dateSpy.mockRestore();
      provider.dispose();
    });

    it('handles ID token verification failure', async () => {
      const provider = createProvider();
      const now = 7_000_000;
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
          id_token: 'invalid-id-token'
        }
      });

      // Mock verifyIdToken to return invalid payload
      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({ sub: null, email: null }) // Invalid payload
      });

      const res = createMockResponse();

      await provider.handleAuthorizationCallback({
        query: { code: 'code123', state: 'state123' }
      } as unknown as Request, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Authorization failed'
      }));

      dateSpy.mockRestore();
      provider.dispose();
    });

    it('handles missing expiry_date in tokens', async () => {
      const provider = createProvider();
      const now = 8_000_000;
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
          id_token: 'id-token'
          // Missing expiry_date
        }
      });

      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({
          sub: '123',
          email: 'user@example.com',
          name: 'Test User'
        })
      });

      const res = createMockResponse();

      await provider.handleAuthorizationCallback({
        query: { code: 'code123', state: 'state123' }
      } as unknown as Request, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        access_token: 'access-token',
        expires_in: expect.any(Number) // Should have calculated expiry
      }));

      const storedToken = (provider as unknown as { getToken: (token: string) => StoredTokenInfo | undefined }).getToken('access-token');
      expect(storedToken?.expiresAt).toBe(now + 3600 * 1000); // Default 1 hour

      dateSpy.mockRestore();
      provider.dispose();
    });

    it('handles user info with fallback name from email', async () => {
      const provider = createProvider();
      const now = 9_000_000;
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
          id_token: 'id-token',
          expiry_date: now + 3_600_000
        }
      });

      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({
          sub: '123',
          email: 'user@example.com'
          // Missing name - should fallback to email
        })
      });

      const res = createMockResponse();

      await provider.handleAuthorizationCallback({
        query: { code: 'code123', state: 'state123' }
      } as unknown as Request, res);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        user: expect.objectContaining({
          name: 'user@example.com', // Should fallback to email
          email: 'user@example.com'
        })
      }));

      dateSpy.mockRestore();
      provider.dispose();
    });
  });

  // Token Exchange Flow Tests
  describe('Token Exchange Flow', () => {
    it('rejects unsupported grant types', async () => {
      const provider = createProvider();
      const res = createMockResponse();

      await provider.handleTokenExchange({
        body: { grant_type: 'client_credentials', code: 'code123' }
      } as unknown as Request, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'unsupported_grant_type',
        error_description: 'Only authorization_code grant type is supported'
      });

      provider.dispose();
    });

    it('validates missing code parameter', async () => {
      const provider = createProvider();
      const res = createMockResponse();

      await provider.handleTokenExchange({
        body: { grant_type: 'authorization_code', code_verifier: 'verifier' }
      } as unknown as Request, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'invalid_request',
        error_description: 'Missing required parameter: code'
      });

      provider.dispose();
    });

    it('handles Google API failure during token exchange', async () => {
      const provider = createProvider();
      const res = createMockResponse();
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Mock getToken to throw error
      mockGetToken.mockRejectedValueOnce(new Error('Invalid authorization code'));

      await provider.handleTokenExchange({
        body: {
          grant_type: 'authorization_code',
          code: 'invalid_code',
          code_verifier: 'verifier'
        }
      } as unknown as Request, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'server_error',
        error_description: 'Invalid authorization code'
      });
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      provider.dispose();
    });

    it('removes undefined fields from token response', async () => {
      const provider = createProvider();
      const now = 10_000_000;
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

      mockGetToken.mockResolvedValueOnce({
        tokens: {
          access_token: 'access-token',
          id_token: 'id-token'
          // No refresh_token - should be removed from response
        }
      });

      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({
          sub: '123',
          email: 'user@example.com',
          name: 'Test User'
        })
      });

      const res = createMockResponse();

      await provider.handleTokenExchange({
        body: {
          grant_type: 'authorization_code',
          code: 'code123',
          code_verifier: 'verifier'
        }
      } as unknown as Request, res);

      expect(res.json).toHaveBeenCalledWith(expect.not.objectContaining({
        refresh_token: undefined
      }));

      // Verify response structure
      const responseCall = (res.json as jest.Mock).mock.calls[0]?.[0] as any;
      expect('refresh_token' in responseCall).toBe(false);
      expect(responseCall).toMatchObject({
        access_token: 'access-token',
        token_type: 'Bearer',
        expires_in: expect.any(Number),
        scope: 'openid email profile'
      });

      dateSpy.mockRestore();
      provider.dispose();
    });
  });

  // Token Verification Flow Tests
  describe('Token Verification Flow', () => {
    it('returns cached token info when found in local store', async () => {
      const provider = createProvider();
      const now = 11_000_000;
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now);

      const tokenInfo: StoredTokenInfo = {
        accessToken: 'cached-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        expiresAt: now + 3_600_000,
        userInfo: {
          sub: '123',
          email: 'cached@example.com',
          name: 'Cached User',
          provider: 'google'
        },
        provider: 'google',
        scopes: ['openid', 'email']
      };

      (provider as unknown as { storeToken: (token: string, info: StoredTokenInfo) => void }).storeToken('cached-token', tokenInfo);

      const authInfo = await provider.verifyAccessToken('cached-token');

      expect(authInfo).toMatchObject({
        token: 'cached-token',
        clientId: baseConfig.clientId,
        scopes: ['openid', 'email'],
        extra: {
          userInfo: tokenInfo.userInfo,
          provider: 'google'
        }
      });

      // Should not call Google API
      expect(mockGetTokenInfo).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();

      dateSpy.mockRestore();
      provider.dispose();
    });

    it('verifies token with Google TokenInfo API when not in cache', async () => {
      const provider = createProvider();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      mockGetTokenInfo.mockResolvedValueOnce({
        sub: '456',
        email: 'google-verified@example.com',
        scopes: ['openid', 'email', 'profile'],
        expiry_date: 1_234_567_890
      });

      const authInfo = await provider.verifyAccessToken('google-token');

      expect(mockGetTokenInfo).toHaveBeenCalledWith('google-token');
      expect(authInfo).toMatchObject({
        token: 'google-token',
        clientId: baseConfig.clientId,
        scopes: ['openid', 'email', 'profile'],
        expiresAt: 1_234_567,
        extra: {
          userInfo: {
            sub: '456',
            email: 'google-verified@example.com',
            provider: 'google'
          }
        }
      });

      consoleSpy.mockRestore();
      provider.dispose();
    });

    it('falls back to UserInfo API when TokenInfo fails', async () => {
      const provider = createProvider();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      // Mock TokenInfo to fail
      mockGetTokenInfo.mockRejectedValueOnce(new Error('Token info failed'));

      // Mock UserInfo API success
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: '789',
          email: 'userinfo@example.com',
          name: 'UserInfo User',
          picture: 'avatar.jpg'
        })
      } as any);

      const authInfo = await provider.verifyAccessToken('fallback-token');

      expect(mockGetTokenInfo).toHaveBeenCalledWith('fallback-token');
      expect(mockFetch).toHaveBeenCalledWith('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { 'Authorization': 'Bearer fallback-token' }
      });
      expect(authInfo).toMatchObject({
        token: 'fallback-token',
        scopes: ['openid', 'email', 'profile'],
        extra: {
          userInfo: {
            sub: '789',
            email: 'userinfo@example.com',
            provider: 'google'
          }
        }
      });

      consoleSpy.mockRestore();
      provider.dispose();
    });

    it('throws error when both TokenInfo and UserInfo APIs fail', async () => {
      const provider = createProvider();
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      // Mock TokenInfo to fail
      mockGetTokenInfo.mockRejectedValueOnce(new Error('Token info failed'));

      // Mock UserInfo API to fail
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      } as any);

      await expect(provider.verifyAccessToken('invalid-token'))
        .rejects
        .toThrow('Invalid or expired token');

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      provider.dispose();
    });
  });

  // Additional Coverage Tests
  describe('Additional Coverage Tests', () => {
    it('returns user info from local token store', async () => {
      const provider = createProvider();
      const tokenInfo: StoredTokenInfo = {
        accessToken: 'local-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        expiresAt: Date.now() + 3_600_000,
        userInfo: {
          sub: '123',
          email: 'local@example.com',
          name: 'Local User',
          provider: 'google'
        },
        provider: 'google',
        scopes: ['openid', 'email']
      };

      (provider as unknown as { storeToken: (token: string, info: StoredTokenInfo) => void }).storeToken('local-token', tokenInfo);

      const userInfo = await provider.getUserInfo('local-token');

      expect(userInfo).toEqual(tokenInfo.userInfo);
      expect(mockFetch).not.toHaveBeenCalled();

      provider.dispose();
    });

    it('fetches user info from Google API when not in local store', async () => {
      const provider = createProvider();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          id: '456',
          email: 'remote@example.com',
          name: 'Remote User',
          picture: 'remote-avatar.jpg'
        })
      } as any);

      const userInfo = await provider.getUserInfo('remote-token');

      expect(mockFetch).toHaveBeenCalledWith('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { 'Authorization': 'Bearer remote-token' }
      });
      expect(userInfo).toMatchObject({
        sub: '456',
        email: 'remote@example.com',
        name: 'Remote User',
        picture: 'remote-avatar.jpg',
        provider: 'google'
      });

      provider.dispose();
    });

    it('handles getUserInfo API failure', async () => {
      const provider = createProvider();
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden'
      } as any);

      await expect(provider.getUserInfo('invalid-token'))
        .rejects
        .toThrow('Failed to get user information');

      consoleSpy.mockRestore();
      provider.dispose();
    });

    it('handles logout with authorization header', async () => {
      const provider = createProvider();
      const tokenInfo: StoredTokenInfo = {
        accessToken: 'logout-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
        expiresAt: Date.now() + 3_600_000,
        userInfo: {
          sub: '123',
          email: 'logout@example.com',
          name: 'Logout User',
          provider: 'google'
        },
        provider: 'google',
        scopes: ['openid', 'email']
      };

      (provider as unknown as { storeToken: (token: string, info: StoredTokenInfo) => void }).storeToken('logout-token', tokenInfo);

      const res = createMockResponse();
      await provider.handleLogout({
        headers: { authorization: 'Bearer logout-token' }
      } as Request, res);

      expect(res.json).toHaveBeenCalledWith({ success: true });

      // Token should be removed
      const removedToken = (provider as unknown as { getToken: (token: string) => StoredTokenInfo | undefined }).getToken('logout-token');
      expect(removedToken).toBeUndefined();

      provider.dispose();
    });

    it('handles logout without authorization header', async () => {
      const provider = createProvider();
      const res = createMockResponse();

      await provider.handleLogout({
        headers: {}
      } as Request, res);

      expect(res.json).toHaveBeenCalledWith({ success: true });

      provider.dispose();
    });

    it('returns correct provider metadata', () => {
      const provider = createProvider();

      expect(provider.getProviderType()).toBe('google');
      expect(provider.getProviderName()).toBe('Google');
      expect(provider.getEndpoints()).toEqual({
        authEndpoint: '/auth/google',
        callbackEndpoint: '/auth/google/callback',
        refreshEndpoint: '/auth/google/refresh',
        logoutEndpoint: '/auth/google/logout'
      });
      expect(provider.getDefaultScopes()).toEqual(['openid', 'email', 'profile']);

      provider.dispose();
    });
  });
});
