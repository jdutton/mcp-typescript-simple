import { vi } from 'vitest';

import type { Request } from 'express';
import type { GoogleOAuthConfig } from '@mcp-typescript-simple/auth';
import { logger } from '@mcp-typescript-simple/auth';
import { MemoryPKCEStore } from '@mcp-typescript-simple/persistence';

import {
  createAndStoreSession,
  mockIdTokenVerification,
  setupGoogleAuthMocks,
  getProviderSession,
  withGoogleProvider,
  mockDateNow,
  testGoogleAuthorizationRequest,
  testGoogleJWTValidation,
  createTestAuthCache,
  testTokenRefreshMissingToken,
  setupGoogleCallbackTest,
  testAuthorizationCallbackFailure
} from './test-helpers.js';

// Setup Google auth library mocks
const {
  mockGenerateAuthUrl,
  mockGetToken,
  mockVerifyIdToken,
  mockRefreshAccessToken,
  mockSetCredentials,
  mockGetTokenInfo
} = setupGoogleAuthMocks();

// Mock global fetch for Google API calls
const mockFetch = vi.fn() as MockFunction<typeof fetch>;
(global as any).fetch = mockFetch;

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn(() => ({
    generateAuthUrl: mockGenerateAuthUrl,
    getToken: mockGetToken,
    verifyIdToken: mockVerifyIdToken,
    refreshAccessToken: mockRefreshAccessToken,
    setCredentials: mockSetCredentials,
    getTokenInfo: mockGetTokenInfo
  }))
}));

let GoogleOAuthProvider: typeof import('@mcp-typescript-simple/auth').GoogleOAuthProvider;

beforeAll(async () => {
  ({ GoogleOAuthProvider } = await import('@mcp-typescript-simple/auth'));
});

const baseConfig: GoogleOAuthConfig = {
  type: 'google',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://example.com/callback',
  scopes: ['openid', 'email']
};

