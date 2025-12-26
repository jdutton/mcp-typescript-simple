/**
 * Shared test helpers for OAuth provider tests
 *
 * This file contains common mock utilities and helper functions used across
 * provider test files to reduce code duplication.
 */

import { vi } from 'vitest';
import type { Response } from 'express';

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
