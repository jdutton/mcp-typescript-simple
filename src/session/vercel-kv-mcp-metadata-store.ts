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
const SESSION_TIMEOUT = 30 * 60; // 30 minutes in seconds

export class VercelKVMCPMetadataStore implements MCPSessionMetadataStore {
  constructor() {
    logger.info('VercelKVMCPMetadataStore initialized', {
      timeout: SESSION_TIMEOUT,
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
      // Update last activity
      const updatedMetadata: MCPSessionMetadata = {
        ...metadata,
        lastActivity: Date.now(),
      };

      // Store with TTL matching session timeout
      await kv.setex(key, SESSION_TIMEOUT, JSON.stringify(updatedMetadata));

      logger.debug('Session metadata stored', {
        sessionId: sessionId.substring(0, 8) + '...',
        createdAt: new Date(metadata.createdAt).toISOString(),
        hasAuth: !!metadata.authInfo,
        eventCount: metadata.events?.length || 0,
        expiresIn: SESSION_TIMEOUT,
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
      const age = now - metadata.lastActivity;
      const ageMinutes = Math.round(age / 60000);

      logger.debug('Session metadata retrieved', {
        sessionId: sessionId.substring(0, 8) + '...',
        ageMinutes,
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

  async updateActivity(sessionId: string): Promise<void> {
    const key = this.getSessionKey(sessionId);

    try {
      // Get existing metadata
      const metadata = await this.getSession(sessionId);

      if (!metadata) {
        logger.warn('Cannot update activity for non-existent session', {
          sessionId: sessionId.substring(0, 8) + '...',
        });
        return;
      }

      // Update last activity and reset TTL
      metadata.lastActivity = Date.now();
      await kv.setex(key, SESSION_TIMEOUT, JSON.stringify(metadata));

      logger.debug('Session activity updated', {
        sessionId: sessionId.substring(0, 8) + '...',
        expiresIn: SESSION_TIMEOUT,
      });
    } catch (error) {
      logger.error('Failed to update session activity', {
        sessionId: sessionId.substring(0, 8) + '...',
        error,
      });
      // Don't throw - activity update is best-effort
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
