/**
 * Vercel KV OAuth Client Store
 *
 * Uses Vercel KV (Redis-compatible) for client storage. Perfect for:
 * - Vercel serverless deployments
 * - Multi-instance production environments
 * - Global edge network deployments
 *
 * Features:
 * - Serverless-native (no connection pools)
 * - Auto-scaling with traffic
 * - Global replication (low latency worldwide)
 * - TTL support (automatic secret expiration)
 * - Multi-instance safe (shared state)
 *
 * Setup:
 * 1. Run `vercel link` in your project
 * 2. Add Vercel KV storage via dashboard or CLI
 * 3. Environment variables are auto-configured:
 *    - KV_REST_API_URL
 *    - KV_REST_API_TOKEN
 */

import { kv } from '@vercel/kv';
import { randomUUID, randomBytes } from 'crypto';
import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  OAuthRegisteredClientsStore,
  ExtendedOAuthClientInformation,
  ClientStoreOptions,
} from './client-store-interface.js';
import { logger } from '../../utils/logger.js';

const KV_PREFIX = 'oauth:client:';
const KV_INDEX_KEY = 'oauth:clients:index';

export class VercelKVClientStore implements OAuthRegisteredClientsStore {
  constructor(private options: ClientStoreOptions = {}) {
    // Set defaults
    this.options.defaultSecretExpirySeconds =
      options.defaultSecretExpirySeconds ?? 30 * 24 * 60 * 60; // 30 days
    this.options.maxClients = options.maxClients ?? 10000;

    logger.info('VercelKVClientStore initialized', {
      defaultSecretExpiry: this.options.defaultSecretExpirySeconds,
      maxClients: this.options.maxClients,
      kvConfigured: !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
    });

    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      logger.warn(
        'Vercel KV credentials not found. Run `vercel link` and ensure KV storage is configured.'
      );
    }
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
  ): Promise<OAuthClientInformationFull> {
    try {
      // Check max clients limit
      const currentCount = await kv.scard(KV_INDEX_KEY);
      if (currentCount >= this.options.maxClients!) {
        logger.warn('Client registration failed: max clients limit reached', {
          currentCount,
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
      const fullClient: ExtendedOAuthClientInformation = {
        ...client,
        client_id: clientId,
        client_secret: clientSecret,
        client_id_issued_at: issuedAt,
        client_secret_expires_at: expiresAt,
        registered_at: Date.now(),
      };

      // Store in KV
      const key = `${KV_PREFIX}${clientId}`;

      if (expiresAt) {
        // Set with TTL (automatic expiration)
        const ttl = expiresAt - issuedAt;
        await kv.setex(key, ttl, JSON.stringify(fullClient));
      } else {
        // Set without expiration
        await kv.set(key, JSON.stringify(fullClient));
      }

      // Add to index set for listing
      await kv.sadd(KV_INDEX_KEY, clientId);

      logger.info('Client registered in Vercel KV', {
        clientId,
        clientName: client.client_name,
        redirectUris: client.redirect_uris,
        expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : 'never',
        ttl: expiresAt ? expiresAt - issuedAt : 'none',
      });

      return fullClient;
    } catch (error) {
      logger.error('Failed to register client in Vercel KV', error);
      throw error;
    }
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    try {
      const key = `${KV_PREFIX}${clientId}`;
      const data = await kv.get<string>(key);

      if (!data) {
        logger.debug('Client not found in Vercel KV', { clientId });
        return undefined;
      }

      const client: ExtendedOAuthClientInformation = JSON.parse(data);

      logger.debug('Client retrieved from Vercel KV', {
        clientId,
        clientName: client.client_name,
      });

      return client;
    } catch (error) {
      logger.error('Failed to get client from Vercel KV', { clientId, error });
      throw error;
    }
  }

  async deleteClient(clientId: string): Promise<boolean> {
    try {
      const key = `${KV_PREFIX}${clientId}`;

      // Check if client exists
      const exists = await kv.exists(key);
      if (!exists) {
        logger.debug('Client delete failed: not found in Vercel KV', { clientId });
        return false;
      }

      // Delete from KV and index
      await Promise.all([
        kv.del(key),
        kv.srem(KV_INDEX_KEY, clientId),
      ]);

      logger.info('Client deleted from Vercel KV', { clientId });
      return true;
    } catch (error) {
      logger.error('Failed to delete client from Vercel KV', { clientId, error });
      throw error;
    }
  }

  async listClients(): Promise<OAuthClientInformationFull[]> {
    try {
      // Get all client IDs from index
      const clientIds = await kv.smembers(KV_INDEX_KEY) as string[];

      if (!clientIds || clientIds.length === 0) {
        return [];
      }

      // Fetch all clients in parallel
      const keys = clientIds.map((id: string) => `${KV_PREFIX}${id}`);
      const results = await kv.mget(...keys) as (string | null)[];

      // Filter out null values (expired clients) and parse
      const clients: OAuthClientInformationFull[] = [];
      const expiredIds: string[] = [];

      for (let i = 0; i < results.length; i++) {
        if (results[i]) {
          clients.push(JSON.parse(results[i]!));
        } else {
          // Client expired but still in index
          expiredIds.push(clientIds[i]!);
        }
      }

      // Clean up expired client IDs from index
      if (expiredIds.length > 0) {
        await kv.srem(KV_INDEX_KEY, ...expiredIds);
        logger.debug('Removed expired clients from index', {
          count: expiredIds.length,
        });
      }

      logger.debug('Listed clients from Vercel KV', {
        count: clients.length,
        expiredRemoved: expiredIds.length,
      });

      return clients;
    } catch (error) {
      logger.error('Failed to list clients from Vercel KV', error);
      throw error;
    }
  }

  async cleanupExpired(): Promise<number> {
    try {
      // Get all client IDs from index
      const clientIds = await kv.smembers(KV_INDEX_KEY) as string[];

      if (!clientIds || clientIds.length === 0) {
        return 0;
      }

      // Check which clients still exist (non-expired)
      const keys = clientIds.map((id: string) => `${KV_PREFIX}${id}`);
      const exists = await Promise.all(keys.map((key: string) => kv.exists(key)));

      // Find expired clients (in index but not in KV)
      const expiredIds: string[] = [];
      for (let i = 0; i < clientIds.length; i++) {
        if (!exists[i]) {
          expiredIds.push(clientIds[i]!);
        }
      }

      // Remove expired client IDs from index
      if (expiredIds.length > 0) {
        await kv.srem(KV_INDEX_KEY, ...expiredIds);
        logger.info('Expired clients cleaned up from Vercel KV', {
          count: expiredIds.length,
        });
      }

      return expiredIds.length;
    } catch (error) {
      logger.error('Failed to cleanup expired clients from Vercel KV', error);
      throw error;
    }
  }

  /**
   * Get current number of registered clients
   */
  async getClientCount(): Promise<number> {
    try {
      return await kv.scard(KV_INDEX_KEY);
    } catch (error) {
      logger.error('Failed to get client count from Vercel KV', error);
      return 0;
    }
  }

  /**
   * Clear all clients (testing only - use with caution!)
   */
  async clear(): Promise<void> {
    try {
      const clientIds = await kv.smembers(KV_INDEX_KEY) as string[];

      if (!clientIds || clientIds.length === 0) {
        return;
      }

      // Delete all client keys
      const keys = clientIds.map((id: string) => `${KV_PREFIX}${id}`);
      await kv.del(...keys, KV_INDEX_KEY);

      logger.warn('All clients cleared from Vercel KV', { count: clientIds.length });
    } catch (error) {
      logger.error('Failed to clear clients from Vercel KV', error);
      throw error;
    }
  }
}