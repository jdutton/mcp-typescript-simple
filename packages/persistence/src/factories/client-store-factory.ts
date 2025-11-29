/**
 * OAuth Client Store Factory
 *
 * Creates the appropriate client store based on:
 * - Explicit configuration (DCR_STORE_TYPE env var)
 * - Environment detection (Redis, development, etc.)
 * - Available resources (database, Redis, filesystem)
 *
 * Auto-detection priority:
 * 1. Redis: RedisClientStore (if REDIS_URL set)
 * 2. Development: File (persistent across restarts)
 * 3. Fallback: Memory-only (with warning)
 */

import { OAuthRegisteredClientsStore, ClientStoreType } from '../interfaces/client-store.js';
import { InMemoryClientStore } from '../stores/memory/memory-client-store.js';
import { FileClientStore } from '../stores/file/file-client-store.js';
import { RedisClientStore } from '../stores/redis/redis-client-store.js';
import { logger } from '../logger.js';
import { getDataPath } from '../utils/data-paths.js';
import { getRedisKeyPrefix } from '../stores/redis/redis-utils.js';

export interface ClientStoreFactoryOptions {
  /** Explicit store type (overrides auto-detection) */
  storeType?: ClientStoreType;

  /** File path for file-based stores */
  filePath?: string;

  /** Default client secret expiry in seconds */
  defaultSecretExpirySeconds?: number;

  /** Enable automatic cleanup of expired clients */
  enableAutoCleanup?: boolean;

  /** Maximum number of clients */
  maxClients?: number;
}

export class ClientStoreFactory {
  /**
   * Create a client store based on configuration and environment
   */
  static create(options: ClientStoreFactoryOptions = {}): OAuthRegisteredClientsStore {
    const storeType = options.storeType ?? this.detectStoreType();

    logger.info('Creating client store', {
      storeType,
      explicitType: options.storeType,
      detected: !options.storeType,
    });

    switch (storeType) {
      case 'memory':
        return this.createMemoryStore(options);

      case 'file':
        return this.createFileStore(options);

      case 'redis':
        return this.createRedisStore(options);

      case 'auto':
        // Recursively call with detected type
        return this.create({ ...options, storeType: this.detectStoreType() });

      default:
        throw new Error(`Unknown store type: ${storeType}`);
    }
  }

  /**
   * Auto-detect the best store type for the current environment
   */
  private static detectStoreType(): ClientStoreType {
    // 1. Check for explicit env var
    const envStoreType = process.env.DCR_STORE_TYPE as ClientStoreType;
    if (envStoreType && envStoreType !== 'auto') {
      logger.debug('Store type from DCR_STORE_TYPE', { type: envStoreType });
      return envStoreType;
    }

    // 2. Redis
    if (process.env.REDIS_URL) {
      logger.debug('Detected Redis');
      return 'redis';
    }

    // 3. Production without persistence (not recommended)
    if (process.env.NODE_ENV === 'production') {
      logger.warn(
        'Production environment detected but no persistent storage configured. ' +
        'Consider setting up Redis for production deployments.'
      );
      return 'memory'; // Fallback, but log warning
    }

    // 4. Development (default)
    logger.debug('Using file store for development');
    return 'file';
  }

  /**
   * Create an in-memory client store
   */
  private static createMemoryStore(options: ClientStoreFactoryOptions): InMemoryClientStore {
    return new InMemoryClientStore({
      defaultSecretExpirySeconds: options.defaultSecretExpirySeconds,
      enableAutoCleanup: options.enableAutoCleanup,
      maxClients: options.maxClients,
    });
  }

  /**
   * Create a file-based client store
   */
  private static createFileStore(options: ClientStoreFactoryOptions): FileClientStore {
    const filePath = options.filePath ?? process.env.DCR_FILE_PATH ?? getDataPath('oauth-clients.json');

    return new FileClientStore(filePath, {
      defaultSecretExpirySeconds: options.defaultSecretExpirySeconds,
      maxClients: options.maxClients,
    });
  }

  /**
   * Create a Redis client store
   */
  private static createRedisStore(options: ClientStoreFactoryOptions): RedisClientStore {
    if (!process.env.REDIS_URL) {
      throw new Error('Redis URL not configured. Set REDIS_URL environment variable.');
    }

    const keyPrefix = getRedisKeyPrefix();

    return new RedisClientStore(undefined, {
      defaultSecretExpirySeconds: options.defaultSecretExpirySeconds,
      maxClients: options.maxClients,
    }, keyPrefix);
  }

  /**
   * Get configuration from environment variables
   */
  static getOptionsFromEnvironment(): ClientStoreFactoryOptions {
    return {
      storeType: (process.env.DCR_STORE_TYPE as ClientStoreType) ?? 'auto',
      filePath: process.env.DCR_FILE_PATH,
      defaultSecretExpirySeconds: process.env.DCR_DEFAULT_SECRET_EXPIRY
        ? Number.parseInt(process.env.DCR_DEFAULT_SECRET_EXPIRY, 10)
        : undefined,
      enableAutoCleanup: process.env.DCR_ENABLE_AUTO_CLEANUP === 'true',
      maxClients: process.env.DCR_MAX_CLIENTS
        ? Number.parseInt(process.env.DCR_MAX_CLIENTS, 10)
        : undefined,
    };
  }

  /**
   * Create a client store from environment configuration
   */
  static createFromEnvironment(): OAuthRegisteredClientsStore {
    const options = this.getOptionsFromEnvironment();
    return this.create(options);
  }
}