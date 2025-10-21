/**
 * Redis-based MCP Session Metadata Store
 *
 * Provides persistent, scalable session storage using Redis.
 * Suitable for multi-instance deployments and serverless environments.
 */

import Redis from 'ioredis';
import {
  MCPSessionMetadataStore,
  MCPSessionMetadata,
} from '../../interfaces/mcp-metadata-store.js';
import { logger } from '../../logger.js';

export class RedisMCPMetadataStore implements MCPSessionMetadataStore {
  private redis: Redis;
  private readonly keyPrefix = 'mcp:session:';
  private readonly DEFAULT_TTL = 30 * 60; // 30 minutes in seconds

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL;
    if (!url) {
      throw new Error('Redis URL not configured');
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
      logger.info('Redis connected successfully');
    });

    // Connect immediately
    this.redis.connect().catch((error) => {
      logger.error('Failed to connect to Redis', { error });
    });

    logger.info('RedisMCPMetadataStore initialized', { url: this.maskUrl(url) });
  }

  /**
   * Mask sensitive parts of Redis URL for logging
   */
  private maskUrl(url: string): string {
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        parsed.password = '***';
      }
      return parsed.toString();
    } catch {
      return 'invalid-url';
    }
  }

  /**
   * Get full Redis key for session
   */
  private getKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  async storeSession(sessionId: string, metadata: MCPSessionMetadata): Promise<void> {
    try {
      const key = this.getKey(sessionId);
      const serialized = JSON.stringify(metadata);

      // Calculate TTL from expiresAt
      const ttlSeconds = metadata.expiresAt
        ? Math.max(1, Math.floor((metadata.expiresAt - Date.now()) / 1000))
        : this.DEFAULT_TTL;

      await this.redis.setex(key, ttlSeconds, serialized);

      logger.debug('Session stored in Redis', {
        sessionId: sessionId.substring(0, 8) + '...',
        ttlSeconds,
        size: serialized.length,
      });
    } catch (error) {
      logger.error('Failed to store session in Redis', {
        sessionId: sessionId.substring(0, 8) + '...',
        error,
      });
      throw error;
    }
  }

  async getSession(sessionId: string): Promise<MCPSessionMetadata | null> {
    try {
      const key = this.getKey(sessionId);
      const data = await this.redis.get(key);

      if (!data) {
        logger.debug('Session not found in Redis', {
          sessionId: sessionId.substring(0, 8) + '...',
        });
        return null;
      }

      const metadata = JSON.parse(data) as MCPSessionMetadata;

      // Check if session is expired
      if (metadata.expiresAt && metadata.expiresAt < Date.now()) {
        logger.debug('Session expired in Redis', {
          sessionId: sessionId.substring(0, 8) + '...',
          expiresAt: new Date(metadata.expiresAt).toISOString(),
        });
        await this.deleteSession(sessionId);
        return null;
      }

      logger.debug('Session retrieved from Redis', {
        sessionId: sessionId.substring(0, 8) + '...',
        age: Math.round((Date.now() - metadata.createdAt) / 1000) + 's',
      });

      return metadata;
    } catch (error) {
      logger.error('Failed to get session from Redis', {
        sessionId: sessionId.substring(0, 8) + '...',
        error,
      });
      return null;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      const key = this.getKey(sessionId);
      await this.redis.del(key);

      logger.debug('Session deleted from Redis', {
        sessionId: sessionId.substring(0, 8) + '...',
      });
    } catch (error) {
      logger.error('Failed to delete session from Redis', {
        sessionId: sessionId.substring(0, 8) + '...',
        error,
      });
      throw error;
    }
  }

  async cleanup(): Promise<number> {
    // Redis automatically handles expiration via TTL
    // This method is a no-op for Redis
    logger.debug('Redis cleanup called (no-op - TTL handles expiration)');
    return 0;
  }

  async getSessionCount(): Promise<number> {
    try {
      const keys = await this.redis.keys(`${this.keyPrefix}*`);
      return keys.length;
    } catch (error) {
      logger.error('Failed to get session count from Redis', { error });
      return 0;
    }
  }

  dispose(): void {
    logger.info('Disposing Redis MCP metadata store');
    this.redis.disconnect();
  }
}
