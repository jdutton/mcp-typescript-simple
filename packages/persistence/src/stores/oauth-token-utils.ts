/**
 * Shared utilities for OAuth token stores
 *
 * Extracts common business logic used across memory, file, and Redis implementations
 * to eliminate code duplication while maintaining consistent behavior.
 */

import { logger } from '../logger.js';
import type { StoredTokenInfo } from '../types.js';

/**
 * Check if a token is expired
 *
 * @param tokenInfo - Token information to check
 * @param accessToken - Access token (for logging)
 * @returns true if expired, false otherwise
 */
export function isTokenExpired(tokenInfo: StoredTokenInfo, accessToken: string): boolean {
  if (!tokenInfo.expiresAt) {
    return false;
  }

  const now = Date.now();
  if (tokenInfo.expiresAt < now) {
    logger.warn('OAuth token expired', {
      tokenPrefix: accessToken.substring(0, 8),
      expiredAt: new Date(tokenInfo.expiresAt).toISOString(),
      provider: tokenInfo.provider
    });
    return true;
  }

  return false;
}

/**
 * Log token retrieval for debugging
 *
 * @param accessToken - Access token being retrieved
 * @param tokenInfo - Token information
 * @param context - Additional context for logging
 */
export function logTokenRetrieved(accessToken: string, tokenInfo: StoredTokenInfo, context?: string): void {
  const message = 'OAuth token retrieved' + (context ? ` ${context}` : '');
  logger.debug(message, {
    tokenPrefix: accessToken.substring(0, 8),
    provider: tokenInfo.provider
  });
}

/**
 * Log token not found for debugging
 *
 * @param identifier - Token identifier (access token or refresh token)
 * @param type - Type of lookup ('access' or 'refresh')
 * @param reason - Optional reason for not found
 */
export function logTokenNotFound(identifier: string, type: 'access' | 'refresh' = 'access', reason?: string): void {
  const prefix = type === 'refresh' ? 'refreshTokenPrefix' : 'tokenPrefix';
  const message = 'OAuth token not found' + (reason ? ` (${reason})` : '');
  logger.debug(message, {
    [prefix]: identifier.substring(0, 8)
  });
}

/**
 * Log token deletion for debugging
 *
 * @param accessToken - Access token being deleted
 * @param existed - Whether the token existed before deletion
 */
export function logTokenDeleted(accessToken: string, existed: boolean): void {
  if (existed) {
    logger.debug('OAuth token deleted', {
      tokenPrefix: accessToken.substring(0, 8)
    });
  }
}

/**
 * Validate and handle token expiration during retrieval
 *
 * Returns null if token is expired, otherwise returns the token info.
 * Automatically calls deleteCallback if token is expired.
 *
 * @param tokenInfo - Token information to validate
 * @param accessToken - Access token
 * @param deleteCallback - Async callback to delete the expired token
 * @returns Token info if valid, null if expired
 */
export async function validateTokenExpiry(
  tokenInfo: StoredTokenInfo,
  accessToken: string,
  deleteCallback: () => Promise<void>
): Promise<StoredTokenInfo | null> {
  if (isTokenExpired(tokenInfo, accessToken)) {
    await deleteCallback();
    return null;
  }
  return tokenInfo;
}
