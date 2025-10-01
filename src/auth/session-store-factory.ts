/**
 * OAuth Session Store Factory
 *
 * Auto-detects the best session store implementation based on environment:
 * - Vercel: VercelKVSessionStore (serverless-optimized with Redis)
 * - Development/Production: MemorySessionStore (fast, ephemeral)
 *
 * Note: Unlike token stores, session stores don't need file-based persistence
 * since OAuth sessions are short-lived (10 minutes).
 */

import { OAuthSessionStore } from './stores/session-store-interface.js';
import { MemorySessionStore } from './stores/memory-session-store.js';
import { VercelKVSessionStore } from './stores/vercel-kv-session-store.js';
import { logger } from '../observability/logger.js';

export type SessionStoreType = 'memory' | 'vercel-kv' | 'auto';

export interface SessionStoreFactoryOptions {
  /**
   * Store type to create
   * - 'auto': Auto-detect based on environment (default)
   * - 'memory': In-memory store (not persistent across instances)
   * - 'vercel-kv': Vercel KV store (serverless-optimized)
   */
  type?: SessionStoreType;
}

export class SessionStoreFactory {
  /**
   * Create a session store based on configuration
   */
  static create(options: SessionStoreFactoryOptions = {}): OAuthSessionStore {
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
        throw new Error(`Unknown session store type: ${storeType}`);
    }
  }

  /**
   * Auto-detect the best store for current environment
   */
  private static createAutoDetected(): OAuthSessionStore {
    // Check for Vercel environment with KV configured
    if (process.env.VERCEL && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      logger.info('Creating Vercel KV session store', { detected: true });
      return this.createVercelKVStore();
    }

    // Default to memory store for local development
    logger.info('Creating in-memory session store', { detected: true });
    logger.warn('Memory session store does not persist across serverless instances', {
      recommendation: 'Configure Vercel KV for multi-instance deployments'
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
   * Create Vercel KV session store
   */
  private static createVercelKVStore(): VercelKVSessionStore {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      throw new Error(
        'Vercel KV environment variables not configured. ' +
        'Add Vercel KV integration via: vercel link && vercel env pull'
      );
    }

    return new VercelKVSessionStore();
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
      if (process.env.VERCEL && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        detectedType = 'vercel-kv';
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
