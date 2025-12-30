/**
 * Base Store Factory Utility
 *
 * Provides shared factory pattern implementation to eliminate duplication
 * across PKCE, Session, OAuth Token, Token, and MCP Metadata store factories.
 *
 * This utility extracts the common create() pattern used by all factories:
 * 1. Auto-detection when type is 'auto'
 * 2. Switch-based store creation for explicit types
 * 3. Consistent error handling for unknown types
 */

export type StoreType = 'auto' | 'memory' | 'redis' | 'file';

export interface BaseStoreFactoryOptions {
  type?: StoreType;
}

/**
 * Factory method implementations required by concrete factories
 */
export interface StoreFactoryMethods<T> {
  createAutoDetected(): T | Promise<T>;
  createMemoryStore(): T | Promise<T>;
  createRedisStore(): T | Promise<T>;
  createFileStore?(_options?: unknown): T | Promise<T>;
}

/**
 * Generic factory create pattern (sync/async)
 *
 * Implements the common factory pattern used across all store factories:
 * - Auto-detection when type is 'auto'
 * - Switch-based store creation for explicit types
 * - Consistent error handling
 * - Support for both sync and async factory methods
 *
 * @param options - Factory options including store type
 * @param methods - Implementation methods for creating specific store types
 * @param storeName - Store type name for error messages (e.g., 'PKCE', 'session')
 * @param fileOptions - Optional file store options (passed to createFileStore if provided)
 * @returns Created store instance (or Promise if any method is async)
 */
export function createStore<T>(
  options: BaseStoreFactoryOptions,
  methods: StoreFactoryMethods<T>,
  storeName: string,
  fileOptions?: unknown
): T | Promise<T> {
  const storeType = options.type ?? 'auto';

  if (storeType === 'auto') {
    return methods.createAutoDetected();
  }

  switch (storeType) {
    case 'memory':
      return methods.createMemoryStore();

    case 'redis':
      return methods.createRedisStore();

    case 'file':
      if (!methods.createFileStore) {
        throw new Error(`File store not supported for ${storeName} store`);
      }
      return methods.createFileStore(fileOptions);

    default:
      throw new Error(`Unknown ${storeName} store type: ${storeType}`);
  }
}