describe('GoogleOAuthProvider', () => {
  const createProvider = () => {
    return new GoogleOAuthProvider(baseConfig, undefined, new MemoryPKCEStore());
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth?state=state123');
    mockFetch.mockClear();
  });

  it('redirects to Google authorization URL and stores session data', async () => {
    await testGoogleAuthorizationRequest(createProvider, {
      state: 'state123',
      codeVerifier: 'verifier',
      codeChallenge: 'challenge',
      expectedSession: {
        state: 'state123',
        codeVerifier: 'verifier',
        provider: 'google'
      }
    });

    expect(mockGenerateAuthUrl).toHaveBeenCalledWith({
      access_type: 'offline',
      scope: ['openid', 'email'],
      state: 'state123',
      code_challenge: 'challenge',
      code_challenge_method: 'S256',
      prompt: 'consent',
      redirect_uri: baseConfig.redirectUri
    });
  });

  it('exchanges code for tokens and returns user info during callback', async () => {
    await withGoogleProvider(createProvider, async (provider, res) => {
      const now = 1_000_000;
      const { dateSpy } = setupGoogleCallbackTest(provider, {
        now,
        state: 'state123',
        redirectUri: baseConfig.redirectUri,
        mockGetToken,
        tokens: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          id_token: 'id-token',
          expiry_date: now + 3_600_000
        }
      });

      mockIdTokenVerification(mockVerifyIdToken, {
        sub: '123',
        email: 'user@example.com',
        name: 'Test User',
        picture: 'avatar.png'
      });

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

      const sessionAfter = await getProviderSession(provider, 'state123');
      expect(sessionAfter).toBeNull();

      // ADR 006: Tokens are not stored server-side

      dateSpy.mockRestore();
    });
  });

  it('returns 500 when Google does not supply an access token', async () => {
    await withGoogleProvider(createProvider, async (provider, res) => {
      const now = 2_000_000;
      const dateSpy = mockDateNow(now);
      createAndStoreSession(provider, 'state123', {
        redirectUri: baseConfig.redirectUri,
        scopes: baseConfig.scopes,
        expiresAt: now + 5_000
      });

      mockGetToken.mockResolvedValueOnce({ tokens: {} });

      const consoleSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

      await testAuthorizationCallbackFailure(provider, res);

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      dateSpy.mockRestore();
    });
  });

  it('refreshes tokens when provided a valid refresh token', async () => {
    await withGoogleProvider(createProvider, async (provider, res) => {
      const now = 3_000_000;
      const dateSpy = mockDateNow(now);

      // ADR 006: Tokens are not stored server-side
      mockRefreshAccessToken.mockResolvedValueOnce({
        credentials: {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expiry_date: now + 7_200_000
        }
      });

      await provider.handleTokenRefresh({
        body: { refresh_token: 'refresh-token' }
      } as unknown as Request, res);

      expect(mockSetCredentials).toHaveBeenCalledWith({ refresh_token: 'refresh-token' });
      expect(mockRefreshAccessToken).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token'
      }));

      dateSpy.mockRestore();
    });
  });

  it('returns 401 when refresh token is unknown', async () => {
    await withGoogleProvider(createProvider, async (provider, res) => {
      await testTokenRefreshMissingToken(provider, res, 'missing-token');
    });
  });

  // Authorization Request Flow Tests
  describe('Authorization Request Flow', () => {
    it('handles MCP Inspector client redirect flow with provided parameters', async () => {
      await testGoogleAuthorizationRequest(createProvider, {
        state: 'generated_state',
        codeVerifier: '',
        codeChallenge: 'client_challenge',
        mockSetupPKCE: { state: 'generated_state', codeVerifier: '', codeChallenge: 'client_challenge' },
        request: {
          query: {
            redirect_uri: 'https://client.example.com/callback',
            code_challenge: 'client_challenge',
            code_challenge_method: 'S256',
            state: 'client_state',
            client_id: 'client-123'
          }
        } as Partial<Request>,
        expectedSession: {
          state: 'generated_state',
          codeVerifier: '',
          codeChallenge: 'client_challenge',
          clientRedirectUri: 'https://client.example.com/callback'
        }
      });

      expect(mockGenerateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({
        code_challenge: 'client_challenge',
        code_challenge_method: 'S256',
        state: 'generated_state'
      }));
    });

    it('generates PKCE when client parameters are missing', async () => {
      await testGoogleAuthorizationRequest(createProvider, {
        state: 'generated_state',
        codeVerifier: 'generated_verifier',
        codeChallenge: 'generated_challenge',
        expectedSession: {
          codeVerifier: 'generated_verifier',
          codeChallenge: 'generated_challenge'
        }
      });

      expect(mockGenerateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({
        code_challenge: 'generated_challenge',
        state: 'generated_state'
      }));
    });

    it('uses default scopes when config scopes are empty', async () => {
      const configWithEmptyScopes: GoogleOAuthConfig = {
        ...baseConfig,
        scopes: []
      };
      const createProviderWithEmptyScopes = () => new GoogleOAuthProvider(configWithEmptyScopes, undefined, new MemoryPKCEStore());

      await testGoogleAuthorizationRequest(createProviderWithEmptyScopes, {
        state: 'state123',
        codeVerifier: 'verifier',
        codeChallenge: 'challenge'
      });

      expect(mockGenerateAuthUrl).toHaveBeenCalledWith(expect.objectContaining({
        scope: ['openid', 'email', 'profile'] // Default scopes
      }));
    });

    it('stores session with correct expiration timeout', async () => {
      const now = 5_000_000;
      const dateSpy = mockDateNow(now);

      const { session } = await testGoogleAuthorizationRequest(createProvider, {
        state: 'state123',
        codeVerifier: 'verifier',
        codeChallenge: 'challenge'
      });

      expect(session?.expiresAt).toBe(now + 10 * 60 * 1000); // 10 minute timeout
      dateSpy.mockRestore();
    });

    it('handles error during authorization URL generation', async () => {
      await withGoogleProvider(createProvider, async (provider, res) => {
        const consoleSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

        // Make generateAuthUrl throw an error
        mockGenerateAuthUrl.mockImplementation(() => {
          throw new Error('Auth URL generation failed');
        });

        const req = { query: {} } as Request;
        await provider.handleAuthorizationRequest(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'Failed to initiate authorization' });
        expect(consoleSpy).toHaveBeenCalled();

        consoleSpy.mockRestore();
      });
    });
  });

  // Authorization Callback Flow Tests
  describe('OAuth callback error handling', () => {
    it('returns error if code is missing', async () => {
      await withGoogleProvider(createProvider, async (provider, res) => {
        await provider.handleAuthorizationCallback({
          query: { state: 'valid_state' } // Missing code
        } as unknown as Request, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: 'Missing authorization code or state' });
      });
    });

    it('returns error if OAuth provider returns error', async () => {
      await withGoogleProvider(createProvider, async (provider, res) => {
        const loggerErrorSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

        await provider.handleAuthorizationCallback({
          query: { error: 'access_denied', error_description: 'User denied access' }
        } as unknown as Request, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Authorization failed',
          details: 'access_denied'
        });

        loggerErrorSpy.mockRestore();
      });
    });

    it('returns error when token exchange does not provide access token', async () => {
      await withGoogleProvider(createProvider, async (provider, res) => {
        const now = 9_000_000;
        const dateSpy = mockDateNow(now);
        const loggerErrorSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

        createAndStoreSession(provider, 'state123', {
          redirectUri: baseConfig.redirectUri,
          scopes: baseConfig.scopes,
          expiresAt: now + 5_000
        });

        // Mock Google's getToken to return empty tokens
        mockGetToken.mockResolvedValueOnce({
          tokens: {} // No access_token
        });

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

        dateSpy.mockRestore();
        loggerErrorSpy.mockRestore();
      });
    });
  });

  describe('Authorization Callback Flow', () => {
    it('handles invalid state parameter with detailed error', async () => {
      await withGoogleProvider(createProvider, async (provider, res) => {
        await provider.handleAuthorizationCallback({
          query: { code: 'valid_code', state: 'invalid_state' }
        } as unknown as Request, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'oauth_state_error',
          error_description: expect.stringContaining('Invalid or expired state parameter'),
          retry_suggestion: 'Please start the OAuth flow again by visiting /auth/google'
        });
      });
    });

    it('redirects to client when clientRedirectUri is provided', async () => {
      await withGoogleProvider(createProvider, async (provider, res) => {
        const now = 6_000_000;
        const dateSpy = mockDateNow(now);

        // Store session with client redirect URI
        createAndStoreSession(provider, 'state123', {
          codeVerifier: '',
          redirectUri: baseConfig.redirectUri,
          clientRedirectUri: 'https://client.example.com/callback',
          scopes: ['openid', 'email'],
          expiresAt: now + 5_000
        });

        await provider.handleAuthorizationCallback({
          query: { code: 'auth_code', state: 'state123' }
        } as unknown as Request, res);

        expect(res.redirect).toHaveBeenCalledWith('https://client.example.com/callback?code=auth_code&state=state123');

        // Session should NOT be cleaned up yet - preserved for token exchange
        // It will be cleaned up in handleTokenExchange after successful exchange
        const sessionAfter = await getProviderSession(provider, 'state123');
        expect(sessionAfter).not.toBeNull();
        expect(sessionAfter?.state).toBe('state123');

        dateSpy.mockRestore();
      });
    });

    it('handles ID token verification failure', async () => {
      await withGoogleProvider(createProvider, async (provider, res) => {
        const now = 7_000_000;
        const { dateSpy } = setupGoogleCallbackTest(provider, {
          now,
          state: 'state123',
          redirectUri: baseConfig.redirectUri,
          mockGetToken,
          tokens: {
            access_token: 'access-token',
            id_token: 'invalid-id-token'
          }
        });

        // Mock verifyIdToken to return invalid payload
        mockVerifyIdToken.mockResolvedValueOnce({
          getPayload: () => ({ sub: null, email: null }) // Invalid payload
        });

        await testAuthorizationCallbackFailure(provider, res);

        dateSpy.mockRestore();
      });
    });

    it('handles missing expiry_date in tokens', async () => {
      await withGoogleProvider(createProvider, async (provider, res) => {
        const now = 8_000_000;
        const { dateSpy } = setupGoogleCallbackTest(provider, {
          now,
          state: 'state123',
          redirectUri: baseConfig.redirectUri,
          mockGetToken,
          tokens: {
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            id_token: 'id-token'
            // Missing expiry_date
          }
        });

        mockIdTokenVerification(mockVerifyIdToken, {
          sub: '123',
          email: 'user@example.com',
          name: 'Test User'
        });

        await provider.handleAuthorizationCallback({
          query: { code: 'code123', state: 'state123' }
        } as unknown as Request, res);

        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
          access_token: 'access-token',
          expires_in: expect.any(Number) // Should have calculated expiry
        }));

        // ADR 006: Tokens are not stored server-side

        dateSpy.mockRestore();
      });
    });

    it('handles user info with fallback name from email', async () => {
      await withGoogleProvider(createProvider, async (provider, res) => {
        const now = 9_000_000;
        const { dateSpy } = setupGoogleCallbackTest(provider, {
          now,
          state: 'state123',
          redirectUri: baseConfig.redirectUri,
          mockGetToken,
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
      });
    });
  });

  // Token Exchange Flow Tests
  describe('Token Exchange Flow', () => {
    it('rejects unsupported grant types', async () => {
      await withGoogleProvider(createProvider, async (provider, res) => {
        await provider.handleTokenExchange({
          body: { grant_type: 'client_credentials', code: 'code123' }
        } as unknown as Request, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'unsupported_grant_type',
          error_description: 'Only authorization_code grant type is supported'
        });
      });
    });

    it('validates missing code parameter', async () => {
      await withGoogleProvider(createProvider, async (provider, res) => {
        await provider.handleTokenExchange({
          body: { grant_type: 'authorization_code', code_verifier: 'verifier' }
        } as unknown as Request, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'invalid_request',
          error_description: 'Missing required parameter: code'
        });
      });
    });

    it('handles Google API failure during token exchange', async () => {
      await withGoogleProvider(createProvider, async (provider, res) => {
        const consoleSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

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
      });
    });

    it('removes undefined fields from token response', async () => {
      await withGoogleProvider(createProvider, async (provider, res) => {
        const now = 10_000_000;
        const dateSpy = mockDateNow(now);

        mockGetToken.mockResolvedValueOnce({
          tokens: {
            access_token: 'access-token',
            id_token: 'id-token'
            // No refresh_token - should be removed from response
          }
        });

        mockIdTokenVerification(mockVerifyIdToken, {
          sub: '123',
          email: 'user@example.com',
          name: 'Test User'
        });

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
        const responseCall = vi.mocked(res.json).mock.calls[0]?.[0] as any;
        expect('refresh_token' in responseCall).toBe(false);
        expect(responseCall).toMatchObject({
          access_token: 'access-token',
          token_type: 'Bearer',
          expires_in: expect.any(Number),
          scope: 'openid email profile'
        });

        dateSpy.mockRestore();
      });
    });
  });

  // Token Verification Flow Tests
  describe('Token Verification Flow', () => {
    it('verifies token with Google TokenInfo API', async () => {
      const provider = createProvider();
      const consoleSpy = vi.spyOn(logger, 'oauthDebug').mockImplementation(() => {});

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
      const consoleSpy = vi.spyOn(logger, 'oauthDebug').mockImplementation(() => {});

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
      const consoleSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

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
    it('fetches user info from Google API', async () => {
      await withGoogleProvider(createProvider, async (provider) => {
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
      });
    });

    it('handles getUserInfo API failure', async () => {
      await withGoogleProvider(createProvider, async (provider) => {
        const consoleSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden'
        } as any);

        await expect(provider.getUserInfo('invalid-token'))
          .rejects
          .toThrow('Failed to get user information');

        consoleSpy.mockRestore();
      });
    });

    it('handles logout with authorization header', async () => {
      await withGoogleProvider(createProvider, async (provider, res) => {
        // ADR 006: Tokens are not stored server-side
        await provider.handleLogout({
          headers: { authorization: 'Bearer logout-token' }
        } as Request, res);

        expect(res.json).toHaveBeenCalledWith({ success: true });
      });
    });

    it('handles logout without authorization header', async () => {
      await withGoogleProvider(createProvider, async (provider, res) => {
        await provider.handleLogout({
          headers: {}
        } as Request, res);

        expect(res.json).toHaveBeenCalledWith({ success: true });
      });
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

  describe('JWT Validation (ADR 006)', () => {
    // eslint-disable-next-line sonarjs/assertions-in-tests -- assertions are in testGoogleJWTValidation helper
    it('should validate ID token locally using JWT signature verification', async () => {
      // Mock verifyIdToken to return valid token
      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({
          sub: 'user-123',
          email: 'test@example.com',
          exp: Math.floor(Date.now() / 1000) + 3600 // Valid for 1 hour
        })
      });

      await testGoogleJWTValidation(
        createProvider,
        createTestAuthCache({
          provider: 'google',
          idToken: 'valid-jwt-token',
          userInfo: { sub: 'user-123', email: 'test@example.com' }
        }),
        true,
        mockVerifyIdToken
      );
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests -- assertions are in testGoogleJWTValidation helper
    it('should reject expired ID tokens', async () => {
      // Mock verifyIdToken to return expired token
      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => ({
          sub: 'user-123',
          email: 'test@example.com',
          exp: Math.floor(Date.now() / 1000) - 3600 // Expired 1 hour ago
        })
      });

      await testGoogleJWTValidation(
        createProvider,
        createTestAuthCache({
          provider: 'google',
          idToken: 'expired-jwt-token',
          userInfo: { sub: 'user-123', email: 'test@example.com' }
        }),
        false
      );
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests -- assertions are in testGoogleJWTValidation helper
    it('should reject invalid JWT tokens', async () => {
      // Mock verifyIdToken to throw error
      mockVerifyIdToken.mockRejectedValueOnce(new Error('Invalid token signature'));

      await testGoogleJWTValidation(
        createProvider,
        createTestAuthCache({
          provider: 'google',
          idToken: 'invalid-jwt-token',
          userInfo: { sub: 'user-123', email: 'test@example.com' }
        }),
        false
      );
    });

    // eslint-disable-next-line sonarjs/assertions-in-tests -- assertions are in testGoogleJWTValidation helper
    it('should reject tokens with invalid payload', async () => {
      // Mock verifyIdToken to return null payload
      mockVerifyIdToken.mockResolvedValueOnce({
        getPayload: () => null as any
      });

      await testGoogleJWTValidation(
        createProvider,
        createTestAuthCache({
          provider: 'google',
          idToken: 'jwt-token-with-null-payload',
          userInfo: { sub: 'user-123', email: 'test@example.com' }
        }),
        false
      );
    });

    it('should fallback to TTL-based caching when no ID token available', async () => {
      await testGoogleJWTValidation(
        createProvider,
        createTestAuthCache({
          provider: 'google',
          userInfo: { sub: 'user-123', email: 'test@example.com' }
          // No idToken field
        }),
        true
      );

      // Should NOT call verifyIdToken
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });

    it('should fallback to TTL-based caching and return false when TTL expired', async () => {
      await testGoogleJWTValidation(
        createProvider,
        createTestAuthCache({
          provider: 'google',
          lastValidated: Date.now() - 600000, // 10 minutes ago (beyond 5-minute TTL)
          validationTTL: 300000, // 5 minutes
          userInfo: { sub: 'user-123', email: 'test@example.com' }
          // No idToken field
        }),
        false
      );

      // Should NOT call verifyIdToken
      expect(mockVerifyIdToken).not.toHaveBeenCalled();
    });
  });
});
