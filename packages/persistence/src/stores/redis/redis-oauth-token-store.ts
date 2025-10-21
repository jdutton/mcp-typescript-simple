/**
 * Redis OAuth Token Store
 *
 * Redis-based token storage for OAuth deployments.
 * Provides persistent token storage across serverless function invocations
 * and multi-instance deployments.
 *
 * Features:
 * - Automatic expiration using Redis TTL
 * - Scales across multiple instances
 * - O(1) refresh token lookups via secondary index
 * - No cleanup needed (Redis handles expiration)
 *
 * Setup:
 * Set REDIS_URL environment variable (e.g., redis://localhost:6379)
 */

import Redis from 'ioredis';
import { OAuthTokenStore } from '../../interfaces/oauth-token-store.js';
import { StoredTokenInfo } from '../../types.js';
import { logger } from '../../logger.js';

const KEY_PREFIX = 'oauth:token:';
const REFRESH_INDEX_PREFIX = 'oauth:refresh:';

export class RedisOAuthTokenStore implements OAuthTokenStore {
  private redis: Redis;

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL;
    if (!url) {
      throw new Error('Redis URL not configured. Set REDIS_URL environment variable.');
    }

    this.redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      lazyConnect: true,
    });

    this.redis.on('error', (error) => {
      logger.error('Redis connection error', { error });
    });

    this.redis.on('connect', () => {
      logger.info('Redis connected successfully for OAuth tokens');
    });

    // Connect immediately
    this.redis.connect().catch((error) => {
      logger.error('Failed to connect to Redis', { error });
    });

    logger.info('RedisOAuthTokenStore initialized', { url: this.maskUrl(url) });
  }

  /**
   * Mask Redis URL for logging (hide credentials)
   */
  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        parsed.password = '***';
      }
      return parsed.toString();
    } catch {
      return 'redis://***';
    }
  }

  private getTokenKey(accessToken: string): string {
    return `${KEY_PREFIX}${accessToken}`;
  }

  private getRefreshIndexKey(refreshToken: string): string {
    return `${REFRESH_INDEX_PREFIX}${refreshToken}`;
  }

  async storeToken(accessToken: string, tokenInfo: StoredTokenInfo): Promise<void> {
    const key = this.getTokenKey(accessToken);

    // Calculate TTL from expiresAt
    const now = Date.now();
    const ttlMs = tokenInfo.expiresAt - now;
    const ttlSeconds = Math.max(Math.floor(ttlMs / 1000), 1); // At least 1 second

    // Store token data and secondary index in parallel
    const storePromises = [
      this.redis.setex(key, ttlSeconds, JSON.stringify(tokenInfo))
    ];

    // Maintain secondary index for O(1) refresh token lookups
    if (tokenInfo.refreshToken) {
      const refreshIndexKey = this.getRefreshIndexKey(tokenInfo.refreshToken);
      storePromises.push(this.redis.setex(refreshIndexKey, ttlSeconds, accessToken));
    }

    await Promise.all(storePromises);

    logger.debug('OAuth token stored in Redis', {
      tokenPrefix: accessToken.substring(0, 8),
      provider: tokenInfo.provider,
      ttlSeconds,
      expiresAt: new Date(tokenInfo.expiresAt).toISOString()
    });
  }

  async getToken(accessToken: string): Promise<StoredTokenInfo | null> {
    const key = this.getTokenKey(accessToken);
    const data = await this.redis.get(key);

    if (!data) {
      logger.debug('OAuth token not found in Redis', {
        tokenPrefix: accessToken.substring(0, 8)
      });
      return null;
    }

    const tokenInfo = JSON.parse(data) as StoredTokenInfo;

    // Double-check expiration (Redis should have already handled this)
    if (tokenInfo.expiresAt && tokenInfo.expiresAt < Date.now()) {
      logger.warn('OAuth token expired (cleaning up)', {
        tokenPrefix: accessToken.substring(0, 8),
        expiredAt: new Date(tokenInfo.expiresAt).toISOString()
      });
      await this.deleteToken(accessToken);
      return null;
    }

    logger.debug('OAuth token retrieved from Redis', {
      tokenPrefix: accessToken.substring(0, 8),
      provider: tokenInfo.provider
    });

    return tokenInfo;
  }

  async findByRefreshToken(refreshToken: string): Promise<{ accessToken: string; tokenInfo: StoredTokenInfo } | null> {
    // O(1) lookup using secondary index
    const refreshIndexKey = this.getRefreshIndexKey(refreshToken);
    const accessToken = await this.redis.get(refreshIndexKey);

    if (!accessToken) {
      logger.debug('OAuth token not found by refresh token in Redis', {
        refreshTokenPrefix: refreshToken.substring(0, 8)
      });
      return null;
    }

    // Fetch token data
    const key = this.getTokenKey(accessToken);
    const data = await this.redis.get(key);

    if (!data) {
      // Clean up stale index entry
      await this.redis.del(refreshIndexKey);
      logger.debug('OAuth token not found by refresh token in Redis (stale index)', {
        refreshTokenPrefix: refreshToken.substring(0, 8)
      });
      return null;
    }

    const tokenInfo = JSON.parse(data) as StoredTokenInfo;

    // Verify not expired
    if (tokenInfo.expiresAt && tokenInfo.expiresAt < Date.now()) {
      logger.warn('OAuth token expired during refresh token lookup', {
        tokenPrefix: accessToken.substring(0, 8),
        expiredAt: new Date(tokenInfo.expiresAt).toISOString()
      });
      await this.deleteToken(accessToken);
      return null;
    }

    logger.debug('OAuth token found by refresh token in Redis', {
      tokenPrefix: accessToken.substring(0, 8),
      provider: tokenInfo.provider
    });

    return { accessToken, tokenInfo };
  }

  async deleteToken(accessToken: string): Promise<void> {
    const key = this.getTokenKey(accessToken);

    // Fetch token info to get refresh token for index cleanup
    const data = await this.redis.get(key);

    // Delete token and secondary index in parallel
    const deletePromises = [this.redis.del(key)];

    if (data) {
      const tokenInfo = JSON.parse(data) as StoredTokenInfo;
      if (tokenInfo.refreshToken) {
        const refreshIndexKey = this.getRefreshIndexKey(tokenInfo.refreshToken);
        deletePromises.push(this.redis.del(refreshIndexKey));
      }
    }

    await Promise.all(deletePromises);

    logger.debug('OAuth token deleted from Redis', {
      tokenPrefix: accessToken.substring(0, 8)
    });
  }

  async cleanup(): Promise<number> {
    // No cleanup needed - Redis automatically expires keys
    logger.debug('OAuth token cleanup skipped (Redis auto-expiration enabled)');
    return 0;
  }

  async getTokenCount(): Promise<number> {
    // Scan for all keys with our prefix
    let cursor = '0';
    let count = 0;

    do {
      const result = await this.redis.scan(cursor, 'MATCH', `${KEY_PREFIX}*`, 'COUNT', 100);
      cursor = result[0];
      count += result[1].length;
    } while (cursor !== '0');

    return count;
  }

  dispose(): void {
    this.redis.disconnect();
    logger.info('RedisOAuthTokenStore disposed');
  }
}
