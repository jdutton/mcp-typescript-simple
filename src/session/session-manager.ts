/**
 * Session management for Streamable HTTP transport
 */

import { randomUUID } from 'crypto';
import { EventStore } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { logger } from '../utils/logger.js';

/**
 * Session information stored by the session manager
 */
export interface SessionInfo {
  sessionId: string;
  createdAt: number;
  lastActivity: number;
  authInfo?: AuthInfo;
  metadata?: Record<string, unknown>;
}

/**
 * Session manager for tracking active sessions
 */
export class SessionManager {
  private sessions: Map<string, SessionInfo> = new Map();
  private readonly SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
  private cleanupInterval?: NodeJS.Timeout;

  constructor(private eventStore?: EventStore) {
    // Start cleanup task to remove expired sessions
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 60 * 1000); // Every hour
  }

  /**
   * Generate a new session ID
   */
  generateSessionId(): string {
    return randomUUID();
  }

  /**
   * Create a new session
   */
  createSession(authInfo?: AuthInfo, metadata?: Record<string, unknown>): SessionInfo {
    const sessionId = this.generateSessionId();
    const now = Date.now();

    const sessionInfo: SessionInfo = {
      sessionId,
      createdAt: now,
      lastActivity: now,
      authInfo,
      metadata,
    };

    this.sessions.set(sessionId, sessionInfo);

    logger.debug("Created new session", { sessionId });
    return sessionInfo;
  }

  /**
   * Get session information by ID
   */
  getSession(sessionId: string): SessionInfo | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Update last activity
      session.lastActivity = Date.now();
    }
    return session;
  }

  /**
   * Update session with new auth info or metadata
   */
  updateSession(sessionId: string, updates: Partial<Pick<SessionInfo, 'authInfo' | 'metadata'>>): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    if (updates.authInfo !== undefined) {
      session.authInfo = updates.authInfo;
    }

    if (updates.metadata !== undefined) {
      session.metadata = { ...session.metadata, ...updates.metadata };
    }

    session.lastActivity = Date.now();
    return true;
  }

  /**
   * Check if a session is valid and not expired
   */
  isSessionValid(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const now = Date.now();
    if (now - session.lastActivity > this.SESSION_TIMEOUT) {
      this.sessions.delete(sessionId);
      return false;
    }

    return true;
  }

  /**
   * Close a session
   */
  closeSession(sessionId: string): boolean {
    const existed = this.sessions.has(sessionId);
    this.sessions.delete(sessionId);

    if (existed) {
      logger.debug("Closed session", { sessionId });
    }

    return existed;
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): SessionInfo[] {
    const now = Date.now();
    const activeSessions: SessionInfo[] = [];

    for (const session of this.sessions.values()) {
      if (now - session.lastActivity <= this.SESSION_TIMEOUT) {
        activeSessions.push(session);
      }
    }

    return activeSessions;
  }

  /**
   * Get session statistics
   */
  getStats(): {
    totalSessions: number;
    activeSessions: number;
    expiredSessions: number;
  } {
    const now = Date.now();
    let activeSessions = 0;
    let expiredSessions = 0;

    for (const session of this.sessions.values()) {
      if (now - session.lastActivity <= this.SESSION_TIMEOUT) {
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

  /**
   * Clean up expired sessions
   */
  private cleanup(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > this.SESSION_TIMEOUT) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      this.sessions.delete(sessionId);
    }

    if (expiredSessions.length > 0) {
      logger.debug("Cleaned up expired sessions", { count: expiredSessions.length });
    }
  }

  /**
   * Clear all sessions (for testing)
   */
  clear(): void {
    this.sessions.clear();
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }

    // Destroy the event store if it exists
    if (this.eventStore && 'destroy' in this.eventStore) {
      (this.eventStore as { destroy(): void }).destroy();
    }

    this.clear();
  }
}
