/**
 * In-Memory MCP Session Metadata Store
 *
 * Simple in-memory implementation for single-instance deployments.
 * Provides existing behavior with no external dependencies.
 *
 * Features:
 * - Zero configuration required
 * - Fast O(1) lookups with LRU eviction
 * - Automatic TTL-based cleanup
 * - Configurable cache size and TTL
 * - Perfect for development and single-instance production
 *
 * Limitations:
 * - Not shared across multiple instances
 * - Lost on server restart
 * - Not suitable for serverless environments
 */

import { MCPSessionMetadataStore, MCPSessionMetadata } from '../../interfaces/mcp-metadata-store.js';
import { logger } from '../../logger.js';

const DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes in milliseconds
const DEFAULT_MAX_SIZE = 10000; // Max sessions before LRU eviction
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

export interface MemoryMCPMetadataStoreOptions {
  /** Session TTL in milliseconds (default: 30 minutes) */
  ttl?: number;
  /** Maximum cache size before LRU eviction (default: 10,000) */
  maxSize?: number;
}

export class MemoryMCPMetadataStore implements MCPSessionMetadataStore {
  private sessions: Map<string, MCPSessionMetadata> = new Map();
  private accessOrder: string[] = []; // LRU tracking (oldest first)
  private cleanupTimer?: NodeJS.Timeout;
  private readonly ttl: number;
  private readonly maxSize: number;

  constructor(options: MemoryMCPMetadataStoreOptions = {}) {
    this.ttl = options.ttl ?? DEFAULT_TTL;
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;

    logger.info('MemoryMCPMetadataStore initialized', {
      ttl: this.ttl,
      maxSize: this.maxSize,
    });

    // Start automatic cleanup
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(error => {
        logger.error('Session cleanup failed', { error });
      });
    }, CLEANUP_INTERVAL);
  }

  /**
   * Update LRU access order
   */
  private updateAccessOrder(sessionId: string): void {
    // Remove from current position
    const index = this.accessOrder.indexOf(sessionId);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }
    // Add to end (most recently used)
    this.accessOrder.push(sessionId);
  }

  /**
   * Evict least recently used session
   */
  private evictLRU(): void {
    if (this.accessOrder.length === 0) return;

    const lruSessionId = this.accessOrder.shift()!;
    this.sessions.delete(lruSessionId);

    logger.debug('Evicted LRU session', {
      sessionId: lruSessionId.substring(0, 8) + '...',
      remainingCount: this.sessions.size,
    });
  }

  async storeSession(sessionId: string, metadata: MCPSessionMetadata): Promise<void> {
    // Set expiresAt if not provided
    const sessionMetadata: MCPSessionMetadata = {
      ...metadata,
      expiresAt: metadata.expiresAt || (Date.now() + this.ttl),
    };

    this.sessions.set(sessionId, sessionMetadata);
    this.updateAccessOrder(sessionId);

    // LRU eviction if cache exceeds max size
    if (this.sessions.size > this.maxSize) {
      this.evictLRU();
    }

    logger.debug('Session metadata stored', {
      sessionId: sessionId.substring(0, 8) + '...',
      createdAt: new Date(sessionMetadata.createdAt).toISOString(),
      expiresAt: new Date(sessionMetadata.expiresAt).toISOString(),
      hasAuth: !!sessionMetadata.authInfo,
      eventCount: sessionMetadata.events?.length ?? 0,
      cacheSize: this.sessions.size,
    });
  }

  async getSession(sessionId: string): Promise<MCPSessionMetadata | null> {
    const metadata = this.sessions.get(sessionId);

    if (!metadata) {
      logger.debug('Session metadata not found', {
        sessionId: sessionId.substring(0, 8) + '...',
      });
      return null;
    }

    // Check if expired
    const now = Date.now();
    if (now > metadata.expiresAt) {
      const ageSeconds = Math.round((now - metadata.createdAt) / 1000);
      logger.warn('Session metadata expired', {
        sessionId: sessionId.substring(0, 8) + '...',
        ageSeconds,
        expiresAt: new Date(metadata.expiresAt).toISOString(),
      });
      await this.deleteSession(sessionId);
      return null;
    }

    // Update LRU access order
    this.updateAccessOrder(sessionId);

    const ageSeconds = Math.round((now - metadata.createdAt) / 1000);
    const ttlSeconds = Math.round((metadata.expiresAt - now) / 1000);

    logger.debug('Session metadata retrieved', {
      sessionId: sessionId.substring(0, 8) + '...',
      ageSeconds,
      ttlSeconds,
      hasAuth: !!metadata.authInfo,
      eventCount: metadata.events?.length ?? 0,
    });

    return metadata;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const deleted = this.sessions.delete(sessionId);

    // Remove from LRU tracking
    const index = this.accessOrder.indexOf(sessionId);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }

    if (deleted) {
      logger.debug('Session metadata deleted', {
        sessionId: sessionId.substring(0, 8) + '...',
      });
    }
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    const expiredSessions: string[] = [];

    // Find expired sessions based on expiresAt
    for (const [sessionId, metadata] of this.sessions) {
      if (now > metadata.expiresAt) {
        expiredSessions.push(sessionId);
      }
    }

    // Remove expired sessions
    for (const sessionId of expiredSessions) {
      await this.deleteSession(sessionId);
    }

    if (expiredSessions.length > 0) {
      logger.info('Cleaned up expired sessions', {
        count: expiredSessions.length,
        remainingCount: this.sessions.size,
      });
    }

    return expiredSessions.length;
  }

  async getSessionCount(): Promise<number> {
    return this.sessions.size;
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    this.sessions.clear();
    logger.info('MemoryMCPMetadataStore disposed');
  }
}
