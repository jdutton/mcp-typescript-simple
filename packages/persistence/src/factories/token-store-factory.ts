/**
 * Initial Access Token Store Factory
 *
 * Auto-detects the best token store implementation based on environment:
 * - Redis: RedisTokenStore (multi-instance with encryption)
 * - Development: FileTokenStore (single-instance with encryption)
 * - Testing: InMemoryTestTokenStore (fast, ephemeral, process-isolated, no encryption)
 *
 * Manual override via DCR_TOKEN_STORE environment variable.
 */

import { InitialAccessTokenStore } from '../interfaces/token-store.js';
import { InMemoryTestTokenStore } from '../stores/memory/memory-test-token-store.js';
import { FileTokenStore } from '../stores/file/file-token-store.js';
import { RedisTokenStore } from '../stores/redis/redis-token-store.js';
import { TokenEncryptionService } from '../encryption/token-encryption-service.js';
import { getSecretsProvider } from '@mcp-typescript-simple/config/secrets';
import { logger } from '../logger.js';
import { getRedisKeyPrefix } from '../stores/redis/redis-utils.js';

export type TokenStoreType = 'memory' | 'file' | 'redis' | 'auto';

export interface TokenStoreFactoryOptions {
  /**
   * Store type to create
   * - 'auto': Auto-detect based on environment (default)
   * - 'memory': In-memory store (not persistent)
   * - 'file': File-based store (persistent, single-instance)
   * - 'redis': Redis store (multi-instance deployments)
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
  static async create(options: TokenStoreFactoryOptions = {}): Promise<InitialAccessTokenStore> {
    console.log('[TokenStoreFactory.create] ENTRY POINT - method called');
    const storeType = options.type ?? 'auto';

    console.log('[TokenStoreFactory.create] Starting creation', {
      storeType,
      NODE_ENV: process.env.NODE_ENV,
      VITEST_WORKER_ID: process.env.VITEST_WORKER_ID,
      VITEST: process.env.VITEST,
      REDIS_URL: !!process.env.REDIS_URL,
    });

    if (storeType === 'auto') {
      const store = await this.createAutoDetected(options);
      console.log('[TokenStoreFactory.create] Created store via auto-detect', {
        storeConstructorName: store.constructor.name,
      });
      return store;
    }

    switch (storeType) {
      case 'memory':
        return this.createMemoryStore(options);

      case 'file':
        return this.createFileStore(options);

      case 'redis':
        return this.createRedisStore();

      default:
        throw new Error(`Unknown token store type: ${storeType}`);
    }
  }

  /**
   * Auto-detect the best store for current environment
   */
  private static async createAutoDetected(options: TokenStoreFactoryOptions): Promise<InitialAccessTokenStore> {
    // Check for Redis configured
    if (process.env.REDIS_URL) {
      logger.info('Creating Redis token store', { detected: true });
      return this.createRedisStore();
    }

    // Check for test environment (Jest or Vitest)
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID || process.env.VITEST || process.env.VITEST_WORKER_ID) {
      logger.info('Creating in-memory token store (test environment)', { detected: true });
      return this.createMemoryStore(options);
    }

    // Default to file-based store for development/production
    logger.info('Creating file-based token store', { detected: true });
    return this.createFileStore(options);
  }

  /**
   * Create in-memory test token store (no encryption - process-isolated)
   */
  private static async createMemoryStore(options: TokenStoreFactoryOptions): Promise<InMemoryTestTokenStore> {
    console.log('[TokenStoreFactory.createMemoryStore] Creating InMemoryTestTokenStore');
    const store = new InMemoryTestTokenStore({
      autoCleanup: options.autoCleanup ?? false,
      cleanupIntervalMs: options.cleanupIntervalMs,
    });
    console.log('[TokenStoreFactory.createMemoryStore] Created successfully', {
      constructorName: store.constructor.name,
    });
    return store;
  }

  /**
   * Create file-based token store with encryption
   */
  private static async createFileStore(options: TokenStoreFactoryOptions): Promise<FileTokenStore> {
    // Get encryption key (direct from env in test mode, from secrets provider otherwise)
    let encryptionKey: string | undefined;

    // In test environment, use TOKEN_ENCRYPTION_KEY directly to avoid circular dependency
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID || process.env.VITEST || process.env.VITEST_WORKER_ID) {
      encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
    } else {
      // In production, load encryption key from secrets provider
      const secrets = await getSecretsProvider();
      encryptionKey = await secrets.getSecret<string>('TOKEN_ENCRYPTION_KEY');
    }

    if (!encryptionKey) {
      throw new Error(
        'Token encryption key not configured. ' +
        'Set TOKEN_ENCRYPTION_KEY environment variable or configure in secrets provider. ' +
        'Generate with: crypto.randomBytes(32).toString(\'base64\')'
      );
    }

    // Create encryption service
    const encryptionService = new TokenEncryptionService({ encryptionKey });

    return new FileTokenStore({
      filePath: options.filePath,
      debounceMs: options.debounceMs,
      encryptionService,
    });
  }

  /**
   * Create Redis token store with encryption
   */
  private static async createRedisStore(): Promise<RedisTokenStore> {
    if (!process.env.REDIS_URL) {
      throw new Error('Redis URL not configured. Set REDIS_URL environment variable.');
    }

    // Get encryption key (direct from env in test mode, from secrets provider otherwise)
    let encryptionKey: string | undefined;

    // In test environment, use TOKEN_ENCRYPTION_KEY directly to avoid circular dependency
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID || process.env.VITEST || process.env.VITEST_WORKER_ID) {
      encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
    } else {
      // In production, load encryption key from secrets provider
      const secrets = await getSecretsProvider();
      encryptionKey = await secrets.getSecret<string>('TOKEN_ENCRYPTION_KEY');
    }

    if (!encryptionKey) {
      throw new Error(
        'Token encryption key not configured. ' +
        'Set TOKEN_ENCRYPTION_KEY environment variable or configure in secrets provider. ' +
        'Generate with: crypto.randomBytes(32).toString(\'base64\')'
      );
    }

    // Create encryption service
    const encryptionService = new TokenEncryptionService({ encryptionKey });

    const keyPrefix = getRedisKeyPrefix();

    return new RedisTokenStore(process.env.REDIS_URL, encryptionService, keyPrefix);
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
      if (process.env.REDIS_URL) {
        detectedType = 'redis';
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
export function createTokenStore(options?: TokenStoreFactoryOptions): Promise<InitialAccessTokenStore> {
  return TokenStoreFactory.create(options);
}