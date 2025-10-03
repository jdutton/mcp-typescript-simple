/**
 * MCP Session Metadata Store Factory
 *
 * Auto-detects the best session metadata store implementation based on environment:
 * - Vercel with KV: VercelKVMCPMetadataStore (horizontal scalability)
 * - Redis configured: (Future) RedisM CPMetadataStore
 * - Default: MemoryMCPMetadataStore (single-instance, existing behavior)
 *
 * This enables horizontal scalability without requiring code changes.
 */

import { MCPSessionMetadataStore } from './mcp-session-metadata-store-interface.js';
import { MemoryMCPMetadataStore } from './memory-mcp-metadata-store.js';
import { VercelKVMCPMetadataStore } from './vercel-kv-mcp-metadata-store.js';
import { logger } from '../observability/logger.js';

export type MCPMetadataStoreType = 'memory' | 'vercel-kv' | 'redis' | 'auto';

export interface MCPMetadataStoreFactoryOptions {
  /**
   * Store type to create
   * - 'auto': Auto-detect based on environment (default)
   * - 'memory': In-memory store (not persistent across instances)
   * - 'vercel-kv': Vercel KV store (serverless-optimized)
   * - 'redis': Generic Redis store (future implementation)
   */
  type?: MCPMetadataStoreType;

  /**
   * Optional Redis URL for generic Redis store
   */
  redisUrl?: string;
}

export class MCPMetadataStoreFactory {
  /**
   * Create a session metadata store based on configuration
   */
  static create(options: MCPMetadataStoreFactoryOptions = {}): MCPSessionMetadataStore {
    const storeType = options.type || 'auto';

    if (storeType === 'auto') {
      return this.createAutoDetected(options);
    }

    switch (storeType) {
      case 'memory':
        return this.createMemoryStore();

      case 'vercel-kv':
        return this.createVercelKVStore();

      case 'redis':
        return this.createRedisStore(options.redisUrl);

      default:
        throw new Error(`Unknown MCP metadata store type: ${storeType}`);
    }
  }

  /**
   * Auto-detect the best store for current environment
   */
  private static createAutoDetected(options: MCPMetadataStoreFactoryOptions): MCPSessionMetadataStore {
    // 1. Check for Vercel environment with KV configured
    if (process.env.VERCEL && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      logger.info('Creating Vercel KV MCP metadata store', {
        detected: true,
        scalable: true,
      });
      return this.createVercelKVStore();
    }

    // 2. Check for generic Redis configuration
    if (options.redisUrl || process.env.REDIS_URL) {
      logger.info('Creating Redis MCP metadata store', {
        detected: true,
        scalable: true,
      });
      return this.createRedisStore(options.redisUrl || process.env.REDIS_URL);
    }

    // 3. Default to memory store for local development
    logger.info('Creating in-memory MCP metadata store', {
      detected: true,
      scalable: false,
    });
    logger.warn('Memory metadata store does not persist across serverless instances', {
      recommendation: 'Configure Vercel KV or Redis for multi-instance deployments',
    });
    return this.createMemoryStore();
  }

  /**
   * Create in-memory session metadata store
   */
  private static createMemoryStore(): MemoryMCPMetadataStore {
    return new MemoryMCPMetadataStore();
  }

  /**
   * Create Vercel KV session metadata store
   */
  private static createVercelKVStore(): VercelKVMCPMetadataStore {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      throw new Error(
        'Vercel KV environment variables not configured. ' +
        'Add Vercel KV integration via: vercel link && vercel env pull'
      );
    }

    return new VercelKVMCPMetadataStore();
  }

  /**
   * Create generic Redis session metadata store
   *
   * @param redisUrl - Redis connection URL (e.g., redis://localhost:6379)
   */
  private static createRedisStore(redisUrl?: string): MCPSessionMetadataStore {
    if (!redisUrl) {
      throw new Error(
        'Redis URL not configured. ' +
        'Set REDIS_URL environment variable or pass redisUrl option'
      );
    }

    // TODO: Implement RedisMCPMetadataStore
    // For now, fall back to memory store with warning
    logger.warn('Generic Redis store not yet implemented, using memory store', {
      redisUrl,
      recommendation: 'Use Vercel KV for serverless deployments',
    });
    return this.createMemoryStore();
  }

  /**
   * Validate environment for session metadata store creation
   */
  static validateEnvironment(type: MCPMetadataStoreType = 'auto'): {
    valid: boolean;
    storeType: Exclude<MCPMetadataStoreType, 'auto'>;
    warnings: string[];
  } {
    const warnings: string[] = [];
    let detectedType: Exclude<MCPMetadataStoreType, 'auto'>;

    if (type === 'auto') {
      // Determine what would be auto-detected
      if (process.env.VERCEL && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
        detectedType = 'vercel-kv';
      } else if (process.env.REDIS_URL) {
        detectedType = 'redis';
      } else {
        detectedType = 'memory';
        warnings.push('Memory store does not persist across serverless instances');
        warnings.push('MCP sessions will be lost if request hits different instance');
        warnings.push('Not suitable for Vercel serverless or multi-instance deployments');
      }
    } else {
      detectedType = type as Exclude<MCPMetadataStoreType, 'auto'>;
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

      case 'redis':
        if (!process.env.REDIS_URL) {
          return {
            valid: false,
            storeType: detectedType,
            warnings: ['REDIS_URL environment variable not configured'],
          };
        }
        warnings.push('Generic Redis store not yet fully implemented');
        break;

      case 'memory':
        warnings.push('Memory store not suitable for multi-instance serverless deployments');
        warnings.push('MCP sessions may be lost if routed to different instance');
        warnings.push('Cold starts will lose all active sessions');
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
 * Convenience function to create a session metadata store with auto-detection
 */
export function createMCPMetadataStore(options?: MCPMetadataStoreFactoryOptions): MCPSessionMetadataStore {
  return MCPMetadataStoreFactory.create(options);
}
