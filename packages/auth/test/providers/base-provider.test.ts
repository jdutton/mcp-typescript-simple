import { vi } from 'vitest';

import type { Request } from 'express';
import {
  OAuthTokenError
} from '@mcp-typescript-simple/auth';
import type {
  OAuthConfig,
  OAuthSession,
  ProviderTokenResponse
} from '@mcp-typescript-simple/auth';
import { MemoryPKCEStore } from '@mcp-typescript-simple/persistence';
import { MockOAuthProvider } from '../../../http-server/test/helpers/mock-oauth-provider.js';

import { createMockResponse as createResponse, jsonReply } from './test-helpers.js';

type SessionAccess = {
  storeSession(_state: string, _session: OAuthSession): Promise<void>;
  getSession(_state: string): Promise<OAuthSession | null>;
  removeSession(_state: string): Promise<void>;
  cleanup(): Promise<void>;
};

const baseConfig: OAuthConfig = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  redirectUri: 'https://example.com/callback',
  scopes: ['scope'],
  type: 'google'
};

describe('BaseOAuthProvider', () => {
  let provider: MockOAuthProvider;
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
    provider = new MockOAuthProvider(baseConfig, 'google', new MemoryPKCEStore());
    sessionAccess = provider as unknown as SessionAccess;
  });

  afterEach(() => {
    provider.dispose();
    vi.useRealTimers();
  });

  it('cleans up expired sessions', async () => {
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

    await sessionAccess.storeSession('expired', expiredSession);
    await sessionAccess.storeSession('valid', { ...expiredSession, state: 'valid', expiresAt: now + 5000 });

    await sessionAccess.cleanup();

    // ADR 006: Only sessions are stored, tokens are client-managed
    expect(await sessionAccess.getSession('expired')).toBeNull();
    expect(await sessionAccess.getSession('valid')).toBeDefined();
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
    /**
     * Helper to create a test OAuth session with client redirect parameters
     */
    const createTestSession = (
      serverState: string,
      authCode: string,
      options?: {
        clientState?: string;
        clientRedirectUri?: string;
        scopes?: string[];
      }
    ): OAuthSession => {
      return {
        state: serverState,
        codeVerifier: 'verifier',
        codeChallenge: 'challenge',
        redirectUri: 'http://localhost:3000/auth/callback',
        clientRedirectUri: options?.clientRedirectUri,
        clientState: options?.clientState,
        scopes: options?.scopes ?? ['openid', 'profile', 'email'],
        provider: 'google',
        expiresAt: Date.now() + 600000
      };
    };

    /**
     * Helper to test handleClientRedirect with a session
     */
    const testClientRedirect = async (
      serverState: string,
      authCode: string,
      sessionOptions?: Parameters<typeof createTestSession>[2]
    ) => {
      const res = createResponse();
      const session = createTestSession(serverState, authCode, sessionOptions);
      sessionAccess.storeSession(serverState, session);
      const handled = await provider['handleClientRedirect'](session, authCode, serverState, res as Response);
      return { handled, res, session };
    };

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
      const serverState = 'server-state-abc';
      const clientState = 'client-state-xyz';
      const authCode = 'auth-code-123';

      const { handled, res } = await testClientRedirect(serverState, authCode, {
        clientState,
        clientRedirectUri: 'http://localhost:50151/callback'
      });

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
      const serverState = 'server-state-only';
      const authCode = 'auth-code-456';

      const { handled, res } = await testClientRedirect(serverState, authCode, {
        clientRedirectUri: 'http://localhost:6274/callback',
        scopes: ['openid', 'profile']
      });

      expect(handled).toBe(true);
      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining(`state=${serverState}`)
      );
    });

    it('does not handle redirect when clientRedirectUri not provided', async () => {
      const res = createResponse();
      const serverState = 'server-state-123';
      const authCode = 'auth-code-789';

      const session = createTestSession(serverState, authCode, {
        scopes: ['openid']
      });

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

  describe('OCSF Audit Event Instrumentation', () => {
    // Note: emitLogonEvent() and emitLogoffEvent() are protected helper methods
    // that are tested indirectly through OAuth flow integration tests below.
    // Actual OCSF event validation is comprehensively tested in the observability package.

    describe('Integration with OAuth flows', () => {
      it('handleAuthorizationCallback completes successfully (includes OCSF logon event)', async () => {
        // Verify that OAuth callback flow works with OCSF instrumentation
        // Note: Actual OCSF event validation is tested in observability package
        const req = {
          query: {
            code: 'auth-code-123',
            state: 'test-state'
          }
        } as unknown as Request;

        const res = createResponse();

        // Setup session
        const session: OAuthSession = {
          state: 'test-state',
          codeVerifier: 'verifier-123',
          codeChallenge: 'challenge-123',
          redirectUri: baseConfig.redirectUri,
          scopes: ['scope'],
          provider: 'google',
          expiresAt: Date.now() + 600000
        };

        await sessionAccess.storeSession('test-state', session);

        // Mock successful token exchange
        fetchMock.mockResolvedValueOnce(jsonReply<ProviderTokenResponse>({
          access_token: 'access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'scope'
        }));

        // Execute callback - should complete without throwing
        await expect(provider.handleAuthorizationCallback(req, res)).resolves.not.toThrow();
      });

      it('handleTokenExchange completes successfully (includes OCSF logon event)', async () => {
        const code = 'auth-code-456';
        const codeVerifier = 'verifier-456';

        const req = {
          body: {
            grant_type: 'authorization_code',
            code,
            code_verifier: codeVerifier
          }
        } as unknown as Request;

        const res = createResponse();

        // Store PKCE data so provider recognizes this code
        await provider['pkceStore'].storeCodeVerifier(
          provider['getProviderCodeKey'](code),
          { codeVerifier, state: 'test-state' },
          600
        );

        // Mock successful token exchange
        fetchMock.mockResolvedValueOnce(jsonReply<ProviderTokenResponse>({
          access_token: 'new-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'scope'
        }));

        // Execute token exchange - should complete without throwing
        await expect(provider.handleTokenExchange(req, res)).resolves.not.toThrow();
      });

      it('handleLogout completes successfully (includes OCSF logoff event)', async () => {
        const accessToken = 'logout-token-123';

        const req = {
          headers: {
            authorization: `Bearer ${accessToken}`
          }
        } as unknown as Request;

        const res = createResponse();

        // ADR 006: Tokens are not stored server-side, logout succeeds regardless
        // Execute logout - should complete without throwing
        await expect(provider.handleLogout(req, res)).resolves.not.toThrow();
      });
    });
  });
});
