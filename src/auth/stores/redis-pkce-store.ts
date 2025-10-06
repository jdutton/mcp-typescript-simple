/**
 * Redis-backed PKCE (Proof Key for Code Exchange) store implementation
 *
 * Provides distributed storage for authorization code → code_verifier mappings
 * Required for multi-instance deployments (Vercel, Kubernetes, AWS Lambda, etc.)
 */

import Redis from 'ioredis';
import { PKCEStore, PKCEData } from './pkce-store-interface.js';
import { logger } from '../../observability/logger.js';

export class RedisPKCEStore implements PKCEStore {
  private readonly keyPrefix = 'oauth:pkce:';
  private readonly defaultTTL = 600; // 10 minutes in seconds
  private redis: Redis;

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL;
    if (!url) {
      throw new Error('Redis URL not configured. Set REDIS_URL environment variable.');
    }

    this.redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      connectTimeout: 5000, // 5 second timeout for initial connection
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      lazyConnect: false, // Connect immediately to detect issues early
    });

    this.redis.on('error', (error) => {
      logger.error('Redis PKCE store error', error);
    });

    this.redis.on('connect', () => {
      logger.info('Redis PKCE store connected');
    });
  }

  /**
   * Store code_verifier and state for an authorization code
   */
  async storeCodeVerifier(code: string, data: PKCEData, ttlSeconds: number = this.defaultTTL): Promise<void> {
    const key = this.buildKey(code);
    const value = JSON.stringify(data);

    await this.redis.set(key, value, 'EX', ttlSeconds);

    logger.oauthDebug('Stored PKCE data in Redis', {
      codePrefix: code.substring(0, 10),
      codeVerifierPrefix: data.codeVerifier.substring(0, 10),
      statePrefix: data.state.substring(0, 8),
      ttl: ttlSeconds
    });
  }

  /**
   * Retrieve code_verifier and state for an authorization code
   */
  async getCodeVerifier(code: string): Promise<PKCEData | null> {
    const key = this.buildKey(code);
    const value = await this.redis.get(key);

    if (!value) {
      logger.oauthDebug('PKCE data not found in Redis', {
        codePrefix: code.substring(0, 10)
      });
      return null;
    }

    const data = JSON.parse(value) as PKCEData;

    logger.oauthDebug('Retrieved PKCE data from Redis', {
      codePrefix: code.substring(0, 10),
      codeVerifierPrefix: data.codeVerifier.substring(0, 10),
      statePrefix: data.state.substring(0, 8)
    });

    return data;
  }

  /**
   * Atomically retrieve and delete code_verifier and state for an authorization code
   * Prevents authorization code reuse attacks by using Redis Lua script
   */
  async getAndDeleteCodeVerifier(code: string): Promise<PKCEData | null> {
    const key = this.buildKey(code);

    // Lua script for atomic get-and-delete operation
    // Returns the value before deleting the key
    const luaScript = `
      local value = redis.call('GET', KEYS[1])
      if value then
        redis.call('DEL', KEYS[1])
      end
      return value
    `;

    try {
      // ioredis eval signature: eval(script, numKeys, key1, key2, ..., arg1, arg2, ...)
      const value = await this.redis.eval(luaScript, 1, key) as string | null;

      if (!value) {
        logger.oauthWarn('PKCE data not found during atomic retrieval (possible code reuse attack)', {
          codePrefix: code.substring(0, 10)
        });
        return null;
      }

      const data = JSON.parse(value) as PKCEData;

      logger.oauthDebug('Atomically retrieved and deleted PKCE data from Redis', {
        codePrefix: code.substring(0, 10),
        codeVerifierPrefix: data.codeVerifier.substring(0, 10),
        statePrefix: data.state.substring(0, 8)
      });

      return data;
    } catch (error) {
      logger.oauthError('Error during atomic PKCE retrieval', error);
      throw error;
    }
  }

  /**
   * Check if a code_verifier exists for an authorization code
   */
  async hasCodeVerifier(code: string): Promise<boolean> {
    const key = this.buildKey(code);
    const exists = await this.redis.exists(key);

    logger.oauthDebug('Checked PKCE data existence in Redis', {
      codePrefix: code.substring(0, 10),
      exists: exists === 1
    });

    return exists === 1;
  }

  /**
   * Delete code_verifier and state for an authorization code
   */
  async deleteCodeVerifier(code: string): Promise<void> {
    const key = this.buildKey(code);
    await this.redis.del(key);

    logger.oauthDebug('Deleted PKCE data from Redis', {
      codePrefix: code.substring(0, 10)
    });
  }

  /**
   * Build Redis key for authorization code
   */
  private buildKey(code: string): string {
    return `${this.keyPrefix}${code}`;
  }
}
