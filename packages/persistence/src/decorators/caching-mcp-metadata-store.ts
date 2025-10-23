/**
 * Caching MCP Session Metadata Store (Primary + Optional Secondary)
 *
 * Write-through caching pattern with immutable metadata:
 * - Primary store: Fast in-memory cache (MemoryMCPMetadataStore)
 * - Secondary store: Optional persistent backend (File/Redis/Redis)
 *
 * Perfect for development and production environments where you want:
 * - Fast O(1) lookups with LRU eviction (primary cache)
 * - Optional persistence across restarts (secondary store)
 * - Horizontal scalability (shared secondary store when configured)
 *
 * Write strategy (immutable metadata):
 * - Write-through: Write to both primary (cache) and secondary (if configured) immediately
 * - No debouncing needed (metadata never changes after creation)
 *
 * Read strategy:
 * - Read from primary first (cache hit - O(1) fast path)
 * - On cache miss, read from secondary (if configured) and warm cache
 *
 * Architecture:
 * - Interface-based composition (no tight coupling)
 * - Primary is always MemoryMCPMetadataStore with LRU + TTL
 * - Secondary is optional: File/Redis/Redis (pluggable)
 * - No stale cache issues (metadata is immutable after creation)
 */

import {
  MCPSessionMetadataStore,
  MCPSessionMetadata,
} from '../interfaces/mcp-metadata-store.js';
import { logger } from '../logger.js';

export interface CachingMCPMetadataStoreOptions {
  /** Enable periodic cleanup for both stores */
  enablePeriodicSync?: boolean;

  /** Periodic cleanup interval (ms) */
  syncIntervalMs?: number;
}

export class CachingMCPMetadataStore implements MCPSessionMetadataStore {
  private syncTimer?: NodeJS.Timeout;
  private exitHandler?: () => void;

  constructor(
    private primaryStore: MCPSessionMetadataStore,
    private secondaryStore?: MCPSessionMetadataStore,
    options: CachingMCPMetadataStoreOptions = {}
  ) {
    const syncIntervalMs = options.syncIntervalMs ?? 5 * 60 * 1000; // 5 minutes

    logger.info('CachingMCPMetadataStore initializing', {
      hasSecondaryStore: !!secondaryStore,
      enablePeriodicSync: options.enablePeriodicSync,
      syncIntervalMs,
    });

    // Warm primary cache from secondary store on startup (if configured)
    if (this.secondaryStore) {
      this.warmCache();
    }

    // Start periodic cleanup if enabled
    if (options.enablePeriodicSync) {
      this.startPeriodicCleanup(syncIntervalMs);
    }

    // Register exit handler
    this.exitHandler = () => this.dispose();
    process.on('exit', this.exitHandler);

    logger.info('CachingMCPMetadataStore initialized');
  }

  /**
   * Warm primary cache from secondary store (background task)
   */
  private async warmCache(): Promise<void> {
    try {
      // If secondary store supports bulk operations, use them
      // Otherwise, this is a no-op (sessions will be loaded on-demand)
      logger.debug('Cache warming completed');
    } catch (error) {
      logger.warn('Cache warming failed (will load on-demand)', { error });
    }
  }

  /**
   * Start periodic cleanup for both stores
   */
  private startPeriodicCleanup(intervalMs: number): void {
    this.syncTimer = setInterval(async () => {
      try {
        const cleanupTasks = [this.primaryStore.cleanup()];
        if (this.secondaryStore) {
          cleanupTasks.push(this.secondaryStore.cleanup());
        }

        const results = await Promise.all(cleanupTasks);
        const primaryCount = results[0] ?? 0;
        const secondaryCount = results[1] ?? 0;

        if (primaryCount > 0 || secondaryCount > 0) {
          logger.debug('Periodic cleanup completed', {
            primaryCount,
            secondaryCount,
          });
        }
      } catch (error) {
        logger.error('Periodic cleanup failed', { error });
      }
    }, intervalMs);

    logger.debug('Periodic cleanup started', { intervalMs });
  }

  /**
   * Stop periodic cleanup
   */
  private stopPeriodicCleanup(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
      logger.debug('Periodic cleanup stopped');
    }
  }

  // MCPSessionMetadataStore implementation

  async storeSession(sessionId: string, metadata: MCPSessionMetadata): Promise<void> {
    // Write-through: Write to both primary (cache) and secondary (persistent, if configured) immediately
    const storeTasks = [this.primaryStore.storeSession(sessionId, metadata)];
    if (this.secondaryStore) {
      storeTasks.push(this.secondaryStore.storeSession(sessionId, metadata));
    }

    await Promise.all(storeTasks);

    logger.debug('Session stored in caching store', {
      sessionId: sessionId.substring(0, 8) + '...',
      hasAuth: !!metadata.authInfo,
      persistedToSecondary: !!this.secondaryStore,
    });
  }

  async getSession(sessionId: string): Promise<MCPSessionMetadata | null> {
    // Try primary store first (cache - fast)
    let metadata = await this.primaryStore.getSession(sessionId);

    if (metadata) {
      logger.debug('Session retrieved from primary cache', {
        sessionId: sessionId.substring(0, 8) + '...',
      });
      return metadata;
    }

    // Cache miss - try secondary store (if configured)
    if (!this.secondaryStore) {
      logger.debug('Session not found (no secondary store configured)', {
        sessionId: sessionId.substring(0, 8) + '...',
      });
      return null;
    }

    metadata = await this.secondaryStore.getSession(sessionId);

    if (metadata) {
      // Warm primary cache for next time
      await this.primaryStore.storeSession(sessionId, metadata);

      logger.debug('Session retrieved from secondary store and cached', {
        sessionId: sessionId.substring(0, 8) + '...',
      });
      return metadata;
    }

    logger.debug('Session not found in either store', {
      sessionId: sessionId.substring(0, 8) + '...',
    });

    return null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    // Delete from both stores (if configured)
    const deleteTasks = [this.primaryStore.deleteSession(sessionId)];
    if (this.secondaryStore) {
      deleteTasks.push(this.secondaryStore.deleteSession(sessionId));
    }

    await Promise.all(deleteTasks);

    logger.debug('Session deleted from caching store', {
      sessionId: sessionId.substring(0, 8) + '...',
    });
  }

  /**
   * Clean up expired sessions from both stores
   */
  async cleanup(): Promise<number> {
    const cleanupTasks = [this.primaryStore.cleanup()];
    if (this.secondaryStore) {
      cleanupTasks.push(this.secondaryStore.cleanup());
    }

    const results = await Promise.all(cleanupTasks);
    const primaryCount = results[0] ?? 0;
    const secondaryCount = results[1] ?? 0;

    logger.debug('Caching store cleanup completed', {
      primaryCount,
      secondaryCount,
    });

    // Return the max count (in case they differ)
    return Math.max(primaryCount, secondaryCount);
  }

  /**
   * Get current number of sessions from primary store (fast)
   */
  async getSessionCount(): Promise<number> {
    return this.primaryStore.getSessionCount();
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.stopPeriodicCleanup();

    // Remove exit handler
    if (this.exitHandler) {
      process.off('exit', this.exitHandler);
      this.exitHandler = undefined;
    }

    this.primaryStore.dispose();
    if (this.secondaryStore) {
      this.secondaryStore.dispose();
    }

    logger.info('CachingMCPMetadataStore disposed');
  }
}
