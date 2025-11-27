/**
 * Session Manager Factory
 *
 * Automatic detection and creation of appropriate SessionManager implementation
 * based on MCPInstanceManager configuration.
 *
 * Decision Logic:
 * - If instanceManager has metadataStore (Redis configured) → RedisSessionManager
 * - Otherwise → MemorySessionManager
 *
 * This provides transparent switching between memory and Redis based on environment
 * configuration (REDIS_URL presence), following the same auto-detection pattern
 * used by MCPInstanceManager.createAsync().
 */

import { logger } from '@mcp-typescript-simple/observability';
import type { MCPSessionMetadataStore } from '@mcp-typescript-simple/persistence';
import type { MCPInstanceManager } from '../server/mcp-instance-manager.js';
import type { SessionManager } from './session-manager.js';
import { MemorySessionManager } from './memory-session-manager.js';
import { RedisSessionManager } from './redis-session-manager.js';

/**
 * Create appropriate SessionManager based on instanceManager configuration
 *
 * @param instanceManager - MCP instance manager (contains metadataStore)
 * @returns SessionManager implementation (Memory or Redis)
 */
export function createSessionManager(instanceManager: MCPInstanceManager): SessionManager {
  // Check if instanceManager has metadataStore (Redis mode)
  const metadataStore = (instanceManager as Record<string, unknown>).metadataStore as
    | MCPSessionMetadataStore
    | undefined;

  if (metadataStore) {
    // Redis mode - metadataStore is available (RedisMCPMetadataStore or CachingMCPMetadataStore)
    logger.info('Creating RedisSessionManager', {
      storeType: metadataStore.constructor.name,
    });
    return new RedisSessionManager(metadataStore);
  } else {
    // Memory mode - no metadataStore (STDIO mode or no Redis configured)
    logger.info('Creating MemorySessionManager');
    return new MemorySessionManager();
  }
}

/**
 * Alternative: Create SessionManager directly from metadataStore
 *
 * This is useful when you already have a metadataStore instance
 * and don't need to go through instanceManager.
 *
 * @param metadataStore - MCPSessionMetadataStore instance (or undefined for memory)
 * @returns SessionManager implementation (Memory or Redis)
 */
export function createSessionManagerFromStore(metadataStore?: MCPSessionMetadataStore): SessionManager {
  if (metadataStore) {
    logger.info('Creating RedisSessionManager', {
      storeType: metadataStore.constructor.name,
    });
    return new RedisSessionManager(metadataStore);
  } else {
    logger.info('Creating MemorySessionManager');
    return new MemorySessionManager();
  }
}
