/**
 * Redis Initial Access Token Store
 *
 * Redis-compatible token storage for DCR (Dynamic Client Registration).
 *
 * Features:
 * - Works with any Redis deployment (no vendor lock-in)
 * - Automatic TTL support for token expiration
 * - Multi-instance deployment support
 * - Scales to millions of tokens
 *
 * Setup:
 * Set REDIS_URL environment variable (e.g., redis://localhost:6379)
 */

import Redis from 'ioredis';
import { randomBytes, randomUUID } from 'crypto';
import {
  InitialAccessTokenStore,
  InitialAccessToken,
  CreateTokenOptions,
  TokenValidationResult,
  validateTokenCommon,
} from './token-store-interface.js';
import { logger } from '../../utils/logger.js';

/**
 * Redis key prefixes for namespacing
 */
const KEY_PREFIX = 'dcr:token:';
const VALUE_PREFIX = 'dcr:value:';
const INDEX_KEY = 'dcr:tokens:all';

export class RedisTokenStore implements InitialAccessTokenStore {
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
      logger.info('Redis connected successfully for DCR tokens');
    });

    // Connect immediately
    this.redis.connect().catch((error) => {
      logger.error('Failed to connect to Redis', { error });
    });

    logger.info('RedisTokenStore initialized', { url: this.maskUrl(url) });
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

  /**
   * Generate Redis key for token ID
   */
  private getTokenKey(id: string): string {
    return `${KEY_PREFIX}${id}`;
  }

  /**
   * Generate Redis key for token value lookup
   */
  private getValueKey(token: string): string {
    return `${VALUE_PREFIX}${token}`;
  }

  async createToken(options: CreateTokenOptions): Promise<InitialAccessToken> {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const now = Math.floor(Date.now() / 1000);

    const tokenData: InitialAccessToken = {
      id,
      token,
      description: options.description,
      created_at: now,
      expires_at: options.expires_in ? now + options.expires_in : 0,
      usage_count: 0,
      max_uses: options.max_uses,
      revoked: false,
    };

    // Store token data by ID
    const tokenKey = this.getTokenKey(id);
    const valueKey = this.getValueKey(token);

    // Calculate TTL (if expiration is set)
    const ttlSeconds = tokenData.expires_at > 0 ? tokenData.expires_at - now : undefined;

    // Store token metadata
    if (ttlSeconds) {
      await this.redis.setex(tokenKey, ttlSeconds, JSON.stringify(tokenData));
      await this.redis.setex(valueKey, ttlSeconds, id);
    } else {
      await this.redis.set(tokenKey, JSON.stringify(tokenData));
      await this.redis.set(valueKey, id);
    }

    // Add to index (for listing)
    await this.redis.sadd(INDEX_KEY, id);

    logger.info('Initial access token created in Redis', {
      tokenId: id,
      description: options.description,
      expiresAt: tokenData.expires_at === 0 ? 'never' : new Date(tokenData.expires_at * 1000).toISOString(),
      maxUses: options.max_uses || 'unlimited',
      ttl: ttlSeconds ? `${ttlSeconds}s` : 'none',
    });

    return tokenData;
  }

  async validateAndUseToken(token: string): Promise<TokenValidationResult> {
    // Look up token ID from value
    const valueKey = this.getValueKey(token);
    const id = await this.redis.get(valueKey);

    if (!id) {
      logger.warn('Token validation failed: token not found', { token: token.substring(0, 8) + '...' });
      return {
        valid: false,
        reason: 'Token not found',
      };
    }

    // Get token data
    const tokenKey = this.getTokenKey(id);
    const tokenJson = await this.redis.get(tokenKey);

    if (!tokenJson) {
      logger.warn('Token validation failed: token data not found', { tokenId: id });
      return {
        valid: false,
        reason: 'Token not found',
      };
    }

    const tokenData: InitialAccessToken = JSON.parse(tokenJson);

    // Use common validation logic
    const result = validateTokenCommon(tokenData, token);

    if (result.valid && result.token) {
      // Increment usage count and update last_used_at
      result.token.usage_count++;
      result.token.last_used_at = Math.floor(Date.now() / 1000);

      // Update token in Redis
      await this.redis.set(tokenKey, JSON.stringify(result.token));

      logger.info('Token validated and used', {
        tokenId: result.token.id,
        usageCount: result.token.usage_count,
        maxUses: result.token.max_uses || 'unlimited',
      });
    }

    return result;
  }

  async getToken(id: string): Promise<InitialAccessToken | undefined> {
    const tokenKey = this.getTokenKey(id);
    const tokenJson = await this.redis.get(tokenKey);

    if (!tokenJson) {
      return undefined;
    }

    return JSON.parse(tokenJson);
  }

  async getTokenByValue(token: string): Promise<InitialAccessToken | undefined> {
    const valueKey = this.getValueKey(token);
    const id = await this.redis.get(valueKey);

    if (!id) {
      return undefined;
    }

    return this.getToken(id);
  }

  async listTokens(options?: {
    includeRevoked?: boolean;
    includeExpired?: boolean;
  }): Promise<InitialAccessToken[]> {
    // Get all token IDs from index
    const ids = await this.redis.smembers(INDEX_KEY);

    if (ids.length === 0) {
      return [];
    }

    // Fetch all tokens in parallel
    const tokenPromises = ids.map((id) => this.getToken(id));
    const tokens = (await Promise.all(tokenPromises)).filter((t): t is InitialAccessToken => t !== undefined);

    const now = Math.floor(Date.now() / 1000);

    return tokens.filter((token) => {
      // Filter revoked tokens
      if (token.revoked && !options?.includeRevoked) {
        return false;
      }

      // Filter expired tokens
      if (token.expires_at > 0 && token.expires_at < now && !options?.includeExpired) {
        return false;
      }

      return true;
    });
  }

  async revokeToken(id: string): Promise<boolean> {
    const token = await this.getToken(id);
    if (!token) {
      return false;
    }

    token.revoked = true;

    const tokenKey = this.getTokenKey(id);
    await this.redis.set(tokenKey, JSON.stringify(token));

    logger.info('Token revoked', { tokenId: id });
    return true;
  }

  async deleteToken(id: string): Promise<boolean> {
    const token = await this.getToken(id);
    if (!token) {
      return false;
    }

    const tokenKey = this.getTokenKey(id);
    const valueKey = this.getValueKey(token.token);

    // Delete from Redis
    await this.redis.del(tokenKey);
    await this.redis.del(valueKey);

    // Remove from index
    await this.redis.srem(INDEX_KEY, id);

    logger.info('Token deleted', { tokenId: id });
    return true;
  }

  async cleanup(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    let cleaned = 0;

    const tokens = await this.listTokens({ includeRevoked: true, includeExpired: true });

    for (const token of tokens) {
      let shouldDelete = false;

      // Remove expired tokens
      if (token.expires_at > 0 && token.expires_at < now) {
        shouldDelete = true;
      }

      // Remove revoked tokens
      if (token.revoked) {
        shouldDelete = true;
      }

      // Remove tokens that have exceeded max uses
      if (token.max_uses && token.max_uses > 0 && token.usage_count >= token.max_uses) {
        shouldDelete = true;
      }

      if (shouldDelete) {
        await this.deleteToken(token.id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info('Token cleanup completed', { cleanedCount: cleaned });
    }

    return cleaned;
  }

  async dispose(): Promise<void> {
    this.redis.disconnect();
    logger.info('RedisTokenStore disposed');
  }
}
