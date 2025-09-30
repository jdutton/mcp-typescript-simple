/**
 * Initial Access Token Store Factory
 *
 * Auto-detects the best token store implementation based on environment:
 * - Vercel: VercelKVTokenStore (serverless-optimized with Redis)
 * - Development: FileTokenStore (persistence with restart tolerance)
 * - Testing: InMemoryTokenStore (fast, ephemeral)
 *
 * Manual override via DCR_TOKEN_STORE environment variable.
 */

import { InitialAccessTokenStore } from './stores/token-store-interface.js';
import { InMemoryTokenStore } from './stores/memory-token-store.js';
import { FileTokenStore } from './stores/file-token-store.js';
import { VercelKVTokenStore } from './stores/vercel-kv-token-store.js';
import { logger } from '../utils/logger.js';

export type TokenStoreType = 'memory' | 'file' | 'vercel-kv' | 'auto';

export interface TokenStoreFactoryOptions {
  /**
   * Store type to create
   * - 'auto': Auto-detect based on environment (default)
   * - 'memory': In-memory store (not persistent)
   * - 'file': File-based store (persistent, single-instance)
   * - 'vercel-kv': Vercel KV store (serverless-optimized)
   */
  type?: TokenStoreType;

  /**
   * File path for file-based store
   * Default: './data/access-tokens.json'
   */
  filePath?: string;

  /**
   * Enable automatic cleanup for in-memory store
   * Default: false
   */
  autoCleanup?: boolean;

  /**
   * Cleanup interval in milliseconds
   * Default: 3600000 (1 hour)
   */
  cleanupIntervalMs?: number;

  /**
   * Debounce writes for file-based store (milliseconds)
   * Default: 1000
   */
  debounceMs?: number;
}

export class TokenStoreFactory {
  /**
   * Create a token store based on configuration
   */
  static create(options: TokenStoreFactoryOptions = {}): InitialAccessTokenStore {
    const storeType = options.type || 'auto';

    if (storeType === 'auto') {
      return this.createAutoDetected(options);
    }

    switch (storeType) {
      case 'memory':
        return this.createMemoryStore(options);

      case 'file':
        return this.createFileStore(options);

      case 'vercel-kv':
        return this.createVercelKVStore();

      default:
        throw new Error(`Unknown token store type: ${storeType}`);
    }
  }

  /**
   * Auto-detect the best store for current environment
   */
  private static createAutoDetected(options: TokenStoreFactoryOptions): InitialAccessTokenStore {
    // Check for Vercel environment
    if (process.env.VERCEL && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      logger.info('Creating Vercel KV token store', { detected: true });
      return this.createVercelKVStore();
    }

    // Check for test environment
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
      logger.info('Creating in-memory token store (test environment)', { detected: true });
      return this.createMemoryStore(options);
    }

    // Default to file-based store for development/production
    logger.info('Creating file-based token store', { detected: true });
    return this.createFileStore(options);
  }

  /**
   * Create in-memory token store
   */
  private static createMemoryStore(options: TokenStoreFactoryOptions): InMemoryTokenStore {
    return new InMemoryTokenStore({
      autoCleanup: options.autoCleanup ?? false,
      cleanupIntervalMs: options.cleanupIntervalMs,
    });
  }

  /**
   * Create file-based token store
   */
  private static createFileStore(options: TokenStoreFactoryOptions): FileTokenStore {
    return new FileTokenStore({
      filePath: options.filePath,
      debounceMs: options.debounceMs,
    });
  }

  /**
   * Create Vercel KV token store
   */
  private static createVercelKVStore(): VercelKVTokenStore {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      throw new Error(
        'Vercel KV environment variables not configured. ' +
        'Add Vercel KV integration via: vercel link && vercel env pull'
      );
    }

    return new VercelKVTokenStore();
  }

  /**
   * Validate environment for token store creation
   */
  static validateEnvironment(type: TokenStoreType = 'auto'): {
    valid: boolean;
    storeType: Exclude<TokenStoreType, 'auto'>;
    warnings: string[];
  } {
    const warnings: string[] = [];
    let detectedType: Exclude<TokenStoreType, 'auto'>;

    if (type === 'auto') {
      // Determine what would be auto-detected
      if (process.env.VERCEL && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        detectedType = 'vercel-kv';
      } else if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
        detectedType = 'memory';
        warnings.push('Memory store is not persistent - tokens will be lost on restart');
      } else {
        detectedType = 'file';
      }
    } else {
      detectedType = type as Exclude<TokenStoreType, 'auto'>;
    }

    // Validate selected/detected type
    switch (detectedType) {
      case 'vercel-kv':
        if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
          return {
            valid: false,
            storeType: detectedType,
            warnings: ['Vercel KV environment variables not configured'],
          };
        }
        break;

      case 'memory':
        warnings.push('Memory store is not persistent - tokens will be lost on restart');
        warnings.push('Memory store not suitable for multi-instance deployments');
        break;

      case 'file':
        warnings.push('File store not suitable for multi-instance deployments');
        warnings.push('File store not suitable for serverless deployments');
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
 * Convenience function to create a token store with auto-detection
 */
export function createTokenStore(options?: TokenStoreFactoryOptions): InitialAccessTokenStore {
  return TokenStoreFactory.create(options);
}