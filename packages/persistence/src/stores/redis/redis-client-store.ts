/**
 * Redis OAuth Client Store
 *
 * Uses Redis for client storage. Perfect for:
 * - Multi-instance production environments
 * - Serverless deployments
 * - Any Redis-compatible infrastructure
 *
 * Features:
 * - No vendor lock-in (works with any Redis)
 * - Auto-scaling with traffic
 * - TTL support (automatic secret expiration)
 * - Multi-instance safe (shared state)
 *
 * Setup:
 * Set REDIS_URL environment variable (e.g., redis://localhost:6379)
 */

import Redis from 'ioredis';
import { randomUUID, randomBytes } from 'node:crypto';
import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  OAuthRegisteredClientsStore,
  ExtendedOAuthClientInformation,
  ClientStoreOptions,
} from '../../interfaces/client-store.js';
import { logger } from '../../logger.js';
import { maskRedisUrl } from './redis-utils.js';

const KEY_PREFIX = 'oauth:client:';
const INDEX_KEY = 'oauth:clients:index';

export class RedisClientStore implements OAuthRegisteredClientsStore {
  private redis: Redis;
  private options: ClientStoreOptions;

  constructor(redisUrl?: string, options: ClientStoreOptions = {}) {
    const url = redisUrl ?? process.env.REDIS_URL;
    if (!url) {
      throw new Error('Redis URL not configured. Set REDIS_URL environment variable.');
    }

    this.redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      lazyConnect: true,
    });

    this.redis.on('error', (error) => {
      logger.error('Redis connection error', { error });
    });

    this.redis.on('connect', () => {
      logger.info('Redis connected successfully for OAuth clients');
    });

    // Connect immediately
    // eslint-disable-next-line sonarjs/no-async-constructor
    this.redis.connect().catch((error) => {
      logger.error('Failed to connect to Redis', { error });
    });

    // Set defaults
    this.options = {
      defaultSecretExpirySeconds: options.defaultSecretExpirySeconds ?? 30 * 24 * 60 * 60, // 30 days
      maxClients: options.maxClients ?? 10000,
    };

    logger.info('RedisClientStore initialized', {
      url: maskRedisUrl(url),
      defaultSecretExpiry: this.options.defaultSecretExpirySeconds,
      maxClients: this.options.maxClients,
    });
  }

  async registerClient(
    client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
  ): Promise<OAuthClientInformationFull> {
    try {
      // Check max clients limit
      const currentCount = await this.redis.scard(INDEX_KEY);
      const maxClients = this.options.maxClients ?? 10000;
      if (currentCount >= maxClients) {
        logger.warn('Client registration failed: max clients limit reached', {
          currentCount,
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

      // Calculate expiration
      let expiresAt: number | undefined;
      const defaultExpiry = this.options.defaultSecretExpirySeconds ?? 0;
      if (defaultExpiry > 0) {
        expiresAt = issuedAt + defaultExpiry;
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

      // Store in Redis
      const key = `${KEY_PREFIX}${clientId}`;

      if (expiresAt) {
        // Set with TTL (automatic expiration)
        const ttl = expiresAt - issuedAt;
        await this.redis.setex(key, ttl, JSON.stringify(fullClient));
      } else {
        // Set without expiration
        await this.redis.set(key, JSON.stringify(fullClient));
      }

      // Add to index set for listing
      await this.redis.sadd(INDEX_KEY, clientId);

      logger.info('Client registered in Redis', {
        clientId,
        clientName: client.client_name,
        redirectUris: client.redirect_uris,
        expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : 'never',
        ttl: expiresAt ? expiresAt - issuedAt : 'none',
      });

      return fullClient;
    } catch (error) {
      logger.error('Failed to register client in Redis', error as Record<string, unknown>);
      throw error;
    }
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    try {
      const key = `${KEY_PREFIX}${clientId}`;
      const data = await this.redis.get(key);

      if (!data) {
        logger.debug('Client not found in Redis', { clientId });
        return undefined;
      }

      const client: ExtendedOAuthClientInformation = JSON.parse(data);

      logger.debug('Client retrieved from Redis', {
        clientId,
        clientName: client.client_name,
      });

      return client;
    } catch (error) {
      logger.error('Failed to get client from Redis', { clientId, error });
      throw error;
    }
  }

  async deleteClient(clientId: string): Promise<boolean> {
    try {
      const key = `${KEY_PREFIX}${clientId}`;

      // Check if client exists
      const exists = await this.redis.exists(key);
      if (!exists) {
        logger.debug('Client delete failed: not found in Redis', { clientId });
        return false;
      }

      // Delete from Redis and index
      await Promise.all([
        this.redis.del(key),
        this.redis.srem(INDEX_KEY, clientId),
      ]);

      logger.info('Client deleted from Redis', { clientId });
      return true;
    } catch (error) {
      logger.error('Failed to delete client from Redis', { clientId, error });
      throw error;
    }
  }

  async listClients(): Promise<OAuthClientInformationFull[]> {
    try {
      // Get all client IDs from index
      const clientIds = await this.redis.smembers(INDEX_KEY);

      if (clientIds?.length === 0) {
        return [];
      }

      // Fetch all clients in parallel
      const keys = clientIds.map((id: string) => `${KEY_PREFIX}${id}`);
      const results = await this.redis.mget(...keys);

      // Filter out null values (expired clients) and parse
      const clients: OAuthClientInformationFull[] = [];
      const expiredIds: string[] = [];

      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const clientId = clientIds[i];
        if (result) {
          clients.push(JSON.parse(result));
        } else if (clientId) {
          // Client expired but still in index
          expiredIds.push(clientId);
        }
      }

      // Clean up expired client IDs from index
      if (expiredIds.length > 0) {
        await this.redis.srem(INDEX_KEY, ...expiredIds);
        logger.debug('Removed expired clients from index', {
          count: expiredIds.length,
        });
      }

      logger.debug('Listed clients from Redis', {
        count: clients.length,
        expiredRemoved: expiredIds.length,
      });

      return clients;
    } catch (error) {
      logger.error('Failed to list clients from Redis', error as Record<string, unknown>);
      throw error;
    }
  }

  async cleanupExpired(): Promise<number> {
    try {
      // Get all client IDs from index
      const clientIds = await this.redis.smembers(INDEX_KEY);

      if (clientIds?.length === 0) {
        return 0;
      }

      // Check which clients still exist (non-expired)
      const keys = clientIds.map((id: string) => `${KEY_PREFIX}${id}`);
      const exists = await Promise.all(keys.map((key: string) => this.redis.exists(key)));

      // Find expired clients (in index but not in Redis)
      const expiredIds: string[] = [];
      for (let i = 0; i < clientIds.length; i++) {
        const clientId = clientIds[i];
        if (!exists[i] && clientId) {
          expiredIds.push(clientId);
        }
      }

      // Remove expired client IDs from index
      if (expiredIds.length > 0) {
        await this.redis.srem(INDEX_KEY, ...expiredIds);
        logger.info('Expired clients cleaned up from Redis', {
          count: expiredIds.length,
        });
      }

      return expiredIds.length;
    } catch (error) {
      logger.error('Failed to cleanup expired clients from Redis', error as Record<string, unknown>);
      throw error;
    }
  }

  /**
   * Get current number of registered clients
   */
  async getClientCount(): Promise<number> {
    try {
      return await this.redis.scard(INDEX_KEY);
    } catch (error) {
      logger.error('Failed to get client count from Redis', error as Record<string, unknown>);
      return 0;
    }
  }

  /**
   * Clear all clients (testing only - use with caution!)
   */
  async clear(): Promise<void> {
    try {
      const clientIds = await this.redis.smembers(INDEX_KEY);

      if (clientIds?.length === 0) {
        return;
      }

      // Delete all client keys
      const keys = clientIds.map((id: string) => `${KEY_PREFIX}${id}`);
      await this.redis.del(...keys, INDEX_KEY);

      logger.warn('All clients cleared from Redis', { count: clientIds.length });
    } catch (error) {
      logger.error('Failed to clear clients from Redis', error as Record<string, unknown>);
      throw error;
    }
  }
}
