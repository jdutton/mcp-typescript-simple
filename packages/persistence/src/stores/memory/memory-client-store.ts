/**
 * In-Memory OAuth Client Store
 *
 * Simple Map-based storage for OAuth clients. Suitable for:
 * - Development and testing
 * - Single-instance deployments
 * - Scenarios where client persistence is not required
 *
 * WARNING: All clients are lost on server restart!
 */

import { randomUUID, randomBytes } from 'node:crypto';
import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  OAuthRegisteredClientsStore,
  ExtendedOAuthClientInformation,
  ClientStoreOptions,
} from '../../interfaces/client-store.js';
import { logger } from '../../logger.js';

export class InMemoryClientStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, ExtendedOAuthClientInformation>();
  private cleanupInterval?: NodeJS.Timeout;
  private exitHandler?: () => void;

  constructor(private options: ClientStoreOptions = {}) {
    // Set defaults
    this.options.defaultSecretExpirySeconds =
      options.defaultSecretExpirySeconds ?? 30 * 24 * 60 * 60; // 30 days
    this.options.enableAutoCleanup = options.enableAutoCleanup ?? false;
    this.options.cleanupIntervalMs =
      options.cleanupIntervalMs ?? 60 * 60 * 1000; // 1 hour
    this.options.maxClients = options.maxClients ?? 10000;

    // Start automatic cleanup if enabled
    if (this.options.enableAutoCleanup) {
      this.startAutoCleanup();
    }

    logger.info('InMemoryClientStore initialized', {
      defaultSecretExpiry: this.options.defaultSecretExpirySeconds,
      autoCleanup: this.options.enableAutoCleanup,
      maxClients: this.options.maxClients,
    });
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
  ): Promise<OAuthClientInformationFull> {
    // Check max clients limit
    const maxClients = this.options.maxClients ?? 10000;
    if (this.clients.size >= maxClients) {
      logger.warn('Client registration failed: max clients limit reached', {
        currentCount: this.clients.size,
        maxClients,
      });
      throw new Error(
        `Maximum number of registered clients reached (${maxClients})`
      );
    }

    // Generate client credentials
    const clientId = randomUUID();
    const clientSecret = randomBytes(32).toString('base64url');
    const issuedAt = Math.floor(Date.now() / 1000);

    // Calculate expiration (use milliseconds internally for precision)
    let expiresAt: number | undefined;
    const defaultSecretExpirySeconds = this.options.defaultSecretExpirySeconds ?? 0;
    if (defaultSecretExpirySeconds > 0) {
      // Store as seconds for OAuth spec compliance, but check with ms precision
      expiresAt = issuedAt + defaultSecretExpirySeconds;
    }

    // Create full client information
    const fullClient: OAuthClientInformationFull = {
      ...client,
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: issuedAt,
      client_secret_expires_at: expiresAt,
    };

    // Store client
    this.clients.set(clientId, fullClient as ExtendedOAuthClientInformation);

    logger.info('Client registered successfully', {
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
      logger.info('Client deleted', { clientId });
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
      logger.info('Expired clients cleanup completed', {
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
   * Clear all clients (testing only)
   */
  clear(): void {
    const count = this.clients.size;
    this.clients.clear();
    logger.warn('All clients cleared', { count });
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
   * Start automatic cleanup of expired clients
   */
  private startAutoCleanup(): void {
    const cleanupIntervalMs = this.options.cleanupIntervalMs ?? 60 * 60 * 1000; // 1 hour default
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.cleanupExpired();
      } catch (error) {
        logger.error('Auto-cleanup failed', error as Record<string, any>);
      }
    }, cleanupIntervalMs);

    // Create exit handler and register it
    this.exitHandler = () => this.stopAutoCleanup();
    process.on('exit', this.exitHandler);

    logger.debug('Auto-cleanup started', {
      intervalMs: this.options.cleanupIntervalMs,
    });
  }

  /**
   * Stop automatic cleanup
   */
  private stopAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
      logger.debug('Auto-cleanup stopped');
    }

    // Remove exit handler if it exists
    if (this.exitHandler) {
      process.off('exit', this.exitHandler);
      this.exitHandler = undefined;
    }
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.stopAutoCleanup();
    this.clients.clear();
    logger.info('InMemoryClientStore disposed');
  }
}