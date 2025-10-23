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

import { OAuthTokenStore } from '../../interfaces/oauth-token-store.js';
import { StoredTokenInfo } from '../../types.js';
import { logger } from '../../logger.js';

export class MemoryOAuthTokenStore implements OAuthTokenStore {
  private tokens = new Map<string, StoredTokenInfo>();
  private refreshTokenIndex = new Map<string, string>(); // refreshToken -> accessToken
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    logger.info('MemoryOAuthTokenStore initialized');

    // Start automatic cleanup of expired tokens every hour
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 60 * 1000);
    if (typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }
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

  async getToken(accessToken: string): Promise<StoredTokenInfo | null> {
    const tokenInfo = this.tokens.get(accessToken);

    if (!tokenInfo) {
      logger.debug('OAuth token not found', {
        tokenPrefix: accessToken.substring(0, 8)
      });
      return null;
    }

    // Verify not expired
    if (tokenInfo.expiresAt && tokenInfo.expiresAt < Date.now()) {
      logger.warn('OAuth token expired', {
        tokenPrefix: accessToken.substring(0, 8),
        expiredAt: new Date(tokenInfo.expiresAt).toISOString()
      });
      await this.deleteToken(accessToken);
      return null;
    }

    logger.debug('OAuth token retrieved', {
      tokenPrefix: accessToken.substring(0, 8),
      provider: tokenInfo.provider
    });

    return tokenInfo;
  }

  async findByRefreshToken(refreshToken: string): Promise<{ accessToken: string; tokenInfo: StoredTokenInfo } | null> {
    // O(1) lookup using secondary index
    const accessToken = this.refreshTokenIndex.get(refreshToken);

    if (!accessToken) {
      logger.debug('OAuth token not found by refresh token', {
        refreshTokenPrefix: refreshToken.substring(0, 8)
      });
      return null;
    }

    const tokenInfo = this.tokens.get(accessToken);

    if (!tokenInfo) {
      // Clean up stale index entry
      this.refreshTokenIndex.delete(refreshToken);
      logger.debug('OAuth token not found by refresh token (stale index)', {
        refreshTokenPrefix: refreshToken.substring(0, 8)
      });
      return null;
    }

    // Verify not expired
    if (tokenInfo.expiresAt && tokenInfo.expiresAt < Date.now()) {
      logger.warn('OAuth token expired during refresh token lookup', {
        tokenPrefix: accessToken.substring(0, 8),
        expiredAt: new Date(tokenInfo.expiresAt).toISOString()
      });
      await this.deleteToken(accessToken);
      return null;
    }

    logger.debug('OAuth token found by refresh token', {
      tokenPrefix: accessToken.substring(0, 8),
      provider: tokenInfo.provider
    });

    return { accessToken, tokenInfo };
  }

  async deleteToken(accessToken: string): Promise<void> {
    const tokenInfo = this.tokens.get(accessToken);
    const existed = this.tokens.delete(accessToken);

    // Clean up secondary index
    if (tokenInfo?.refreshToken) {
      this.refreshTokenIndex.delete(tokenInfo.refreshToken);
    }

    if (existed) {
      logger.debug('OAuth token deleted', {
        tokenPrefix: accessToken.substring(0, 8)
      });
    }
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [accessToken, tokenInfo] of this.tokens.entries()) {
      if (tokenInfo.expiresAt && tokenInfo.expiresAt <= now) {
        this.tokens.delete(accessToken);
        // Clean up secondary index
        if (tokenInfo.refreshToken) {
          this.refreshTokenIndex.delete(tokenInfo.refreshToken);
        }
        cleanedCount++;
        logger.debug('Expired OAuth token cleaned up', {
          tokenPrefix: accessToken.substring(0, 8),
          provider: tokenInfo.provider,
          expiredAt: new Date(tokenInfo.expiresAt).toISOString()
        });
      }
    }

    if (cleanedCount > 0) {
      logger.info('Expired OAuth tokens cleanup completed', {
        cleanedCount,
        remainingCount: this.tokens.size
      });
    }

    return cleanedCount;
  }

  async getTokenCount(): Promise<number> {
    return this.tokens.size;
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
