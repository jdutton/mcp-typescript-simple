/**
 * Base OAuth Token Store
 *
 * Abstract base class providing shared implementation for OAuth token stores.
 * Eliminates duplication between FileOAuthTokenStore, MemoryOAuthTokenStore,
 * and RedisOAuthTokenStore.
 *
 * Subclasses must implement:
 * - Storage-specific mutation hooks (onTokenMutated)
 * - Token expiry checking logic (isExpired)
 */

import { OAuthTokenStore } from '../interfaces/oauth-token-store.js';
import { StoredTokenInfo } from '../types.js';
import { logger } from '../logger.js';
import {
  logTokenNotFound,
  logTokenRetrieved,
  logTokenDeleted,
  validateTokenExpiry,
} from './oauth-token-utils.js';

/**
 * Abstract base class for OAuth token stores
 */
export abstract class BaseOAuthTokenStore implements OAuthTokenStore {
  protected tokens = new Map<string, StoredTokenInfo>();
  protected refreshTokenIndex = new Map<string, string>(); // refreshToken -> accessToken

  /**
   * Hook called after token mutation (store, delete)
   * Subclasses can override to implement persistence (e.g., scheduleSave())
   */
  protected onTokenMutated(): void {
    // Default: no-op
  }

  /**
   * Check if token is expired
   * Subclasses can override for custom expiry logic
   */
  protected isExpired(tokenInfo: StoredTokenInfo): boolean {
    return tokenInfo.expiresAt ? tokenInfo.expiresAt <= Date.now() : false;
  }

  abstract storeToken(_accessToken: string, _tokenInfo: StoredTokenInfo): Promise<void>;

  async getToken(accessToken: string): Promise<StoredTokenInfo | null> {
    const tokenInfo = this.tokens.get(accessToken);

    if (!tokenInfo) {
      logTokenNotFound(accessToken, 'access');
      return null;
    }

    // Verify not expired using shared utility
    const validatedToken = await validateTokenExpiry(
      tokenInfo,
      accessToken,
      async () => this.deleteToken(accessToken)
    );

    if (!validatedToken) {
      return null;
    }

    logTokenRetrieved(accessToken, validatedToken);
    return validatedToken;
  }

  async findByRefreshToken(
    refreshToken: string
  ): Promise<{ accessToken: string; tokenInfo: StoredTokenInfo } | null> {
    // O(1) lookup using secondary index
    const accessToken = this.refreshTokenIndex.get(refreshToken);

    if (!accessToken) {
      logTokenNotFound(refreshToken, 'refresh');
      return null;
    }

    const tokenInfo = this.tokens.get(accessToken);

    if (!tokenInfo) {
      // Clean up stale index entry
      this.refreshTokenIndex.delete(refreshToken);
      this.onTokenMutated();
      logTokenNotFound(refreshToken, 'refresh', 'stale index');
      return null;
    }

    // Verify not expired using shared utility
    const validatedToken = await validateTokenExpiry(
      tokenInfo,
      accessToken,
      async () => this.deleteToken(accessToken)
    );

    if (!validatedToken) {
      return null;
    }

    logTokenRetrieved(accessToken, validatedToken, 'by refresh token');
    return { accessToken, tokenInfo: validatedToken };
  }

  async deleteToken(accessToken: string): Promise<void> {
    const tokenInfo = this.tokens.get(accessToken);
    const existed = this.tokens.delete(accessToken);

    // Clean up secondary index
    if (tokenInfo?.refreshToken) {
      this.refreshTokenIndex.delete(tokenInfo.refreshToken);
    }

    if (existed) {
      this.onTokenMutated();
    }

    logTokenDeleted(accessToken, existed);
  }

  async cleanup(): Promise<number> {
    let cleanedCount = 0;

    for (const [accessToken, tokenInfo] of this.tokens.entries()) {
      if (this.isExpired(tokenInfo)) {
        this.tokens.delete(accessToken);
        // Clean up secondary index
        if (tokenInfo.refreshToken) {
          this.refreshTokenIndex.delete(tokenInfo.refreshToken);
        }
        cleanedCount++;
        logger.debug('Expired OAuth token cleaned up', {
          tokenPrefix: accessToken.substring(0, 8),
          provider: tokenInfo.provider,
          expiredAt: new Date(tokenInfo.expiresAt ?? Date.now()).toISOString(),
        });
      }
    }

    if (cleanedCount > 0) {
      this.onTokenMutated();
      logger.info('Expired OAuth tokens cleanup completed', {
        cleanedCount,
        remainingCount: this.tokens.size,
      });
    }

    return cleanedCount;
  }

  async getTokenCount(): Promise<number> {
    return this.tokens.size;
  }

  abstract dispose(): void;
}
