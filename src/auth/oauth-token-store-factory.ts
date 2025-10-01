/**
 * OAuth Token Store Factory
 *
 * Auto-detects the best token store implementation based on environment:
 * - Vercel: VercelKVOAuthTokenStore (serverless-optimized with Redis)
 * - Development/Production: MemoryOAuthTokenStore (fast, ephemeral)
 *
 * Note: OAuth tokens benefit from external persistence in serverless
 * environments to avoid token lookup failures across function instances.
 */

import { OAuthTokenStore } from './stores/oauth-token-store-interface.js';
import { MemoryOAuthTokenStore } from './stores/memory-oauth-token-store.js';
import { VercelKVOAuthTokenStore } from './stores/vercel-kv-oauth-token-store.js';
import { logger } from '../observability/logger.js';

export type OAuthTokenStoreType = 'memory' | 'vercel-kv' | 'auto';

export interface OAuthTokenStoreFactoryOptions {
  /**
   * Store type to create
   * - 'auto': Auto-detect based on environment (default)
   * - 'memory': In-memory store (not persistent across instances)
   * - 'vercel-kv': Vercel KV store (serverless-optimized)
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

      case 'vercel-kv':
        return this.createVercelKVStore();

      default:
        throw new Error(`Unknown OAuth token store type: ${storeType}`);
    }
  }

  /**
   * Auto-detect the best store for current environment
   */
  private static createAutoDetected(): OAuthTokenStore {
    // Check for Vercel environment with KV configured
    if (process.env.VERCEL && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      logger.info('Creating Vercel KV OAuth token store', { detected: true });
      return this.createVercelKVStore();
    }

    // Default to memory store for local development
    logger.info('Creating in-memory OAuth token store', { detected: true });
    logger.warn('Memory OAuth token store does not persist across serverless instances', {
      recommendation: 'Configure Vercel KV for multi-instance deployments'
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
   * Create Vercel KV OAuth token store
   */
  private static createVercelKVStore(): VercelKVOAuthTokenStore {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      throw new Error(
        'Vercel KV environment variables not configured. ' +
        'Add Vercel KV integration via: vercel link && vercel env pull'
      );
    }

    return new VercelKVOAuthTokenStore();
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
      if (process.env.VERCEL && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        detectedType = 'vercel-kv';
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
