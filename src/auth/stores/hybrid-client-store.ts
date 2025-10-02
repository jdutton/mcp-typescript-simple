/**
 * Hybrid OAuth Client Store (Memory + File)
 *
 * Combines the best of both worlds:
 * - Fast in-memory access (no I/O on read)
 * - Persistence across restarts (file backup)
 *
 * Perfect for development environments where you want:
 * - Quick iteration (no database setup)
 * - Restart tolerance (don't lose test data)
 * - Easy debugging (inspect JSON file)
 *
 * Write strategy:
 * - Synchronous writes to memory (immediate)
 * - Asynchronous writes to file (background, non-blocking)
 * - File writes are debounced to avoid excessive I/O
 *
 * Read strategy:
 * - All reads from memory (fast)
 * - File loaded once on startup
 */

import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  OAuthRegisteredClientsStore,
  ClientStoreOptions,
  ExtendedOAuthClientInformation,
} from './client-store-interface.js';
import { InMemoryClientStore } from './memory-client-store.js';
import { FileClientStore } from './file-client-store.js';
import { logger } from '../../utils/logger.js';

export interface HybridClientStoreOptions extends ClientStoreOptions {
  /** File path for persistence */
  filePath?: string;

  /** Debounce delay for file writes (ms) */
  debounceMs?: number;

  /** Enable periodic file sync (in addition to writes) */
  enablePeriodicSync?: boolean;

  /** Periodic sync interval (ms) */
  syncIntervalMs?: number;
}

export class HybridClientStore implements OAuthRegisteredClientsStore {
  private memoryStore: InMemoryClientStore;
  private fileStore: FileClientStore;
  private writeTimer?: NodeJS.Timeout;
  private syncTimer?: NodeJS.Timeout;
  private pendingWrites = false;
  private debounceMs: number;
  private exitHandler?: () => void;

  constructor(options: HybridClientStoreOptions = {}) {
    const filePath = options.filePath ?? './data/oauth-clients.json';
    this.debounceMs = options.debounceMs ?? 1000; // 1 second debounce
    const syncIntervalMs = options.syncIntervalMs ?? 5 * 60 * 1000; // 5 minutes

    logger.info('HybridClientStore initializing', {
      filePath,
      debounceMs: this.debounceMs,
      enablePeriodicSync: options.enablePeriodicSync,
    });

    // Initialize file store first (loads existing clients synchronously)
    this.fileStore = new FileClientStore(filePath, options);

    // Initialize memory store (empty initially)
    this.memoryStore = new InMemoryClientStore({
      ...options,
      enableAutoCleanup: false, // We'll handle cleanup ourselves
    });

    // Copy clients from file store to memory store (synchronous)
    this.loadFromFileToMemorySync();

    // Start periodic sync if enabled
    if (options.enablePeriodicSync) {
      this.startPeriodicSync(syncIntervalMs);
    }

    // Register exit handler
    this.exitHandler = () => this.dispose();
    process.on('exit', this.exitHandler);

    logger.info('HybridClientStore initialized', {
      clientCount: this.memoryStore.getClientCount(),
    });
  }

  /**
   * Load all clients from file store to memory store (synchronous)
   */
  private loadFromFileToMemorySync(): void {
    try {
      // Use proper accessor method instead of any cast
      const fileStoreClients = this.fileStore.getAllClients();
      for (const [clientId, client] of fileStoreClients.entries()) {
        // Use proper setter method instead of any cast
        this.memoryStore.setClient(clientId, client);
      }
      logger.debug('Clients loaded from file to memory', {
        count: fileStoreClients.size,
      });
    } catch (error) {
      logger.error('Failed to load clients from file to memory', error);
    }
  }

  /**
   * Schedule a debounced file write
   */
  private scheduleWrite(): void {
    this.pendingWrites = true;

    // Clear existing timer
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
    }

    // Schedule new write
    this.writeTimer = setTimeout(async () => {
      await this.syncToFile();
    }, this.debounceMs);
  }

  /**
   * Sync memory store to file store
   */
  private async syncToFile(): Promise<void> {
    if (!this.pendingWrites) {
      return;
    }

    try {
      const clients = await this.memoryStore.listClients();

      // Use proper methods instead of any casts
      const fileClients = this.fileStore.getAllClients();

      // Remove clients that no longer exist in memory
      for (const clientId of fileClients.keys()) {
        if (!clients.some(c => c.client_id === clientId)) {
          await this.fileStore.deleteClient(clientId);
        }
      }

      // Add or update clients from memory
      for (const client of clients) {
        this.fileStore.setClient(client.client_id, client as ExtendedOAuthClientInformation);
      }

      // Persist to file using proper save method
      await this.fileStore.save();

      this.pendingWrites = false;
      logger.debug('Memory store synced to file', {
        count: clients.length,
      });
    } catch (error) {
      logger.error('Failed to sync memory store to file', error);
    }
  }

  /**
   * Start periodic background sync
   */
  private startPeriodicSync(intervalMs: number): void {
    this.syncTimer = setInterval(async () => {
      if (this.pendingWrites) {
        await this.syncToFile();
      }
    }, intervalMs);

    logger.debug('Periodic sync started', { intervalMs });
  }

  /**
   * Stop periodic sync
   */
  private stopPeriodicSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
      logger.debug('Periodic sync stopped');
    }
  }

  // OAuthRegisteredClientsStore implementation

  async registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
  ): Promise<OAuthClientInformationFull> {
    // Register in memory (fast)
    const fullClient = await this.memoryStore.registerClient(client);

    // Schedule file write (background, debounced)
    this.scheduleWrite();

    return fullClient;
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    // Always read from memory (fast, no I/O)
    return this.memoryStore.getClient(clientId);
  }

  async deleteClient(clientId: string): Promise<boolean> {
    const result = await this.memoryStore.deleteClient(clientId);

    if (result) {
      // Schedule file write to persist deletion
      this.scheduleWrite();
    }

    return result;
  }

  async listClients(): Promise<OAuthClientInformationFull[]> {
    return this.memoryStore.listClients();
  }

  async cleanupExpired(): Promise<number> {
    const count = await this.memoryStore.cleanupExpired();

    if (count > 0) {
      // Schedule file write to persist cleanup
      this.scheduleWrite();
    }

    return count;
  }

  /**
   * Force immediate sync to file (e.g., before shutdown)
   */
  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
    }
    await this.syncToFile();
    logger.info('Hybrid store flushed to file');
  }

  /**
   * Dispose of resources and flush pending writes
   */
  async dispose(): Promise<void> {
    this.stopPeriodicSync();

    // Remove exit handler
    if (this.exitHandler) {
      process.off('exit', this.exitHandler);
      this.exitHandler = undefined;
    }

    // Flush any pending writes
    await this.flush();

    this.memoryStore.dispose();
    this.fileStore.dispose();

    logger.info('HybridClientStore disposed');
  }
}