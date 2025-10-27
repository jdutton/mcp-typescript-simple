/**
 * Redis-based MCP Session Metadata Store with AES-256-GCM Encryption
 *
 * Provides persistent, scalable session storage using Redis with mandatory encryption.
 * Suitable for multi-instance deployments and serverless environments.
 *
 * Security Features:
 * - AES-256-GCM encryption at rest (REQUIRED - zero tolerance for unencrypted data)
 * - Automatic expiration using Redis TTL
 * - Fail-fast on decryption errors - no graceful degradation
 * - SOC-2, ISO 27001, GDPR, HIPAA compliant
 *
 * Security Stance:
 * - Encryption is MANDATORY, not optional
 * - TokenEncryptionService MUST be provided to constructor
 * - No plaintext session data in Redis
 */

import type Redis from 'ioredis';
import {
  MCPSessionMetadataStore,
  MCPSessionMetadata,
} from '../../interfaces/mcp-metadata-store.js';
import { logger } from '../../logger.js';
import { TokenEncryptionService } from '../../encryption/token-encryption-service.js';
import { maskRedisUrl, createRedisClient } from './redis-utils.js';

export class RedisMCPMetadataStore implements MCPSessionMetadataStore {
  private redis: Redis;
  private readonly encryptionService: TokenEncryptionService;
  private readonly keyPrefix = 'mcp:session:';
  private readonly DEFAULT_TTL = 30 * 60; // 30 minutes in seconds

  constructor(redisUrl: string, encryptionService: TokenEncryptionService) {
    // Enterprise security: encryption is MANDATORY
    if (!encryptionService) {
      throw new Error('TokenEncryptionService is REQUIRED. Encryption at rest is mandatory for SOC-2, ISO 27001, GDPR, HIPAA compliance.');
    }

    this.encryptionService = encryptionService;
    this.redis = createRedisClient(redisUrl, 'MCP sessions');

    const url = redisUrl || process.env.REDIS_URL!;
    logger.info('RedisMCPMetadataStore initialized with encryption', { url: maskRedisUrl(url) });
  }

  /**
   * Get full Redis key for session
   */
  private getKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  /**
   * Serialize and encrypt session metadata before storing in Redis
   * Enterprise security: AES-256-GCM encryption at rest (REQUIRED)
   */
  private async serializeSessionMetadata(metadata: MCPSessionMetadata): Promise<string> {
    const json = JSON.stringify(metadata);
    const encrypted = this.encryptionService.encrypt(json);
    return encrypted;
  }

  /**
   * Decrypt and deserialize session metadata from Redis
   * Enterprise security: Fail fast on decryption errors - no graceful degradation
   */
  private async deserializeSessionMetadata(encryptedData: string): Promise<MCPSessionMetadata> {
    // Decrypt data - fail fast if decryption fails
    const decrypted = this.encryptionService.decrypt(encryptedData);
    return JSON.parse(decrypted) as MCPSessionMetadata;
  }

  async storeSession(sessionId: string, metadata: MCPSessionMetadata): Promise<void> {
    try {
      const key = this.getKey(sessionId);

      // Encrypt session metadata before storing
      const encryptedData = await this.serializeSessionMetadata(metadata);

      // Calculate TTL from expiresAt
      const ttlSeconds = metadata.expiresAt
        ? Math.max(1, Math.floor((metadata.expiresAt - Date.now()) / 1000))
        : this.DEFAULT_TTL;

      await this.redis.setex(key, ttlSeconds, encryptedData);

      logger.debug('Session stored in Redis (encrypted)', {
        sessionId: sessionId.substring(0, 8) + '...',
        ttlSeconds,
        provider: metadata.authInfo?.provider,
      });
    } catch (error) {
      logger.error('Failed to store session in Redis', {
        sessionId: sessionId.substring(0, 8) + '...',
        error,
      });
      throw error;
    }
  }

  async getSession(sessionId: string): Promise<MCPSessionMetadata | null> {
    try {
      const key = this.getKey(sessionId);
      const data = await this.redis.get(key);

      if (!data) {
        logger.debug('Session not found in Redis', {
          sessionId: sessionId.substring(0, 8) + '...',
        });
        return null;
      }

      // Decrypt and deserialize session metadata - fail fast on decryption errors
      const metadata = await this.deserializeSessionMetadata(data);

      // Check if session is expired
      if (metadata.expiresAt && metadata.expiresAt < Date.now()) {
        logger.debug('Session expired in Redis', {
          sessionId: sessionId.substring(0, 8) + '...',
          expiresAt: new Date(metadata.expiresAt).toISOString(),
        });
        await this.deleteSession(sessionId);
        return null;
      }

      logger.debug('Session retrieved from Redis (decrypted)', {
        sessionId: sessionId.substring(0, 8) + '...',
        age: Math.round((Date.now() - metadata.createdAt) / 1000) + 's',
        provider: metadata.authInfo?.provider,
      });

      return metadata;
    } catch (error) {
      logger.error('Failed to get session from Redis', {
        sessionId: sessionId.substring(0, 8) + '...',
        error,
      });
      // Fail fast on decryption errors - throw instead of returning null
      throw error;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      const key = this.getKey(sessionId);
      await this.redis.del(key);

      logger.debug('Session deleted from Redis', {
        sessionId: sessionId.substring(0, 8) + '...',
      });
    } catch (error) {
      logger.error('Failed to delete session from Redis', {
        sessionId: sessionId.substring(0, 8) + '...',
        error,
      });
      throw error;
    }
  }

  async cleanup(): Promise<number> {
    // Redis automatically handles expiration via TTL
    // This method is a no-op for Redis
    logger.debug('Redis cleanup called (no-op - TTL handles expiration)');
    return 0;
  }

  async getSessionCount(): Promise<number> {
    try {
      const keys = await this.redis.keys(`${this.keyPrefix}*`);
      return keys.length;
    } catch (error) {
      logger.error('Failed to get session count from Redis', { error });
      return 0;
    }
  }

  dispose(): void {
    logger.info('Disposing Redis MCP metadata store');
    this.redis.disconnect();
  }
}
