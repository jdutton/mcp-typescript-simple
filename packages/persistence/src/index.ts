/**
 * @mcp-typescript-simple/persistence
 *
 * Pluggable persistence layer for MCP servers with memory, file, and Redis support.
 *
 * This package provides a comprehensive storage abstraction layer for OAuth sessions,
 * tokens, registered clients, PKCE data, and MCP session metadata.
 *
 * ## Features
 * - **Multiple backends**: Memory (development), File (persistent), Redis (production)
 * - **Auto-detection**: Automatically selects appropriate backend based on environment
 * - **Factory pattern**: Simple creation with sensible defaults
 * - **Type-safe**: Full TypeScript support with strict typing
 * - **Optional logging**: Inject your own logger or use silent mode
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   SessionStoreFactory,
 *   OAuthTokenStoreFactory,
 *   ClientStoreFactory,
 *   setLogger,
 * } from '@mcp-typescript-simple/persistence';
 *
 * // Optional: Inject logger
 * setLogger(myLogger);
 *
 * // Create stores with auto-detection
 * const sessionStore = SessionStoreFactory.create();
 * const tokenStore = OAuthTokenStoreFactory.create();
 * const clientStore = ClientStoreFactory.create();
 * ```
 *
 * ## Storage Backends
 *
 * ### Memory
 * - Fast, ephemeral storage
 * - Suitable for development and testing
 * - Data lost on server restart
 *
 * ### File
 * - Persistent JSON file storage
 * - Suitable for single-instance deployments
 * - Data survives server restarts
 *
 * ### Redis
 * - Distributed, scalable storage
 * - Suitable for production and serverless
 * - Requires REDIS_URL environment variable
 */

// ============================================================================
// Type Definitions
// ============================================================================

export * from './types.js';

// ============================================================================
// Store Interfaces
// ============================================================================

export * from './interfaces/session-store.js';
export * from './interfaces/oauth-token-store.js';
export * from './interfaces/client-store.js';
export * from './interfaces/token-store.js';
export * from './interfaces/pkce-store.js';
export * from './interfaces/mcp-metadata-store.js';

// ============================================================================
// Factory Functions (Recommended API)
// ============================================================================

export * from './factories/session-store-factory.js';
export * from './factories/oauth-token-store-factory.js';
export * from './factories/client-store-factory.js';
export * from './factories/token-store-factory.js';
export * from './factories/pkce-store-factory.js';
export * from './factories/mcp-metadata-store-factory.js';

// ============================================================================
// Store Implementations (Advanced Use Cases)
// ============================================================================

// Memory stores
export * from './stores/memory/memory-session-store.js';
export * from './stores/memory/memory-oauth-token-store.js';
export * from './stores/memory/memory-client-store.js';
// Note: InMemoryTestTokenStore is in test/helpers/ - not exported from public API
export * from './stores/memory/memory-pkce-store.js';
export * from './stores/memory/memory-mcp-metadata-store.js';

// File stores
export * from './stores/file/file-oauth-token-store.js';
export * from './stores/file/file-client-store.js';
export * from './stores/file/file-token-store.js';
export * from './stores/file/file-mcp-metadata-store.js';

// Redis stores
export * from './stores/redis/redis-session-store.js';
export * from './stores/redis/redis-oauth-token-store.js';
export * from './stores/redis/redis-client-store.js';
export * from './stores/redis/redis-token-store.js';
export * from './stores/redis/redis-pkce-store.js';
export * from './stores/redis/redis-mcp-metadata-store.js';

// ============================================================================
// Store Decorators
// ============================================================================

export * from './decorators/caching-mcp-metadata-store.js';
export * from './decorators/event-store.js';

// ============================================================================
// Logger Interface
// ============================================================================

export * from './logger.js';

// ============================================================================
// Utilities
// ============================================================================

export * from './utils/data-paths.js';
