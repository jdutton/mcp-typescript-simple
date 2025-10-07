/**
 * OAuth Token Store Factory
 *
 * Auto-detects the best token store implementation based on environment:
 * - Redis: RedisOAuthTokenStore (multi-instance with Redis)
 * - File: FileOAuthTokenStore (persistent, single-instance)
 * - Memory: MemoryOAuthTokenStore (fast, ephemeral - test only)
 *
 * Auto-detection logic:
 * 1. If REDIS_URL configured → Redis store
 * 2. If test environment (NODE_ENV=test or JEST_WORKER_ID) → Memory store
 * 3. Otherwise (development/production) → File store
 */

import { OAuthTokenStore } from './stores/oauth-token-store-interface.js';
import { MemoryOAuthTokenStore } from './stores/memory-oauth-token-store.js';
import { FileOAuthTokenStore, FileOAuthTokenStoreOptions } from './stores/file-oauth-token-store.js';
import { RedisOAuthTokenStore } from './stores/redis-oauth-token-store.js';
import { logger } from '../observability/logger.js';

export type OAuthTokenStoreType = 'memory' | 'file' | 'redis' | 'auto';

export interface OAuthTokenStoreFactoryOptions {
  /**
   * Store type to create
   * - 'auto': Auto-detect based on environment (default)
   * - 'memory': In-memory store (not persistent across instances)
   * - 'file': File-based store (persistent across restarts, single-instance)
   * - 'redis': Redis store (multi-instance deployments)
   */
  type?: OAuthTokenStoreType;

  /**
   * File store options (only used when type is 'file')
   */
  fileOptions?: FileOAuthTokenStoreOptions;
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

      case 'file':
        return this.createFileStore(options.fileOptions);

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

    // Check for test environment
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
      logger.info('Creating in-memory OAuth token store (test environment)', { detected: true });
      return this.createMemoryStore();
    }

    // Default to file-based store for development/production
    logger.info('Creating file-based OAuth token store', { detected: true });
    return this.createFileStore();
  }

  /**
   * Create in-memory OAuth token store
   */
  private static createMemoryStore(): MemoryOAuthTokenStore {
    return new MemoryOAuthTokenStore();
  }

  /**
   * Create file-based OAuth token store
   */
  private static createFileStore(options?: FileOAuthTokenStoreOptions): FileOAuthTokenStore {
    return new FileOAuthTokenStore(options);
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
