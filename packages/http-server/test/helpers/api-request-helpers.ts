/**
 * Helper functions for API request testing patterns
 *
 * This module provides reusable helpers to eliminate duplication in
 * integration tests for session-based authentication.
 */

import type { Application } from 'express';
import request from 'supertest';

/**
 * Configuration for authenticated API requests
 */
export interface AuthenticatedRequestConfig {
  /** Express application instance */
  app: Application;
  /** API endpoint path */
  endpoint: string;
  /** Bearer token for Authorization header */
  token: string;
  /** Session ID for mcp-session-id header */
  sessionId: string;
}

/**
 * Configuration for tracking user info fetch calls
 */
export interface FetchTrackingConfig {
  /** Mock function to track calls */
  mockFetchUserInfo: () => Promise<{
    sub: string;
    name: string;
    email: string;
  }>;
  /** Flag to track if fetch was called */
  fetchCalled: { value: boolean };
}

/**
 * Makes an authenticated API request with session ID
 *
 * @param config - Request configuration
 * @returns Supertest response
 *
 * @example
 * ```typescript
 * const response = await makeAuthenticatedRequest({
 *   app,
 *   endpoint: '/api/test',
 *   token: 'test-token',
 *   sessionId: 'session-123'
 * });
 * expect(response.status).toBe(200);
 * ```
 */
export async function makeAuthenticatedRequest(config: AuthenticatedRequestConfig) {
  const { app, endpoint, token, sessionId } = config;

  return await request(app)
    .get(endpoint)
    .set('Authorization', `Bearer ${token}`)
    .set('mcp-session-id', sessionId);
}

/**
 * Creates a mock fetchUserInfo function with call tracking
 *
 * @param fetchCalled - Object to track if fetch was called
 * @returns Mock function that returns user info
 *
 * @example
 * ```typescript
 * const fetchCalled = { value: false };
 * provider.mockFetchUserInfo = createMockFetchUserInfo(fetchCalled);
 * // ... make request ...
 * expect(fetchCalled.value).toBe(false); // Verify cached
 * ```
 */
export function createMockFetchUserInfo(fetchCalled: { value: boolean }) {
  return async () => {
    fetchCalled.value = true;
    return {
      sub: 'user-123',
      name: 'Test User',
      email: 'test@example.com'
    };
  };
}

/**
 * Tests an API request with fetch call tracking
 *
 * @param config - Request configuration
 * @param setupMock - Function to set up the mock
 * @returns Object containing response and fetch tracking flag
 *
 * @example
 * ```typescript
 * const { response, fetchCalled } = await testRequestWithFetchTracking(
 *   { app, endpoint: '/api/test', token, sessionId },
 *   (mock) => { provider.mockFetchUserInfo = mock; }
 * );
 * expect(response.status).toBe(200);
 * expect(fetchCalled).toBe(false); // Verify cached
 * ```
 */
export async function testRequestWithFetchTracking(
  config: AuthenticatedRequestConfig,
  setupMock: (_mockFn: () => Promise<{
    sub: string;
    name: string;
    email: string;
  }>) => void
) {
  const fetchCalled = { value: false };
  setupMock(createMockFetchUserInfo(fetchCalled));

  const response = await makeAuthenticatedRequest(config);

  return {
    response,
    fetchCalled: fetchCalled.value
  };
}

/**
 * Expect matchers for common API response assertions
 *
 * Use these with Vitest's expect() to validate API responses in a DRY manner.
 */
export const expectMatchers = {
  /**
   * Asserts that response is a 401 unauthorized error
   *
   * @example
   * ```typescript
   * const response = await makeAuthenticatedRequest({ ... });
   * expectMatchers.toBeUnauthorized(response, 'Session not found');
   * ```
   */
  toBeUnauthorized(response: any, errorSubstring: string) {
    if (response.status !== 401) {
      throw new Error(`Expected status 401 but got ${response.status}`);
    }
    if (!response.body.error?.includes(errorSubstring)) {
      throw new Error(`Expected error containing "${errorSubstring}" but got "${response.body.error}"`);
    }
  },

  /**
   * Asserts that response is a 200 success with user data
   *
   * @example
   * ```typescript
   * const response = await makeAuthenticatedRequest({ ... });
   * expectMatchers.toBeAuthenticatedSuccess(response, 'user-123', 'google');
   * ```
   */
  toBeAuthenticatedSuccess(response: any, expectedUserId: string, expectedProvider: string) {
    if (response.status !== 200) {
      throw new Error(`Expected status 200 but got ${response.status}: ${JSON.stringify(response.body)}`);
    }
    if (!response.body.success) {
      throw new Error('Expected success: true in response');
    }
    if (!response.body.user) {
      throw new Error('Expected user data in response');
    }
    if (response.body.user.sub !== expectedUserId) {
      throw new Error(`Expected user.sub to be "${expectedUserId}" but got "${response.body.user.sub}"`);
    }
    if (response.body.user.provider !== expectedProvider) {
      throw new Error(`Expected user.provider to be "${expectedProvider}" but got "${response.body.user.provider}"`);
    }
  }
};
