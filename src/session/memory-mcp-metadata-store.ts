/**
 * In-Memory MCP Session Metadata Store
 *
 * Simple in-memory implementation for single-instance deployments.
 * Provides existing behavior with no external dependencies.
 *
 * Features:
 * - Zero configuration required
 * - Fast (no network calls)
 * - Automatic TTL-based cleanup
 * - Perfect for development and single-instance production
 *
 * Limitations:
 * - Not shared across multiple instances
 * - Lost on server restart
 * - Not suitable for serverless environments
 */

import { MCPSessionMetadataStore, MCPSessionMetadata } from './mcp-session-metadata-store-interface.js';
import { logger } from '../observability/logger.js';

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

export class MemoryMCPMetadataStore implements MCPSessionMetadataStore {
  private sessions: Map<string, MCPSessionMetadata> = new Map();
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    logger.info('MemoryMCPMetadataStore initialized');

    // Start automatic cleanup
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(error => {
        logger.error('Session cleanup failed', { error });
      });
    }, CLEANUP_INTERVAL);
  }

  async storeSession(sessionId: string, metadata: MCPSessionMetadata): Promise<void> {
    this.sessions.set(sessionId, {
      ...metadata,
      lastActivity: Date.now(),
    });

    logger.debug('Session metadata stored', {
      sessionId: sessionId.substring(0, 8) + '...',
      createdAt: new Date(metadata.createdAt).toISOString(),
      hasAuth: !!metadata.authInfo,
      eventCount: metadata.events?.length || 0,
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
    const age = now - metadata.lastActivity;

    if (age > SESSION_TIMEOUT) {
      logger.warn('Session metadata expired', {
        sessionId: sessionId.substring(0, 8) + '...',
        ageMinutes: Math.round(age / 60000),
        timeoutMinutes: SESSION_TIMEOUT / 60000,
      });
      await this.deleteSession(sessionId);
      return null;
    }

    logger.debug('Session metadata retrieved', {
      sessionId: sessionId.substring(0, 8) + '...',
      ageMinutes: Math.round(age / 60000),
      hasAuth: !!metadata.authInfo,
      eventCount: metadata.events?.length || 0,
    });

    return metadata;
  }

  async updateActivity(sessionId: string): Promise<void> {
    const metadata = this.sessions.get(sessionId);

    if (metadata) {
      metadata.lastActivity = Date.now();

      logger.debug('Session activity updated', {
        sessionId: sessionId.substring(0, 8) + '...',
      });
    } else {
      logger.warn('Cannot update activity for non-existent session', {
        sessionId: sessionId.substring(0, 8) + '...',
      });
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const deleted = this.sessions.delete(sessionId);

    if (deleted) {
      logger.debug('Session metadata deleted', {
        sessionId: sessionId.substring(0, 8) + '...',
      });
    }
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    const expiredSessions: string[] = [];

    // Find expired sessions
    for (const [sessionId, metadata] of this.sessions) {
      const age = now - metadata.lastActivity;
      if (age > SESSION_TIMEOUT) {
        expiredSessions.push(sessionId);
      }
    }

    // Remove expired sessions
    for (const sessionId of expiredSessions) {
      this.sessions.delete(sessionId);
    }

    if (expiredSessions.length > 0) {
      logger.info('Cleaned up expired sessions', {
        count: expiredSessions.length,
        timeoutMinutes: SESSION_TIMEOUT / 60000,
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
