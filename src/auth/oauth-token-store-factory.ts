/**
 * OAuth Token Store Factory
 *
 * Auto-detects the best token store implementation based on environment:
 * - Redis: RedisOAuthTokenStore (multi-instance with Redis)
 * - Development/Production: MemoryOAuthTokenStore (fast, ephemeral)
 *
 * Note: OAuth tokens benefit from external persistence in serverless
 * environments to avoid token lookup failures across function instances.
 */

import { OAuthTokenStore } from './stores/oauth-token-store-interface.js';
import { MemoryOAuthTokenStore } from './stores/memory-oauth-token-store.js';
import { RedisOAuthTokenStore } from './stores/redis-oauth-token-store.js';
import { logger } from '../observability/logger.js';

export type OAuthTokenStoreType = 'memory' | 'redis' | 'auto';

export interface OAuthTokenStoreFactoryOptions {
  /**
   * Store type to create
   * - 'auto': Auto-detect based on environment (default)
   * - 'memory': In-memory store (not persistent across instances)
   * - 'redis': Redis store (multi-instance deployments)
   */
  type?: OAuthTokenStoreType;
}

export class OAuthTokenStoreFactory {
  /**
   * Create an OAuth token store based on configuration
   */
  static create(options: OAuthTokenStoreFactoryOptions = {}): OAuthTokenStore {
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
        throw new Error(`Unknown OAuth token store type: ${storeType}`);
    }
  }

  /**
   * Auto-detect the best store for current environment
   */
  private static createAutoDetected(): OAuthTokenStore {
    // Check for Redis configured
    if (process.env.REDIS_URL) {
      logger.info('Creating Redis OAuth token store', { detected: true });
      return this.createRedisStore();
    }

    // Default to memory store for local development
    logger.info('Creating in-memory OAuth token store', { detected: true });
    logger.warn('Memory OAuth token store does not persist across serverless instances', {
      recommendation: 'Configure REDIS_URL for multi-instance deployments'
    });
    return this.createMemoryStore();
  }

  /**
   * Create in-memory OAuth token store
   */
  private static createMemoryStore(): MemoryOAuthTokenStore {
    return new MemoryOAuthTokenStore();
  }

  /**
   * Create Redis OAuth token store
   */
  private static createRedisStore(): RedisOAuthTokenStore {
    if (!process.env.REDIS_URL) {
      throw new Error('Redis URL not configured. Set REDIS_URL environment variable.');
    }

    return new RedisOAuthTokenStore();
  }

  /**
   * Validate environment for OAuth token store creation
   */
  static validateEnvironment(type: OAuthTokenStoreType = 'auto'): {
    valid: boolean;
    storeType: Exclude<OAuthTokenStoreType, 'auto'>;
    warnings: string[];
  } {
    const warnings: string[] = [];
    let detectedType: Exclude<OAuthTokenStoreType, 'auto'>;

    if (type === 'auto') {
      // Determine what would be auto-detected
      if (process.env.REDIS_URL) {
        detectedType = 'redis';
      } else {
        detectedType = 'memory';
        warnings.push('Memory store does not persist across serverless instances');
        warnings.push('OAuth tokens will be lost if request hits different instance');
      }
    } else {
      detectedType = type as Exclude<OAuthTokenStoreType, 'auto'>;
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
        warnings.push('OAuth token verification may fail if routed to different instance');
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
 * Convenience function to create an OAuth token store with auto-detection
 */
export function createOAuthTokenStore(options?: OAuthTokenStoreFactoryOptions): OAuthTokenStore {
  return OAuthTokenStoreFactory.create(options);
}
