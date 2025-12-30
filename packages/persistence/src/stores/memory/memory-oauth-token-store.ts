/**
 * In-Memory OAuth Token Store
 *
 * Simple Map-based storage for OAuth tokens. Suitable for:
 * - Development and testing
 * - Single-instance deployments
 * - Scenarios where token persistence across restarts is not required
 *
 * WARNING: All tokens are lost on server restart!
 * WARNING: Does NOT work across multiple serverless instances!
 */

import { BaseOAuthTokenStore } from '../base-oauth-token-store.js';
import { StoredTokenInfo } from '../../types.js';
import { logger } from '../../logger.js';
import { isTokenExpired } from '../oauth-token-utils.js';

export class MemoryOAuthTokenStore extends BaseOAuthTokenStore {
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    super();
    logger.info('MemoryOAuthTokenStore initialized');

    // Start automatic cleanup of expired tokens every hour
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 60 * 1000);
    if (typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Override expiry check to use shared utility
   */
  protected override isExpired(tokenInfo: StoredTokenInfo): boolean {
    // Use the accessToken placeholder since isTokenExpired only logs it
    return isTokenExpired(tokenInfo, '[checking]');
  }

  async storeToken(accessToken: string, tokenInfo: StoredTokenInfo): Promise<void> {
    this.tokens.set(accessToken, tokenInfo);

    // Maintain secondary index for O(1) refresh token lookups
    if (tokenInfo.refreshToken) {
      this.refreshTokenIndex.set(tokenInfo.refreshToken, accessToken);
    }

    logger.debug('OAuth token stored', {
      tokenPrefix: accessToken.substring(0, 8),
      provider: tokenInfo.provider,
      expiresAt: new Date(tokenInfo.expiresAt).toISOString(),
      userEmail: tokenInfo.userInfo.email
    });
  }

  /**
   * Clear all tokens (testing only)
   */
  clear(): void {
    const count = this.tokens.size;
    this.tokens.clear();
    this.refreshTokenIndex.clear();
    logger.warn('All OAuth tokens cleared', { count });
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.tokens.clear();
    this.refreshTokenIndex.clear();
    logger.info('MemoryOAuthTokenStore disposed');
  }
}
