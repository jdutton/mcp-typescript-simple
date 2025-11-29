/**
 * OAuth Session Store Factory
 *
 * Auto-detects the best session store implementation based on environment:
 * - Redis: RedisSessionStore (multi-instance with Redis)
 * - Development/Production: MemorySessionStore (fast, ephemeral)
 *
 * Note: Unlike token stores, session stores don't need file-based persistence
 * since OAuth sessions are short-lived (10 minutes).
 */

import { OAuthSessionStore } from '../interfaces/session-store.js';
import { MemorySessionStore } from '../stores/memory/memory-session-store.js';
import { RedisSessionStore } from '../stores/redis/redis-session-store.js';
import { logger } from '../logger.js';
import { getRedisKeyPrefix } from '../stores/redis/redis-utils.js';

export type SessionStoreType = 'memory' | 'redis' | 'auto';

export interface SessionStoreFactoryOptions {
  /**
   * Store type to create
   * - 'auto': Auto-detect based on environment (default)
   * - 'memory': In-memory store (not persistent across instances)
   * - 'redis': Redis store (multi-instance deployments)
   */
  type?: SessionStoreType;
}

export class SessionStoreFactory {
  /**
   * Create a session store based on configuration
   */
  static create(options: SessionStoreFactoryOptions = {}): OAuthSessionStore {
    const storeType = options.type ?? 'auto';

    if (storeType === 'auto') {
      return this.createAutoDetected();
    }

    switch (storeType) {
      case 'memory':
        return this.createMemoryStore();

      case 'redis':
        return this.createRedisStore();

      default:
        throw new Error(`Unknown session store type: ${storeType}`);
    }
  }

  /**
   * Auto-detect the best store for current environment
   */
  private static createAutoDetected(): OAuthSessionStore {
    // Check for Redis configured
    if (process.env.REDIS_URL) {
      logger.info('Creating Redis session store', { detected: true });
      return this.createRedisStore();
    }

    // Default to memory store for local development
    logger.info('Creating in-memory session store', { detected: true });
    logger.warn('Memory session store does not persist across serverless instances', {
      recommendation: 'Configure REDIS_URL for multi-instance deployments'
    });
    return this.createMemoryStore();
  }

  /**
   * Create in-memory session store
   */
  private static createMemoryStore(): MemorySessionStore {
    return new MemorySessionStore();
  }

  /**
   * Create Redis session store
   */
  private static createRedisStore(): RedisSessionStore {
    if (!process.env.REDIS_URL) {
      throw new Error(
        'Redis URL not configured. Set REDIS_URL environment variable.'
      );
    }

    const keyPrefix = getRedisKeyPrefix();

    return new RedisSessionStore(process.env.REDIS_URL, keyPrefix);
  }

  /**
   * Validate environment for session store creation
   */
  static validateEnvironment(type: SessionStoreType = 'auto'): {
    valid: boolean;
    storeType: Exclude<SessionStoreType, 'auto'>;
    warnings: string[];
  } {
    const warnings: string[] = [];
    let detectedType: Exclude<SessionStoreType, 'auto'>;

    if (type === 'auto') {
      // Determine what would be auto-detected
      if (process.env.REDIS_URL) {
        detectedType = 'redis';
      } else {
        detectedType = 'memory';
        warnings.push('Memory store does not persist across serverless instances');
        warnings.push('OAuth state will be lost if callback hits different instance');
      }
    } else {
      detectedType = type as Exclude<SessionStoreType, 'auto'>;
    }

    // Validate selected/detected type
    switch (detectedType) {
      case 'redis':
        if (!process.env.REDIS_URL) {
          return {
            valid: false,
            storeType: detectedType,
            warnings: ['REDIS_URL environment variable not configured'],
          };
        }
        break;

      case 'memory':
        warnings.push('Memory store not suitable for multi-instance serverless deployments');
        warnings.push('OAuth callbacks may fail if routed to different instance');
        break;
    }

    return {
      valid: true,
      storeType: detectedType,
      warnings,
    };
  }
}

/**
 * Convenience function to create a session store with auto-detection
 */
export function createSessionStore(options?: SessionStoreFactoryOptions): OAuthSessionStore {
  return SessionStoreFactory.create(options);
}
