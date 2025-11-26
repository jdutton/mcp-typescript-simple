/**
 * Shared OAuth helpers and utilities
 *
 * Provides common functionality used by both Express and Vercel OAuth implementations
 */

/**
 * Request/Response adapter interface for cross-platform OAuth handlers
 *
 * Abstracts the differences between Express and Vercel request/response types
 * while providing a minimal, type-safe interface for OAuth operations.
 */
export interface OAuthRequestAdapter {
  method?: string;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  url?: string;
}

export interface OAuthResponseAdapter {
  status(code: number): OAuthResponseAdapter;
  json(data: Record<string, unknown>): void | OAuthResponseAdapter;
  setHeader(name: string, value: string): void | OAuthResponseAdapter;
  redirect?(code: number, url: string): void;
  send?(data: Record<string, unknown>): void;
  headersSent?: boolean;
}

/**
 * Set anti-caching headers for OAuth endpoints (RFC 6749, RFC 9700)
 *
 * These headers prevent caching of OAuth responses which may contain
 * sensitive authentication data or state information.
 *
 * @param res - Response object (Express or Vercel)
 */
export function setOAuthAntiCachingHeaders(res: OAuthResponseAdapter): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

/**
 * Create standardized OAuth error response
 *
 * @param code - HTTP status code
 * @param error - OAuth error type (e.g., 'invalid_grant', 'unsupported_grant_type')
 * @param description - Human-readable error description
 * @returns OAuth error response object
 */
export function createOAuthErrorResponse(
  code: number,
  error: string,
  description: string
): { statusCode: number; body: Record<string, string> } {
  return {
    statusCode: code,
    body: {
      error,
      error_description: description,
      timestamp: new Date().toISOString()
    }
  };
}

/**
 * Send OAuth error response
 *
 * @param res - Response object
 * @param code - HTTP status code
 * @param error - OAuth error type
 * @param description - Error description
 */
export function sendOAuthError(
  res: OAuthResponseAdapter,
  code: number,
  error: string,
  description: string
): void {
  setOAuthAntiCachingHeaders(res);
  res.status(code).json({
    error,
    error_description: description,
    timestamp: new Date().toISOString()
  });
}

/**
 * Send OAuth success response
 *
 * @param res - Response object
 * @param data - Response data
 */
export function sendOAuthSuccess(
  res: OAuthResponseAdapter,
  data: Record<string, unknown>
): void {
  setOAuthAntiCachingHeaders(res);
  res.status(200).json(data);
}
