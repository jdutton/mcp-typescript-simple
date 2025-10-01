/**
 * Vercel KV OAuth Session Store
 *
 * Redis-compatible session storage for OAuth state persistence across
 * serverless function invocations.
 *
 * Features:
 * - Serverless-native (no persistent connections)
 * - Global edge network with low latency
 * - Automatic TTL support (10 minute session timeout)
 * - Multi-instance deployment support
 *
 * Setup:
 * 1. Add Vercel KV integration: `vercel link` then add KV storage
 * 2. Environment variables auto-set: KV_REST_API_URL, KV_REST_API_TOKEN
 * 3. No code changes needed - factory auto-detects Vercel environment
 */

import { kv } from '@vercel/kv';
import { OAuthSessionStore } from './session-store-interface.js';
import { OAuthSession } from '../providers/types.js';
import { logger } from '../../observability/logger.js';

/**
 * Redis key prefix for namespacing
 */
const KEY_PREFIX = 'oauth:session:';
const SESSION_TIMEOUT = 10 * 60; // 10 minutes in seconds

export class VercelKVSessionStore implements OAuthSessionStore {
  constructor() {
    logger.info('VercelKVSessionStore initialized');
  }

  /**
   * Generate Redis key for session state
   */
  private getSessionKey(state: string): string {
    return `${KEY_PREFIX}${state}`;
  }

  async storeSession(state: string, session: OAuthSession): Promise<void> {
    const key = this.getSessionKey(state);

    try {
      // Store with TTL matching session timeout
      await kv.setex(key, SESSION_TIMEOUT, JSON.stringify(session));

      logger.debug('Session stored', {
        state: state.substring(0, 8) + '...',
        provider: session.provider,
        expiresIn: SESSION_TIMEOUT
      });
    } catch (error) {
      logger.error('Failed to store session', {
        state: state.substring(0, 8) + '...',
        error
      });
      throw new Error('Session storage failed');
    }
  }

  async getSession(state: string): Promise<OAuthSession | null> {
    const key = this.getSessionKey(state);

    try {
      const data = await kv.get<string>(key);

      if (!data) {
        logger.debug('Session not found', {
          state: state.substring(0, 8) + '...'
        });
        return null;
      }

      const session = JSON.parse(data) as OAuthSession;

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
    } catch (error) {
      logger.error('Failed to retrieve session', {
        state: state.substring(0, 8) + '...',
        error
      });
      return null;
    }
  }

  async deleteSession(state: string): Promise<void> {
    const key = this.getSessionKey(state);

    try {
      await kv.del(key);

      logger.debug('Session deleted', {
        state: state.substring(0, 8) + '...'
      });
    } catch (error) {
      logger.error('Failed to delete session', {
        state: state.substring(0, 8) + '...',
        error
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
      // Scan for all session keys
      const keys = await kv.keys(`${KEY_PREFIX}*`);
      return keys.length;
    } catch (error) {
      logger.error('Failed to get session count', { error });
      return 0;
    }
  }
}
