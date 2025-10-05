/**
 * MCP Session Metadata Store Factory
 *
 * Auto-detects the best session metadata store implementation based on environment:
 * - Redis configured: RedisMCPMetadataStore (horizontal scalability)
 * - Default: MemoryMCPMetadataStore (single-instance, existing behavior)
 *
 * This enables horizontal scalability without requiring code changes.
 */

import { MCPSessionMetadataStore } from './mcp-session-metadata-store-interface.js';
import { MemoryMCPMetadataStore } from './memory-mcp-metadata-store.js';
import { FileMCPMetadataStore } from './file-mcp-metadata-store.js';
import { CachingMCPMetadataStore } from './caching-mcp-metadata-store.js';
import { RedisMCPMetadataStore } from './redis-mcp-metadata-store.js';
import { logger } from '../observability/logger.js';

export type MCPMetadataStoreType = 'memory' | 'file' | 'caching' | 'redis' | 'auto';

export interface MCPMetadataStoreFactoryOptions {
  /**
   * Store type to create
   * - 'auto': Auto-detect based on environment (default)
   * - 'memory': In-memory store (not persistent across instances)
   * - 'file': File-based store (persistent, development)
   * - 'caching': Caching store (memory + optional file/redis)
   * - 'redis': Redis store (production, serverless-optimized)
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
        return this.createCachingStore(options);

      case 'redis':
        return this.createRedisStore(options.redisUrl);

      default:
        throw new Error(`Unknown MCP metadata store type: ${storeType}`);
    }
  }

  /**
   * Auto-detect the best store for current environment
   * Priority: Actual configuration > Environment detection
   */
  private static createAutoDetected(options: MCPMetadataStoreFactoryOptions): MCPSessionMetadataStore {
    const isProduction = process.env.NODE_ENV === 'production';

    // 1. Redis configured: Use Redis (regardless of environment)
    if (options.redisUrl || process.env.REDIS_URL) {
      logger.info('Creating caching MCP metadata store with Redis backend', {
        detected: true,
        scalable: true,
        persistent: true,
        source: options.redisUrl ? 'options' : 'REDIS_URL',
      });
      return this.createCachingStore({
        ...options,
        type: 'redis',
        redisUrl: options.redisUrl || process.env.REDIS_URL,
      });
    }

    // 3. Development with file preference: Use file backend
    if (!isProduction || process.env.USE_FILE_STORE) {
      logger.info('Creating caching MCP metadata store with file backend', {
        detected: true,
        scalable: false,
        persistent: true,
        environment: isProduction ? 'production-override' : 'development',
      });
      return this.createCachingStore({
        ...options,
        type: 'file',
        filePath: options.filePath || './data/mcp-sessions.json',
      });
    }

    // 4. Production without external store: Memory-only (not recommended)
    logger.warn('Creating memory-only metadata store in production', {
      scalable: false,
      persistent: false,
      recommendation: 'Configure REDIS_URL for multi-instance deployments',
    });
    return this.createCachingStore({
      ...options,
      type: 'memory',
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
   * Secondary: Optional persistent backend (File/Redis)
   */
  private static createCachingStore(options: MCPMetadataStoreFactoryOptions): CachingMCPMetadataStore {
    const primaryStore = this.createMemoryStore();

    // Determine secondary store based on options (optional)
    let secondaryStore: MCPSessionMetadataStore | undefined;

    if (options.type === 'redis') {
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

    return new RedisMCPMetadataStore(redisUrl);
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
      if (process.env.REDIS_URL) {
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
