/**
 * Memory-based Session Manager
 *
 * In-memory session storage for single-node deployments (STDIO mode, local dev).
 * Uses Map for fast lookups with automatic expiration cleanup.
 *
 * Characteristics:
 * - Fast (in-memory Map lookup)
 * - Not shared across server instances
 * - Data lost on server restart
 * - Suitable for single-node, non-critical deployments
 *
 * Use Cases:
 * - STDIO mode (single process by definition)
 * - Local development
 * - Testing
 *
 * Based on original SessionManager implementation with async API
 */

import { randomUUID } from 'node:crypto';
import { logger } from '@mcp-typescript-simple/observability';
import type { AuthInfo } from '@mcp-typescript-simple/persistence';
import type { SessionManager, SessionInfo, SessionStats } from './session-manager.js';

export class MemorySessionManager implements SessionManager {
  private sessions: Map<string, SessionInfo> = new Map();
  private readonly SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
  private cleanupInterval?: NodeJS.Timeout;

  constructor() {
    // Start cleanup task to remove expired sessions
    this.cleanupInterval = setInterval(() => {
      this.cleanup().catch((error) => {
        logger.error('Session cleanup error', { error });
      });
    }, 60 * 60 * 1000); // Every hour

    // Unref interval to allow serverless functions to exit cleanly
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }

    logger.info('MemorySessionManager initialized');
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

    this.sessions.set(id, sessionInfo);

    logger.debug('Created new session', { sessionId: id });
    return sessionInfo;
  }

  async getSession(sessionId: string): Promise<SessionInfo | undefined> {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Check if expired
      if (Date.now() > session.expiresAt) {
        this.sessions.delete(sessionId);
        return undefined;
      }
    }
    return session;
  }

  async isSessionValid(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const now = Date.now();
    if (now > session.expiresAt) {
      this.sessions.delete(sessionId);
      return false;
    }

    return true;
  }

  async closeSession(sessionId: string): Promise<boolean> {
    const existed = this.sessions.has(sessionId);
    this.sessions.delete(sessionId);

    if (existed) {
      logger.debug('Closed session', { sessionId });
    }

    return existed;
  }

  async getActiveSessions(): Promise<SessionInfo[]> {
    const now = Date.now();
    const activeSessions: SessionInfo[] = [];

    for (const session of this.sessions.values()) {
      if (now <= session.expiresAt) {
        activeSessions.push(session);
      }
    }

    return activeSessions;
  }

  async getStats(): Promise<SessionStats> {
    const now = Date.now();
    let activeSessions = 0;
    let expiredSessions = 0;

    for (const session of this.sessions.values()) {
      if (now <= session.expiresAt) {
        activeSessions++;
      } else {
        expiredSessions++;
      }
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions,
      expiredSessions,
    };
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      if (now > session.expiresAt) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      this.sessions.delete(sessionId);
    }

    if (expiredSessions.length > 0) {
      logger.debug('Cleaned up expired sessions', { count: expiredSessions.length });
    }

    return expiredSessions.length;
  }

  async clear(): Promise<void> {
    this.sessions.clear();
  }

  async destroy(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    await this.clear();
    logger.info('MemorySessionManager destroyed');
  }
}
