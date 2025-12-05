/**
 * Redis OAuth Session Store
 *
 * Redis-compatible session storage for OAuth state persistence across
 * serverless function invocations and multi-instance deployments.
 *
 * Features:
 * - Works with any Redis deployment (Vercel, Docker, AWS, etc.)
 * - No vendor lock-in (uses standard ioredis client)
 * - Automatic TTL support (10 minute session timeout)
 * - Multi-instance deployment support
 *
 * Setup:
 * Set REDIS_URL environment variable (e.g., redis://localhost:6379)
 */

import { Redis } from 'ioredis';
import { OAuthSessionStore } from '../../interfaces/session-store.js';
import { OAuthSession } from '../../types.js';
import { logger } from '../../logger.js';
import { maskRedisUrl, createRedisClient, normalizeKeyPrefix } from './redis-utils.js';

/**
 * Session timeout for OAuth flows
 */
const SESSION_TIMEOUT = 10 * 60; // 10 minutes in seconds

export class RedisSessionStore implements OAuthSessionStore {
  private redis: Redis;
  private readonly KEY_PREFIX: string;

  constructor(redisUrl?: string, keyPrefix: string = '') {
    this.redis = createRedisClient(redisUrl, 'OAuth sessions');

    // Normalize key prefix (adds trailing colon if needed)
    const normalized = normalizeKeyPrefix(keyPrefix);
    this.KEY_PREFIX = `${normalized}oauth:session:`;

    const url = redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379';
    logger.info('RedisSessionStore initialized', { url: maskRedisUrl(url), keyPrefix: this.KEY_PREFIX });
  }

  /**
   * Generate Redis key for session state
   */
  private getSessionKey(state: string): string {
    return `${this.KEY_PREFIX}${state}`;
  }

  async storeSession(state: string, session: OAuthSession): Promise<void> {
    const key = this.getSessionKey(state);

    try {
      // Store with TTL matching session timeout
      await this.redis.setex(key, SESSION_TIMEOUT, JSON.stringify(session));

      logger.debug('Session stored', {
        state: state.substring(0, 8) + '...',
        provider: session.provider,
        expiresIn: SESSION_TIMEOUT
      });
    } catch (error) {
      logger.error('Failed to store session', {
        state: state.substring(0, 8) + '...',
        error
      });
      throw new Error('Session storage failed');
    }
  }

  async getSession(state: string): Promise<OAuthSession | null> {
    const key = this.getSessionKey(state);

    try {
      const data = await this.redis.get(key);

      if (!data) {
        logger.debug('Session not found', {
          state: state.substring(0, 8) + '...'
        });
        return null;
      }

      const session = JSON.parse(data) as OAuthSession;

      // Verify not expired
      if (session.expiresAt && session.expiresAt < Date.now()) {
        logger.warn('Session expired', {
          state: state.substring(0, 8) + '...',
          expiredAt: new Date(session.expiresAt).toISOString()
        });
        await this.deleteSession(state);
        return null;
      }

      logger.debug('Session retrieved', {
        state: state.substring(0, 8) + '...',
        provider: session.provider
      });

      return session;
    } catch (error) {
      logger.error('Failed to retrieve session', {
        state: state.substring(0, 8) + '...',
        error
      });
      return null;
    }
  }

  async deleteSession(state: string): Promise<void> {
    const key = this.getSessionKey(state);

    try {
      await this.redis.del(key);

      logger.debug('Session deleted', {
        state: state.substring(0, 8) + '...'
      });
    } catch (error) {
      logger.error('Failed to delete session', {
        state: state.substring(0, 8) + '...',
        error
      });
      // Don't throw - session deletion is best-effort
    }
  }

  async cleanup(): Promise<number> {
    // With Redis TTL, automatic cleanup happens
    // This method is for compatibility with the interface
    logger.debug('Session cleanup skipped (TTL-based)');
    return 0;
  }

  async getSessionCount(): Promise<number> {
    try {
      // Scan for all session keys
      const keys = await this.redis.keys(`${this.KEY_PREFIX}*`);
      return keys.length;
    } catch (error) {
      logger.error('Failed to get session count', { error });
      return 0;
    }
  }

  dispose(): void {
    // Disconnect from Redis
    this.redis.disconnect();
    logger.info('RedisSessionStore disposed');
  }
}
