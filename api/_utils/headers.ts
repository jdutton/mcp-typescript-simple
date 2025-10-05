/**
 * Shared header utilities for Vercel serverless functions
 */

import { VercelResponse } from '@vercel/node';

/**
 * Set anti-caching headers for OAuth endpoints (RFC 6749, RFC 9700)
 * Prevents Vercel edge cache from serving stale OAuth responses
 */
export function setOAuthAntiCachingHeaders(res: VercelResponse): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}
