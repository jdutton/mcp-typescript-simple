/**
 * Shared Redis utility functions
 *
 * Common functionality used across all Redis store implementations
 * to eliminate code duplication.
 */

import Redis from 'ioredis';
import { logger } from '../../logger.js';

/**
 * Mask sensitive parts of Redis URL for logging
 *
 * Hides password in Redis URLs to prevent credential leakage in logs.
 *
 * @param url Redis connection URL
 * @returns Masked URL with password replaced by ***
 */
export function maskRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
  // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- REDIS_PASSWORD is an environment variable name, not a password
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return 'redis://***';
  }
}

/**
 * Create a configured Redis client with standard connection handling
 * Shared utility to eliminate Redis initialization duplication across stores
 *
 * @param redisUrl Redis connection URL (optional, defaults to REDIS_URL env var)
 * @param connectionName Name for logging (e.g., "OAuth sessions", "MCP metadata")
 * @returns Configured Redis client instance with event handlers
 */
export function createRedisClient(redisUrl: string | undefined, connectionName: string): Redis {
  const url = redisUrl ?? process.env.REDIS_URL;
  if (!url) {
    throw new Error('Redis URL not configured. Set REDIS_URL environment variable.');
  }

  const redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    lazyConnect: true,
  });

  redis.on('error', (error) => {
    logger.error('Redis connection error', { error });
  });

  redis.on('connect', () => {
    logger.info(`Redis connected successfully for ${connectionName}`);
  });

  // Connect immediately
  redis.connect().catch((error) => {
    logger.error('Failed to connect to Redis', { error });
  });

  return redis;
}
