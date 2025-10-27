/**
 * Redis-backed Session Manager
 *
 * Distributed session storage for multi-node deployments (production, load-balanced, Vercel).
 * Wraps MCPSessionMetadataStore to provide SessionManager interface.
 *
 * Characteristics:
 * - Persistent (survives server restarts)
 * - Shared across server instances
 * - Horizontal scalability
 * - Automatic Redis TTL-based expiration
 *
 * Use Cases:
 * - Production deployments
 * - Load-balanced environments (multiple server instances)
 * - Vercel serverless functions (cold start survival)
 *
 * Architecture:
 * - Wraps MCPSessionMetadataStore (can be RedisMCPMetadataStore or CachingMCPMetadataStore)
 * - Converts between SessionInfo (HTTP server) and MCPSessionMetadata (persistence) formats
 * - Provides SessionManager interface for consistency with MemorySessionManager
 */

import { randomUUID } from 'crypto';
import { logger } from '@mcp-typescript-simple/observability';
import type {
  AuthInfo,
  MCPSessionMetadata,
  MCPSessionMetadataStore,
} from '@mcp-typescript-simple/persistence';
import type { SessionManager, SessionInfo, SessionStats } from './session-manager.js';

export class RedisSessionManager implements SessionManager {
  private readonly SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours

  constructor(private metadataStore: MCPSessionMetadataStore) {
    logger.info('RedisSessionManager initialized', {
      storeType: metadataStore.constructor.name,
    });
  }

  /**
   * Convert MCPSessionMetadata to SessionInfo
   */
  private toSessionInfo(metadata: MCPSessionMetadata): SessionInfo {
    return {
      sessionId: metadata.sessionId,
      createdAt: metadata.createdAt,
      expiresAt: metadata.expiresAt,
      authInfo: metadata.authInfo,
      metadata: metadata.metadata,
    };
  }

  /**
   * Convert SessionInfo to MCPSessionMetadata
   */
  private toSessionMetadata(info: SessionInfo): MCPSessionMetadata {
    return {
      sessionId: info.sessionId,
      createdAt: info.createdAt,
      expiresAt: info.expiresAt,
      authInfo: info.authInfo,
      metadata: info.metadata,
    };
  }

  async createSession(
    authInfo?: AuthInfo,
    metadata?: Record<string, unknown>,
    sessionId?: string
  ): Promise<SessionInfo> {
    const id = sessionId || randomUUID();
    const now = Date.now();

    const sessionInfo: SessionInfo = {
      sessionId: id,
      createdAt: now,
      expiresAt: now + this.SESSION_TIMEOUT,
      authInfo,
      metadata,
    };

    // Store in Redis
    await this.metadataStore.storeSession(id, this.toSessionMetadata(sessionInfo));

    logger.debug('Created new session', { sessionId: id });
    return sessionInfo;
  }

  async getSession(sessionId: string): Promise<SessionInfo | undefined> {
    const metadata = await this.metadataStore.getSession(sessionId);
    if (!metadata) {
      return undefined;
    }

    // Check if expired (Redis TTL should handle this, but double-check)
    if (Date.now() > metadata.expiresAt) {
      await this.metadataStore.deleteSession(sessionId);
      return undefined;
    }

    return this.toSessionInfo(metadata);
  }

  async isSessionValid(sessionId: string): Promise<boolean> {
    const session = await this.getSession(sessionId);
    return session !== undefined;
  }

  async closeSession(sessionId: string): Promise<boolean> {
    // Check if exists
    const exists = await this.metadataStore.getSession(sessionId);
    if (!exists) {
      return false;
    }

    await this.metadataStore.deleteSession(sessionId);
    logger.debug('Closed session', { sessionId });
    return true;
  }

  async getActiveSessions(): Promise<SessionInfo[]> {
    // Note: This is inefficient for Redis (requires scanning all keys)
    // In production, consider removing this method or using Redis SCAN
    logger.warn('getActiveSessions() is inefficient for Redis - consider removing');

    // For now, return empty array (not implemented for Redis)
    // Implementing this would require iterating all Redis keys which is expensive
    return [];
  }

  async getStats(): Promise<SessionStats> {
    const count = await this.metadataStore.getSessionCount();

    // For Redis, we don't separately track expired sessions
    // (Redis TTL handles expiration automatically)
    return {
      totalSessions: count,
      activeSessions: count, // All sessions in Redis are active (expired ones are auto-deleted)
      expiredSessions: 0,    // Not tracked separately (Redis TTL handles this)
    };
  }

  async cleanup(): Promise<number> {
    // Redis handles expiration automatically via TTL
    // This method is a no-op for Redis
    return await this.metadataStore.cleanup();
  }

  async clear(): Promise<void> {
    // Note: This would require deleting all session keys in Redis
    // Not implemented - use metadataStore.cleanup() for production
    logger.warn('clear() is not implemented for Redis - sessions expire via TTL');
  }

  async destroy(): Promise<void> {
    this.metadataStore.dispose();
    logger.info('RedisSessionManager destroyed');
  }
}
