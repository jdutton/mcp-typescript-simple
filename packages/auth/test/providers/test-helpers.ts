/**
 * Shared test helpers for OAuth provider tests
 *
 * This file contains common mock utilities and helper functions used across
 * provider test files to reduce code duplication.
 */

import { vi, expect } from 'vitest';
import type { Request, Response } from 'express';
import type { BaseOAuthProvider, OAuthSession } from '@mcp-typescript-simple/auth';
import { logger } from '@mcp-typescript-simple/observability';

/**
 * Mock Response type with additional tracking properties
 */
export type MockResponse = Response & {
  statusCode?: number;
  jsonPayload?: unknown;
  redirectUrl?: string;
  headers?: Record<string, string>;
};

/**
 * Creates a mock Express Response object for testing
 *
 * Tracks calls to status(), json(), redirect(), and setHeader() methods
 * for assertion in tests.
 *
 * @returns Mock Response object with spy functions
 */
export const createMockResponse = (): MockResponse => {
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

/**
 * Creates a mock fetch Response with JSON body
 *
 * Utility for mocking OAuth provider API responses in tests.
 *
 * @param body - JSON response body
 * @param init - Optional response initialization (status, statusText)
 * @returns Mock Response object
 */
export const jsonReply = <T>(body: T, init?: { status?: number; statusText?: string }) => {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(payload, {
    status: init?.status ?? 200,
    statusText: init?.statusText ?? 'OK',
    headers: {
      'Content-Type': 'application/json'
    }
  });
};

/**
 * Common test for authorization request parameters
 *
 * @param createProviderFn - Function to create a fresh provider instance
 * @param expectedAuthUrl - Expected authorization URL (provider-specific)
 */
export const testAuthorizationRequestParams = async (
  createProviderFn: () => BaseOAuthProvider,
  expectedAuthUrl: string
) => {
  const provider = createProviderFn();
  const res = createMockResponse();
  const loggerInfoSpy = vi.spyOn(logger, 'oauthInfo').mockImplementation(() => {});

  await provider.handleAuthorizationRequest({} as Request, res);

  const redirectUrl = res.redirectUrl ?? '';
  expect(redirectUrl).toContain(expectedAuthUrl);
  expect(redirectUrl).toContain('client_id=client-id');
  expect(redirectUrl).toContain('redirect_uri=');
  expect(redirectUrl).toContain('response_type=code');
  expect(redirectUrl).toContain('scope=');
  expect(redirectUrl).toContain('state=');
  expect(redirectUrl).toContain('code_challenge=');
  expect(redirectUrl).toContain('code_challenge_method=S256');

  loggerInfoSpy.mockRestore();
  provider.dispose();
};

/**
 * Common test for anti-caching headers
 *
 * @param createProviderFn - Function to create a fresh provider instance
 */
export const testAntiCachingHeaders = async (
  createProviderFn: () => BaseOAuthProvider
) => {
  const provider = createProviderFn();
  const res = createMockResponse();
  const loggerInfoSpy = vi.spyOn(logger, 'oauthInfo').mockImplementation(() => {});

  await provider.handleAuthorizationRequest({} as Request, res);

  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('no-store'));

  loggerInfoSpy.mockRestore();
  provider.dispose();
};

/**
 * Common OAuth callback error handling tests
 *
 * These tests verify standard OAuth error handling behavior that should be
 * consistent across all OAuth providers (GitHub, Google, Microsoft, Generic).
 *
 * @param createProviderFn - Function to create a fresh provider instance
 * @param providerConfig - Provider configuration (for storing sessions)
 */
export const testOAuthCallbackErrors = (
  createProviderFn: () => BaseOAuthProvider,
  providerConfig: { redirectUri: string; scopes: string[]; provider: string }
) => {
  return () => {
    it('returns error if code is missing', async () => {
      const provider = createProviderFn();
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
      const provider = createProviderFn();
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
      const provider = createProviderFn();
      const now = Date.now();

      const loggerErrorSpy = vi.spyOn(logger, 'oauthError').mockImplementation(() => {});

      (provider as unknown as { storeSession: (_state: string, _session: OAuthSession) => void }).storeSession('state123', {
        state: 'state123',
        codeVerifier: 'verifier',
        codeChallenge: 'challenge',
        redirectUri: providerConfig.redirectUri,
        scopes: providerConfig.scopes,
        provider: providerConfig.provider,
        expiresAt: now + 5_000
      });

      // Mock empty token response
      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock.mockResolvedValueOnce(jsonReply({}));

      const res = createMockResponse();
      const req = {
        query: {
          code: 'auth-code',
          state: 'state123'
        }
      } as unknown as Request;

      await provider.handleAuthorizationCallback(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Token exchange failed'
      });

      loggerErrorSpy.mockRestore();
      provider.dispose();
    });
  };
};
