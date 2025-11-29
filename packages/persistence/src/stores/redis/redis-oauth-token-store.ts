/**
 * Redis OAuth Token Store
 *
 * Redis-based token storage for OAuth deployments with AES-256-GCM encryption at rest.
 * Provides persistent token storage across serverless function invocations
 * and multi-instance deployments.
 *
 * Features:
 * - AES-256-GCM encryption at rest (REQUIRED - zero tolerance for unencrypted data)
 * - SHA-256 hashed Redis keys (prevents token exposure in key names)
 * - Automatic expiration using Redis TTL
 * - Scales across multiple instances
 * - O(1) refresh token lookups via secondary index
 * - No cleanup needed (Redis handles expiration)
 *
 * Security Stance:
 * - Encryption is MANDATORY, not optional
 * - Redis keys are SHA-256 hashed to prevent token exposure
 *   (even read-only Redis access won't expose usable tokens)
 * - Fail fast on decryption errors - no graceful degradation
 * - SOC-2, ISO 27001, GDPR, HIPAA compliant
 *
 * Setup:
 * Set REDIS_URL environment variable (e.g., redis://localhost:6379)
 * TokenEncryptionService MUST be provided to constructor
 */

import { Redis } from 'ioredis';
import { OAuthTokenStore, serializeOAuthToken, deserializeOAuthToken } from '../../interfaces/oauth-token-store.js';
import { StoredTokenInfo } from '../../types.js';
import { logger } from '../../logger.js';
import { TokenEncryptionService } from '../../encryption/token-encryption-service.js';
import { maskRedisUrl, createRedisClient, normalizeKeyPrefix } from './redis-utils.js';

export class RedisOAuthTokenStore implements OAuthTokenStore {
  private redis: Redis;
  private readonly encryptionService: TokenEncryptionService;
  private readonly KEY_PREFIX: string;
  private readonly REFRESH_INDEX_PREFIX: string;

  constructor(redisUrl: string, encryptionService: TokenEncryptionService, keyPrefix: string = '') {
    // Enterprise security: encryption is MANDATORY
    if (!encryptionService) {
      throw new Error('TokenEncryptionService is REQUIRED. Encryption at rest is mandatory for SOC-2, ISO 27001, GDPR, HIPAA compliance.');
    }

    this.encryptionService = encryptionService;
    this.redis = createRedisClient(redisUrl, 'OAuth tokens');

    // Normalize key prefix (adds trailing colon if needed)
    const normalized = normalizeKeyPrefix(keyPrefix);
    this.KEY_PREFIX = `${normalized}oauth:token:`;
    this.REFRESH_INDEX_PREFIX = `${normalized}oauth:refresh:`;

    const url = redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
    logger.info('RedisOAuthTokenStore initialized', { url: maskRedisUrl(url), keyPrefix: this.KEY_PREFIX });
  }

  /**
   * Get Redis key for access token (SHA-256 hashed)
   *
   * SECURITY: Hash tokens before using as Redis keys to prevent exposure.
   * Even though VALUES are encrypted, KEY NAMES are visible in Redis.
   * Read-only Redis access would expose usable tokens without hashing.
   */
  private getTokenKey(accessToken: string): string {
    const hashedToken = this.encryptionService.hashKey(accessToken);
    return `${this.KEY_PREFIX}${hashedToken}`;
  }

  /**
   * Get Redis key for refresh token index (SHA-256 hashed)
   *
   * SECURITY: Hash tokens before using as Redis keys to prevent exposure.
   * Refresh tokens have longer validity, so exposure is especially risky.
   */
  private getRefreshIndexKey(refreshToken: string): string {
    const hashedToken = this.encryptionService.hashKey(refreshToken);
    return `${this.REFRESH_INDEX_PREFIX}${hashedToken}`;
  }

  async storeToken(accessToken: string, tokenInfo: StoredTokenInfo): Promise<void> {
    const key = this.getTokenKey(accessToken);

    // Calculate TTL from expiresAt
    const now = Date.now();
    const ttlMs = tokenInfo.expiresAt - now;
    const ttlSeconds = Math.max(Math.floor(ttlMs / 1000), 1); // At least 1 second

    // Encrypt token data before storing
    const encryptedData = serializeOAuthToken(tokenInfo, this.encryptionService);

    // Store encrypted token data and secondary index in parallel
    const storePromises = [
      this.redis.setex(key, ttlSeconds, encryptedData)
    ];

    // Maintain secondary index for O(1) refresh token lookups
    // CRITICAL: Encrypt access token before storing in index
    if (tokenInfo.refreshToken) {
      const refreshIndexKey = this.getRefreshIndexKey(tokenInfo.refreshToken);
      const encryptedAccessToken = this.encryptionService.encrypt(accessToken);
      storePromises.push(this.redis.setex(refreshIndexKey, ttlSeconds, encryptedAccessToken));
    }

    await Promise.all(storePromises);

    logger.debug('OAuth token stored in Redis (encrypted)', {
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

    // Decrypt and deserialize token data - fail fast on decryption errors
    const tokenInfo = deserializeOAuthToken<StoredTokenInfo>(data, this.encryptionService);

    // Double-check expiration (Redis should have already handled this)
    if (tokenInfo.expiresAt && tokenInfo.expiresAt < Date.now()) {
      logger.warn('OAuth token expired (cleaning up)', {
        tokenPrefix: accessToken.substring(0, 8),
        expiredAt: new Date(tokenInfo.expiresAt).toISOString()
      });
      await this.deleteToken(accessToken);
      return null;
    }

    logger.debug('OAuth token retrieved from Redis (decrypted)', {
      tokenPrefix: accessToken.substring(0, 8),
      provider: tokenInfo.provider
    });

    return tokenInfo;
  }

  async findByRefreshToken(refreshToken: string): Promise<{ accessToken: string; tokenInfo: StoredTokenInfo } | null> {
    // O(1) lookup using secondary index
    const refreshIndexKey = this.getRefreshIndexKey(refreshToken);
    const encryptedAccessToken = await this.redis.get(refreshIndexKey);

    if (!encryptedAccessToken) {
      logger.debug('OAuth token not found by refresh token in Redis', {
        refreshTokenPrefix: refreshToken.substring(0, 8)
      });
      return null;
    }

    // Decrypt access token from index - fail fast on decryption errors
    const accessToken = this.encryptionService.decrypt(encryptedAccessToken);

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

    // Decrypt and deserialize token data - fail fast on decryption errors
    const tokenInfo = deserializeOAuthToken<StoredTokenInfo>(data, this.encryptionService);

    // Verify not expired
    if (tokenInfo.expiresAt && tokenInfo.expiresAt < Date.now()) {
      logger.warn('OAuth token expired during refresh token lookup', {
        tokenPrefix: accessToken.substring(0, 8),
        expiredAt: new Date(tokenInfo.expiresAt).toISOString()
      });
      await this.deleteToken(accessToken);
      return null;
    }

    logger.debug('OAuth token found by refresh token in Redis (decrypted)', {
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
      // Decrypt and deserialize to get refresh token for index cleanup
      const tokenInfo = deserializeOAuthToken<StoredTokenInfo>(data, this.encryptionService);
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
      const result = await this.redis.scan(cursor, 'MATCH', `${this.KEY_PREFIX}*`, 'COUNT', 100);
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
