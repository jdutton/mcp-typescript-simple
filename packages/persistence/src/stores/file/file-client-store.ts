/**
 * File-Based OAuth Client Store
 *
 * Persists OAuth clients to a JSON file on disk. Suitable for:
 * - Development with restart tolerance
 * - Single-instance deployments
 * - Self-hosted servers with local filesystem
 *
 * Features:
 * - Survives server restarts
 * - Atomic writes (write to temp file, then rename)
 * - Automatic backup on write
 * - JSON format for easy inspection/debugging
 *
 * Limitations:
 * - Not suitable for multi-instance deployments (race conditions)
 * - Not suitable for serverless (ephemeral filesystem)
 * - Performance degrades with many clients (full file read/write)
 */

import { promises as fs, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  OAuthRegisteredClientsStore,
  ExtendedOAuthClientInformation,
  ClientStoreOptions,
} from '../../interfaces/client-store.js';
import { logger } from '../../logger.js';

interface PersistedClientData {
  version: number;
  updatedAt: string;
  clients: ExtendedOAuthClientInformation[];
}

export class FileClientStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, ExtendedOAuthClientInformation>();
  private readonly filePath: string;
  private readonly backupPath: string;
  private writePromise: Promise<void> = Promise.resolve();

  constructor(
    filePath: string = './data/oauth-clients.json',
    private options: ClientStoreOptions = {}
  ) {
    this.filePath = filePath;
    this.backupPath = `${filePath}.backup`;

    // Set defaults
    this.options.defaultSecretExpirySeconds =
      options.defaultSecretExpirySeconds ?? 30 * 24 * 60 * 60; // 30 days
    this.options.maxClients = options.maxClients ?? 10000;

    logger.info('FileClientStore initializing', {
      filePath: this.filePath,
      defaultSecretExpiry: this.options.defaultSecretExpirySeconds,
    });

    // Load existing clients synchronously during construction
    this.loadSync();
  }

  /**
   * Load clients from file (synchronous for constructor)
   */
  private loadSync(): void {
    try {
      const data = readFileSync(this.filePath, 'utf8');
      const parsed: PersistedClientData = JSON.parse(data);

      if (parsed.version !== 1) {
        throw new Error(`Unsupported file version: ${parsed.version}`);
      }

      for (const client of parsed.clients) {
        this.clients.set(client.client_id, client);
      }

      logger.info('Clients loaded from file', {
        count: this.clients.size,
        updatedAt: parsed.updatedAt,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info('No existing client file found, starting fresh');
      } else {
        logger.error('Failed to load clients from file', error as Record<string, any>);
        throw error;
      }
    }
  }

  /**
   * Save clients to file (asynchronous, atomic)
   * Made public for internal use sync
   */
  async save(): Promise<void> {
    // Serialize write operations to prevent concurrent writes
    this.writePromise = this.writePromise.then(() => this.doSave());
    return this.writePromise;
  }

  private async doSave(): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(dirname(this.filePath), { recursive: true });

      // Prepare data
      const data: PersistedClientData = {
        version: 1,
        updatedAt: new Date().toISOString(),
        clients: Array.from(this.clients.values()),
      };

      // Write to temporary file first (atomic write)
      const tempPath = `${this.filePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');

      // Backup existing file if it exists
      try {
        await fs.copyFile(this.filePath, this.backupPath);
      } catch (error) {
        // Ignore if file doesn't exist yet
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // Rename temp file to actual file (atomic on POSIX systems)
      await fs.rename(tempPath, this.filePath);

      logger.debug('Clients saved to file', {
        count: this.clients.size,
        filePath: this.filePath,
      });
    } catch (error) {
      logger.error('Failed to save clients to file', error as Record<string, any>);
      throw error;
    }
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
  ): Promise<OAuthClientInformationFull> {
    // Check max clients limit
    if (this.clients.size >= this.options.maxClients!) {
      logger.warn('Client registration failed: max clients limit reached', {
        currentCount: this.clients.size,
        maxClients: this.options.maxClients,
      });
      throw new Error(
        `Maximum number of registered clients reached (${this.options.maxClients})`
      );
    }

    // Generate client credentials
    const clientId = randomUUID();
    const clientSecret = randomBytes(32).toString('base64url');
    const issuedAt = Math.floor(Date.now() / 1000);

    // Calculate expiration
    let expiresAt: number | undefined;
    if (this.options.defaultSecretExpirySeconds! > 0) {
      expiresAt = issuedAt + this.options.defaultSecretExpirySeconds!;
    }

    // Create full client information
    const fullClient: OAuthClientInformationFull = {
      ...client,
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: issuedAt,
      client_secret_expires_at: expiresAt,
    };

    // Store in memory and persist to file
    this.clients.set(clientId, fullClient as ExtendedOAuthClientInformation);
    await this.save();

    logger.info('Client registered and persisted', {
      clientId,
      clientName: client.client_name,
      redirectUris: client.redirect_uris,
      expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : 'never',
    });

    return fullClient;
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const client = this.clients.get(clientId);

    if (!client) {
      logger.debug('Client not found', { clientId });
      return undefined;
    }

    logger.debug('Client retrieved', {
      clientId,
      clientName: client.client_name,
    });

    return client;
  }

  async deleteClient(clientId: string): Promise<boolean> {
    const existed = this.clients.delete(clientId);

    if (existed) {
      await this.save();
      logger.info('Client deleted and persisted', { clientId });
    } else {
      logger.debug('Client delete failed: not found', { clientId });
    }

    return existed;
  }

  async listClients(): Promise<OAuthClientInformationFull[]> {
    return Array.from(this.clients.values());
  }

  async cleanupExpired(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    let cleanedCount = 0;

    for (const [clientId, client] of this.clients.entries()) {
      if (
        client.client_secret_expires_at &&
        client.client_secret_expires_at <= now
      ) {
        this.clients.delete(clientId);
        cleanedCount++;
        logger.debug('Expired client cleaned up', {
          clientId,
          expiredAt: new Date(client.client_secret_expires_at * 1000).toISOString(),
        });
      }
    }

    if (cleanedCount > 0) {
      await this.save();
      logger.info('Expired clients cleanup completed and persisted', {
        cleanedCount,
        remainingCount: this.clients.size,
      });
    }

    return cleanedCount;
  }

  /**
   * Get current number of registered clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Reload clients from file (for manual refresh)
   */
  async reload(): Promise<void> {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsed: PersistedClientData = JSON.parse(data);

      if (parsed.version !== 1) {
        throw new Error(`Unsupported file version: ${parsed.version}`);
      }

      this.clients.clear();
      for (const client of parsed.clients) {
        this.clients.set(client.client_id, client);
      }

      logger.info('Clients reloaded from file', {
        count: this.clients.size,
        updatedAt: parsed.updatedAt,
      });
    } catch (error) {
      logger.error('Failed to reload clients from file', error as Record<string, any>);
      throw error;
    }
  }

  /**
   * Set client directly (internal use only - for internal use sync)
   * @internal
   */
  setClient(clientId: string, client: ExtendedOAuthClientInformation): void {
    this.clients.set(clientId, client);
  }

  /**
   * Get all clients as readonly map (internal use only - for internal use sync)
   * @internal
   */
  getAllClients(): ReadonlyMap<string, ExtendedOAuthClientInformation> {
    return this.clients;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.clients.clear();
    logger.info('FileClientStore disposed');
  }
}