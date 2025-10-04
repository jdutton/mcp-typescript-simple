/**
 * Vercel KV MCP Session Metadata Store
 *
 * Redis-backed session metadata storage for horizontal scalability
 * and serverless cold-start survival.
 *
 * Features:
 * - Serverless-native (no persistent connections)
 * - Global edge network with low latency
 * - Automatic TTL support (30 minute session timeout)
 * - Multi-instance deployment support
 * - Survives Vercel function cold starts
 *
 * Setup:
 * 1. Add Vercel KV integration: `vercel link` then add KV storage
 * 2. Environment variables auto-set: KV_REST_API_URL, KV_REST_API_TOKEN
 * 3. No code changes needed - factory auto-detects Vercel environment
 *
 * Architecture:
 * - Any server instance can handle any session
 * - Session metadata persists in Redis
 * - Server + Transport reconstructed on-demand from metadata
 */

import { kv } from '@vercel/kv';
import { MCPSessionMetadataStore, MCPSessionMetadata } from './mcp-session-metadata-store-interface.js';
import { logger } from '../observability/logger.js';

/**
 * Redis key prefix for namespacing
 */
const KEY_PREFIX = 'mcp:session:metadata:';
const DEFAULT_TTL_SECONDS = 30 * 60; // 30 minutes in seconds

export interface VercelKVMCPMetadataStoreOptions {
  /** Session TTL in seconds (default: 30 minutes) */
  ttlSeconds?: number;
}

export class VercelKVMCPMetadataStore implements MCPSessionMetadataStore {
  private readonly ttlSeconds: number;

  constructor(options: VercelKVMCPMetadataStoreOptions = {}) {
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;

    logger.info('VercelKVMCPMetadataStore initialized', {
      ttlSeconds: this.ttlSeconds,
      keyPrefix: KEY_PREFIX,
    });
  }

  /**
   * Generate Redis key for session metadata
   */
  private getSessionKey(sessionId: string): string {
    return `${KEY_PREFIX}${sessionId}`;
  }

  async storeSession(sessionId: string, metadata: MCPSessionMetadata): Promise<void> {
    const key = this.getSessionKey(sessionId);

    try {
      // Set expiresAt if not provided
      const sessionMetadata: MCPSessionMetadata = {
        ...metadata,
        expiresAt: metadata.expiresAt || (Date.now() + (this.ttlSeconds * 1000)),
      };

      // Store with TTL matching session timeout
      await kv.setex(key, this.ttlSeconds, JSON.stringify(sessionMetadata));

      logger.debug('Session metadata stored', {
        sessionId: sessionId.substring(0, 8) + '...',
        createdAt: new Date(sessionMetadata.createdAt).toISOString(),
        expiresAt: new Date(sessionMetadata.expiresAt).toISOString(),
        hasAuth: !!sessionMetadata.authInfo,
        eventCount: sessionMetadata.events?.length || 0,
        ttlSeconds: this.ttlSeconds,
      });
    } catch (error) {
      logger.error('Failed to store session metadata', {
        sessionId: sessionId.substring(0, 8) + '...',
        error,
      });
      throw new Error('Session metadata storage failed');
    }
  }

  async getSession(sessionId: string): Promise<MCPSessionMetadata | null> {
    const key = this.getSessionKey(sessionId);

    try {
      const data = await kv.get<string>(key);

      if (!data) {
        logger.debug('Session metadata not found', {
          sessionId: sessionId.substring(0, 8) + '...',
        });
        return null;
      }

      const metadata = JSON.parse(data) as MCPSessionMetadata;

      // Verify not expired (double-check even though Redis TTL handles this)
      const now = Date.now();
      if (now > metadata.expiresAt) {
        logger.warn('Session expired (but Redis TTL should have deleted it)', {
          sessionId: sessionId.substring(0, 8) + '...',
          expiresAt: new Date(metadata.expiresAt).toISOString(),
        });
        await this.deleteSession(sessionId);
        return null;
      }

      const ttlSeconds = Math.round((metadata.expiresAt - now) / 1000);

      logger.debug('Session metadata retrieved', {
        sessionId: sessionId.substring(0, 8) + '...',
        ttlSeconds,
        hasAuth: !!metadata.authInfo,
        eventCount: metadata.events?.length || 0,
      });

      return metadata;
    } catch (error) {
      logger.error('Failed to retrieve session metadata', {
        sessionId: sessionId.substring(0, 8) + '...',
        error,
      });
      return null;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const key = this.getSessionKey(sessionId);

    try {
      await kv.del(key);

      logger.debug('Session metadata deleted', {
        sessionId: sessionId.substring(0, 8) + '...',
      });
    } catch (error) {
      logger.error('Failed to delete session metadata', {
        sessionId: sessionId.substring(0, 8) + '...',
        error,
      });
      // Don't throw - session deletion is best-effort
    }
  }

  async cleanup(): Promise<number> {
    // With Vercel KV, TTL handles automatic cleanup
    // This method is for compatibility with the interface
    logger.debug('Session cleanup skipped (TTL-based)');
    return 0;
  }

  async getSessionCount(): Promise<number> {
    try {
      // Scan for all session metadata keys
      const keys = await kv.keys(`${KEY_PREFIX}*`);
      return keys.length;
    } catch (error) {
      logger.error('Failed to get session count', { error });
      return 0;
    }
  }

  dispose(): void {
    // No resources to dispose (Vercel KV handles connections)
    logger.info('VercelKVMCPMetadataStore disposed');
  }
}
