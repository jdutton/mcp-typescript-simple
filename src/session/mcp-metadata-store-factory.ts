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
import { FileMCPMetadataStore } from './file-mcp-metadata-store.js';
import { CachingMCPMetadataStore } from './caching-mcp-metadata-store.js';
import { VercelKVMCPMetadataStore } from './vercel-kv-mcp-metadata-store.js';
import { logger } from '../observability/logger.js';

export type MCPMetadataStoreType = 'memory' | 'file' | 'caching' | 'hybrid' | 'vercel-kv' | 'redis' | 'auto';

export interface MCPMetadataStoreFactoryOptions {
  /**
   * Store type to create
   * - 'auto': Auto-detect based on environment (default)
   * - 'memory': In-memory store (not persistent across instances)
   * - 'file': File-based store (persistent, development)
   * - 'caching': Caching store (memory + optional file/redis/vercel-kv)
   * - 'hybrid': Alias for 'caching' (backwards compatibility)
   * - 'vercel-kv': Vercel KV store (serverless-optimized)
   * - 'redis': Generic Redis store (future implementation)
   */
  type?: MCPMetadataStoreType;

  /**
   * Optional file path for file-based store
   */
  filePath?: string;

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

      case 'file':
        return this.createFileStore(options.filePath);

      case 'caching':
      case 'hybrid': // Backwards compatibility
        return this.createCachingStore(options);

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
    const isProduction = process.env.NODE_ENV === 'production';
    const isVercel = !!process.env.VERCEL;

    // 1. Production + Vercel KV: Use caching with Vercel KV backend
    if (isProduction && isVercel && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      logger.info('Creating caching MCP metadata store with Vercel KV backend', {
        detected: true,
        scalable: true,
        persistent: true,
      });
      return this.createCachingStore({
        ...options,
        type: 'vercel-kv',
      });
    }

    // 2. Production + Redis: Use caching with Redis backend
    if (isProduction && (options.redisUrl || process.env.REDIS_URL)) {
      logger.info('Creating caching MCP metadata store with Redis backend', {
        detected: true,
        scalable: true,
        persistent: true,
      });
      return this.createCachingStore({
        ...options,
        type: 'redis',
        redisUrl: options.redisUrl || process.env.REDIS_URL,
      });
    }

    // 3. Development or local: Use caching with file backend
    if (!isProduction || process.env.USE_FILE_STORE) {
      logger.info('Creating caching MCP metadata store with file backend', {
        detected: true,
        scalable: false,
        persistent: true,
      });
      return this.createCachingStore({
        ...options,
        type: 'file',
        filePath: options.filePath || './data/mcp-sessions.json',
      });
    }

    // 4. Fallback: Caching with no secondary (memory-only)
    logger.info('Creating caching MCP metadata store with no secondary (memory-only)', {
      detected: true,
      scalable: false,
      persistent: false,
    });
    logger.warn('Memory-only metadata store does not persist across instances', {
      recommendation: 'Configure Vercel KV or Redis for multi-instance deployments',
    });
    return this.createCachingStore({
      ...options,
      type: 'memory', // Will create caching store with no secondary
    });
  }

  /**
   * Create in-memory session metadata store
   */
  private static createMemoryStore(): MemoryMCPMetadataStore {
    return new MemoryMCPMetadataStore();
  }

  /**
   * Create file-based session metadata store
   */
  private static createFileStore(filePath?: string): FileMCPMetadataStore {
    return new FileMCPMetadataStore(filePath || './data/mcp-sessions.json');
  }

  /**
   * Create caching session metadata store
   * Primary: Memory (fast cache with LRU + TTL)
   * Secondary: Optional persistent backend (File/Redis/VercelKV)
   */
  private static createCachingStore(options: MCPMetadataStoreFactoryOptions): CachingMCPMetadataStore {
    const primaryStore = this.createMemoryStore();

    // Determine secondary store based on options (optional)
    let secondaryStore: MCPSessionMetadataStore | undefined;

    if (options.type === 'vercel-kv') {
      secondaryStore = this.createVercelKVStore();
    } else if (options.type === 'redis') {
      secondaryStore = this.createRedisStore(options.redisUrl);
    } else if (options.type === 'file') {
      secondaryStore = this.createFileStore(options.filePath);
    }
    // If type is 'memory', secondaryStore remains undefined

    return new CachingMCPMetadataStore(primaryStore, secondaryStore, {
      enablePeriodicSync: true,
      syncIntervalMs: 5 * 60 * 1000, // 5 minutes
    });
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
