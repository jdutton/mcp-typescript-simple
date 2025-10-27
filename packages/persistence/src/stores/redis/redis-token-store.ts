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
 * - AES-256-GCM encryption at rest (SOC-2, ISO 27001, GDPR, HIPAA compliant)
 * - SHA-256 hashed Redis keys (prevents token exposure in key names)
 *
 * Security (Hard Security Stance):
 * - All token data MUST be encrypted at rest with AES-256-GCM
 * - Redis keys are SHA-256 hashed to prevent token exposure
 *   (even read-only Redis access won't expose usable tokens)
 * - Encryption service is REQUIRED (constructor parameter)
 * - NO backward compatibility with plaintext tokens (fail fast)
 * - Cryptographically secure IVs and authentication tags
 * - Zero tolerance for unencrypted data
 *
 * Setup:
 * Set REDIS_URL environment variable (e.g., redis://localhost:6379)
 * Set TOKEN_ENCRYPTION_KEY environment variable (32-byte base64 string)
 */

import Redis from 'ioredis';
import {
  InitialAccessTokenStore,
  InitialAccessToken,
  CreateTokenOptions,
  TokenValidationResult,
  validateTokenCommon,
  filterTokens,
  shouldCleanupToken,
  createTokenData,
} from '../../interfaces/token-store.js';
import { logger } from '../../logger.js';
import { TokenEncryptionService } from '../../encryption/token-encryption-service.js';
import { maskRedisUrl, createRedisClient } from './redis-utils.js';

/**
 * Redis key prefixes for namespacing
 */
const KEY_PREFIX = 'dcr:token:';
const VALUE_PREFIX = 'dcr:value:';
const INDEX_KEY = 'dcr:tokens:all';

export class RedisTokenStore implements InitialAccessTokenStore {
  private redis: Redis;
  private readonly encryptionService: TokenEncryptionService;

  constructor(redisUrl: string | undefined, encryptionService: TokenEncryptionService) {
    const url = redisUrl || process.env.REDIS_URL;
    if (!url) {
      throw new Error('Redis URL not configured. Set REDIS_URL environment variable.');
    }

    if (!encryptionService) {
      throw new Error('Encryption service is required for RedisTokenStore. Token encryption is mandatory.');
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

    // Store encryption service (REQUIRED - hard security stance)
    this.encryptionService = encryptionService;

    logger.info('RedisTokenStore initialized', {
      url: maskRedisUrl(url),
      encryption: 'enabled (required)'
    });
  }

  /**
   * Serialize and encrypt token data for storage
   *
   * Security: All tokens MUST be encrypted at rest (AES-256-GCM)
   */
  private serializeTokenData(tokenData: InitialAccessToken): string {
    const json = JSON.stringify(tokenData);
    return this.encryptionService.encrypt(json);
  }

  /**
   * Deserialize and decrypt token data from storage
   *
   * Security: All tokens MUST be encrypted - fail fast if decryption fails.
   * No backward compatibility with plaintext tokens.
   */
  private deserializeTokenData(data: string): InitialAccessToken {
    try {
      const json = this.encryptionService.decrypt(data);
      return JSON.parse(json);
    } catch (error) {
      // Fail fast - no plaintext fallback for security
      throw new Error(
        `Failed to decrypt token data. All tokens must be encrypted. Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Generate Redis key for token ID
   *
   * NOTE: IDs are UUIDs (not sensitive), but we hash for consistency
   */
  private getTokenKey(id: string): string {
    return `${KEY_PREFIX}${id}`;
  }

  /**
   * Generate Redis key for token value lookup (SHA-256 hashed)
   *
   * SECURITY: Hash tokens before using as Redis keys to prevent exposure.
   * Even though VALUES are encrypted, KEY NAMES are visible in Redis.
   * Read-only Redis access would expose usable tokens without hashing.
   */
  private getValueKey(token: string): string {
    const hashedToken = this.encryptionService.hashKey(token);
    return `${VALUE_PREFIX}${hashedToken}`;
  }

  async createToken(options: CreateTokenOptions): Promise<InitialAccessToken> {
    const tokenData = createTokenData(options);
    const now = Math.floor(Date.now() / 1000);

    // Store token data by ID
    const tokenKey = this.getTokenKey(tokenData.id);
    const valueKey = this.getValueKey(tokenData.token);

    // Calculate TTL (if expiration is set)
    const ttlSeconds = tokenData.expires_at > 0 ? tokenData.expires_at - now : undefined;

    // Serialize (and optionally encrypt) token data
    const serializedData = this.serializeTokenData(tokenData);

    // Store token metadata
    if (ttlSeconds) {
      await this.redis.setex(tokenKey, ttlSeconds, serializedData);
      await this.redis.setex(valueKey, ttlSeconds, tokenData.id);
    } else {
      await this.redis.set(tokenKey, serializedData);
      await this.redis.set(valueKey, tokenData.id);
    }

    // Add to index (for listing)
    await this.redis.sadd(INDEX_KEY, tokenData.id);

    logger.info('Initial access token created in Redis', {
      tokenId: tokenData.id,
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

    // Deserialize (and optionally decrypt) token data
    const tokenData: InitialAccessToken = this.deserializeTokenData(tokenJson);

    // Use common validation logic
    const result = validateTokenCommon(tokenData, token);

    if (result.valid && result.token) {
      // Increment usage count and update last_used_at
      result.token.usage_count++;
      result.token.last_used_at = Math.floor(Date.now() / 1000);

      // Serialize (and optionally encrypt) updated token data
      const updatedData = this.serializeTokenData(result.token);

      // Update token in Redis
      await this.redis.set(tokenKey, updatedData);

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

    // Deserialize (and optionally decrypt) token data
    return this.deserializeTokenData(tokenJson);
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

    return filterTokens(tokens, options);
  }

  async revokeToken(id: string): Promise<boolean> {
    const token = await this.getToken(id);
    if (!token) {
      return false;
    }

    token.revoked = true;

    const tokenKey = this.getTokenKey(id);
    // Serialize (and optionally encrypt) updated token data
    const serializedData = this.serializeTokenData(token);
    await this.redis.set(tokenKey, serializedData);

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
      if (shouldCleanupToken(token, now)) {
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
