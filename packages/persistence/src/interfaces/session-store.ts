/**
 * OAuth Session Store Interface
 *
 * Provides persistent storage for OAuth session data (state, PKCE verifiers, etc.)
 * across serverless function invocations.
 */

import { OAuthSession } from '../types.js';

/**
 * Interface for OAuth session storage
 */
export interface OAuthSessionStore {
  /**
   * Store an OAuth session by state parameter
   */
  storeSession(state: string, session: OAuthSession): Promise<void>;

  /**
   * Retrieve an OAuth session by state parameter
   */
  getSession(state: string): Promise<OAuthSession | null>;

  /**
   * Delete an OAuth session by state parameter
   */
  deleteSession(state: string): Promise<void>;

  /**
   * Clean up expired sessions
   * @returns Number of sessions cleaned up
   */
  cleanup(): Promise<number>;

  /**
   * Get the number of active sessions (for monitoring)
   */
  getSessionCount(): Promise<number>;

  /**
   * Dispose of resources (cleanup timers, connections, etc.)
   */
  dispose(): void;
}
