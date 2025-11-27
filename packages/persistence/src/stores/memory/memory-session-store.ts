/**
 * In-Memory OAuth Session Store
 *
 * Simple Map-based storage for OAuth sessions. Suitable for:
 * - Development and testing
 * - Single-instance deployments
 * - Scenarios where session persistence across restarts is not required
 *
 * WARNING: All sessions are lost on server restart!
 * WARNING: Does NOT work across multiple serverless instances!
 */

import { OAuthSessionStore } from '../../interfaces/session-store.js';
import { OAuthSession } from '../../types.js';
import { logger } from '../../logger.js';

export class MemorySessionStore implements OAuthSessionStore {
  private readonly sessions = new Map<string, OAuthSession>();
  private cleanupInterval?: NodeJS.Timeout;
  private readonly SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes in milliseconds

  constructor() {
    logger.info('MemorySessionStore initialized');

    // Start automatic cleanup of expired sessions
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000); // Every 5 minutes
    if (typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }
  }

  async storeSession(state: string, session: OAuthSession): Promise<void> {
    this.sessions.set(state, session);

    logger.debug('Session stored', {
      state: state.substring(0, 8) + '...',
      provider: session.provider,
      expiresAt: new Date(session.expiresAt).toISOString()
    });
  }

  async getSession(state: string): Promise<OAuthSession | null> {
    const session = this.sessions.get(state);

    if (!session) {
      logger.debug('Session not found', {
        state: state.substring(0, 8) + '...'
      });
      return null;
    }

    // Verify not expired
    if (session.expiresAt && session.expiresAt < Date.now()) {
      logger.warn('Session expired', {
        state: state.substring(0, 8) + '...',
        expiredAt: new Date(session.expiresAt).toISOString()
      });
      await this.deleteSession(state);
      return null;
    }

    logger.debug('Session retrieved', {
      state: state.substring(0, 8) + '...',
      provider: session.provider
    });

    return session;
  }

  async deleteSession(state: string): Promise<void> {
    const existed = this.sessions.delete(state);

    if (existed) {
      logger.debug('Session deleted', {
        state: state.substring(0, 8) + '...'
      });
    }
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [state, session] of this.sessions.entries()) {
      if (session.expiresAt && session.expiresAt <= now) {
        this.sessions.delete(state);
        cleanedCount++;
        logger.debug('Expired session cleaned up', {
          state: state.substring(0, 8) + '...',
          provider: session.provider,
          expiredAt: new Date(session.expiresAt).toISOString()
        });
      }
    }

    if (cleanedCount > 0) {
      logger.info('Expired sessions cleanup completed', {
        cleanedCount,
        remainingCount: this.sessions.size
      });
    }

    return cleanedCount;
  }

  async getSessionCount(): Promise<number> {
    return this.sessions.size;
  }

  /**
   * Clear all sessions (testing only)
   */
  clear(): void {
    const count = this.sessions.size;
    this.sessions.clear();
    logger.warn('All sessions cleared', { count });
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.sessions.clear();
    logger.info('MemorySessionStore disposed');
  }
}
