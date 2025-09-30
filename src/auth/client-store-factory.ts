/**
 * OAuth Client Store Factory
 *
 * Creates the appropriate client store based on:
 * - Explicit configuration (DCR_STORE_TYPE env var)
 * - Environment detection (Vercel, development, etc.)
 * - Available resources (database, KV, filesystem)
 *
 * Auto-detection priority:
 * 1. Vercel production: Vercel KV (if KV configured)
 * 2. Database: PostgreSQL (if DATABASE_URL set) [future]
 * 3. Redis: Redis (if REDIS_URL set) [future]
 * 4. Development: Hybrid (memory + file)
 * 5. Fallback: Memory-only (with warning)
 */

import { OAuthRegisteredClientsStore, ClientStoreType } from './stores/client-store-interface.js';
import { InMemoryClientStore } from './stores/memory-client-store.js';
import { FileClientStore } from './stores/file-client-store.js';
import { HybridClientStore } from './stores/hybrid-client-store.js';
import { VercelKVClientStore } from './stores/vercel-kv-client-store.js';
import { logger } from '../utils/logger.js';

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

      case 'hybrid':
        return this.createHybridStore(options);

      case 'vercel-kv':
        return this.createVercelKVStore(options);

      case 'postgres':
        throw new Error('PostgreSQL store not yet implemented');

      case 'redis':
        throw new Error('Redis store not yet implemented');

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

    // 2. Vercel production with KV
    if (process.env.VERCEL && process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
      logger.debug('Detected Vercel with KV configured');
      return 'vercel-kv';
    }

    // 3. PostgreSQL database
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgres')) {
      logger.debug('Detected PostgreSQL database');
      // return 'postgres'; // TODO: Implement PostgreSQL store
      logger.warn('PostgreSQL store not yet implemented, falling back to hybrid');
      return 'hybrid';
    }

    // 4. Redis
    if (process.env.REDIS_URL) {
      logger.debug('Detected Redis');
      // return 'redis'; // TODO: Implement Redis store
      logger.warn('Redis store not yet implemented, falling back to hybrid');
      return 'hybrid';
    }

    // 5. Production without persistence (not recommended)
    if (process.env.NODE_ENV === 'production') {
      logger.warn(
        'Production environment detected but no persistent storage configured. ' +
        'Consider setting up Vercel KV, PostgreSQL, or Redis for production deployments.'
      );
      return 'memory'; // Fallback, but log warning
    }

    // 6. Development (default)
    logger.debug('Using hybrid store for development');
    return 'hybrid';
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
    const filePath = options.filePath ?? process.env.DCR_FILE_PATH ?? './data/oauth-clients.json';

    return new FileClientStore(filePath, {
      defaultSecretExpirySeconds: options.defaultSecretExpirySeconds,
      maxClients: options.maxClients,
    });
  }

  /**
   * Create a hybrid (memory + file) client store
   */
  private static createHybridStore(options: ClientStoreFactoryOptions): HybridClientStore {
    const filePath = options.filePath ?? process.env.DCR_FILE_PATH ?? './data/oauth-clients.json';

    return new HybridClientStore({
      filePath,
      defaultSecretExpirySeconds: options.defaultSecretExpirySeconds,
      enableAutoCleanup: options.enableAutoCleanup,
      maxClients: options.maxClients,
      debounceMs: 1000, // 1 second debounce for writes
      enablePeriodicSync: true,
      syncIntervalMs: 5 * 60 * 1000, // 5 minutes
    });
  }

  /**
   * Create a Vercel KV client store
   */
  private static createVercelKVStore(options: ClientStoreFactoryOptions): VercelKVClientStore {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      throw new Error(
        'Vercel KV credentials not found. Ensure KV storage is configured:\n' +
        '1. Run `vercel link` in your project\n' +
        '2. Add Vercel KV via dashboard or CLI\n' +
        '3. Ensure KV_REST_API_URL and KV_REST_API_TOKEN are set'
      );
    }

    return new VercelKVClientStore({
      defaultSecretExpirySeconds: options.defaultSecretExpirySeconds,
      maxClients: options.maxClients,
    });
  }

  /**
   * Get configuration from environment variables
   */
  static getOptionsFromEnvironment(): ClientStoreFactoryOptions {
    return {
      storeType: (process.env.DCR_STORE_TYPE as ClientStoreType) ?? 'auto',
      filePath: process.env.DCR_FILE_PATH,
      defaultSecretExpirySeconds: process.env.DCR_DEFAULT_SECRET_EXPIRY
        ? parseInt(process.env.DCR_DEFAULT_SECRET_EXPIRY, 10)
        : undefined,
      enableAutoCleanup: process.env.DCR_ENABLE_AUTO_CLEANUP === 'true',
      maxClients: process.env.DCR_MAX_CLIENTS
        ? parseInt(process.env.DCR_MAX_CLIENTS, 10)
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