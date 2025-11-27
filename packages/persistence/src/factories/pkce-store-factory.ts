/**
 * PKCE Store Factory
 *
 * Auto-detects the best PKCE store implementation based on environment:
 * - Redis: RedisPKCEStore (multi-instance with Redis) - REQUIRED for production
 * - Development/Test: MemoryPKCEStore (single-instance only)
 *
 * IMPORTANT: PKCE store MUST be Redis for multi-instance deployments
 * Unlike session stores, PKCE store cannot safely use memory in production
 */

import { PKCEStore } from '../interfaces/pkce-store.js';
import { MemoryPKCEStore } from '../stores/memory/memory-pkce-store.js';
import { RedisPKCEStore } from '../stores/redis/redis-pkce-store.js';
import { logger } from '../logger.js';

export type PKCEStoreType = 'memory' | 'redis' | 'auto';

export interface PKCEStoreFactoryOptions {
  /**
   * Store type to create
   * - 'auto': Auto-detect based on environment (default)
   * - 'memory': In-memory store (TESTING ONLY - not for multi-instance)
   * - 'redis': Redis store (required for multi-instance deployments)
   */
  type?: PKCEStoreType;
}

export class PKCEStoreFactory {
  /**
   * Create a PKCE store based on configuration
   */
  static create(options: PKCEStoreFactoryOptions = {}): PKCEStore {
    const storeType = options.type || 'auto';

    if (storeType === 'auto') {
      return this.createAutoDetected();
    }

    switch (storeType) {
      case 'memory':
        return this.createMemoryStore();

      case 'redis':
        return this.createRedisStore();

      default:
        throw new Error(`Unknown PKCE store type: ${storeType}`);
    }
  }

  /**
   * Auto-detect the best store for current environment
   */
  private static createAutoDetected(): PKCEStore {
    // Test environment: use memory store
    if (process.env.NODE_ENV === 'test') {
      logger.info('Creating in-memory PKCE store for testing', { detected: true });
      return this.createMemoryStore();
    }

    // Check for Redis configured
    if (process.env.REDIS_URL) {
      logger.info('Creating Redis PKCE store', { detected: true });
      return this.createRedisStore();
    }

    // Development fallback to memory store
    if (process.env.NODE_ENV === 'development') {
      logger.warn('Creating in-memory PKCE store for development', { detected: true });
      logger.warn('Memory PKCE store NOT suitable for multi-instance deployments', {
        recommendation: 'Configure REDIS_URL for Vercel/production deployments'
      });
      return this.createMemoryStore();
    }

    // Vercel serverless: use memory store (each function is isolated)
    if (process.env.VERCEL) {
      logger.info('Creating in-memory PKCE store for Vercel serverless', {
        detected: true,
        reason: 'Serverless functions are ephemeral and isolated'
      });
      return this.createMemoryStore();
    }

    // Production: require Redis
    throw new Error(
      'Redis required for PKCE store in production. Set REDIS_URL environment variable.'
    );
  }

  /**
   * Create in-memory PKCE store (testing only)
   */
  private static createMemoryStore(): MemoryPKCEStore {
    return new MemoryPKCEStore();
  }

  /**
   * Create Redis PKCE store
   */
  private static createRedisStore(): RedisPKCEStore {
    if (!process.env.REDIS_URL) {
      throw new Error(
        'Redis URL not configured. Set REDIS_URL environment variable.'
      );
    }

    return new RedisPKCEStore();
  }
}

/**
 * Convenience function to create a PKCE store with auto-detection
 */
export function createPKCEStore(options?: PKCEStoreFactoryOptions): PKCEStore {
  return PKCEStoreFactory.create(options);
}
