/**
 * Unified Session Manager Interface
 *
 * Provides consistent async API for session management across both single-node
 * (memory) and multi-node (Redis) deployments.
 *
 * Design Rationale:
 * - Single testable interface for HTTP server (easy to mock)
 * - Consistent async API for both memory and Redis implementations
 * - Encapsulates session-specific logic (stats, expiration)
 * - Auto-detection based on REDIS_URL environment variable
 *
 * Architecture:
 * - MemorySessionManager: Single-node deployment (STDIO, local dev)
 * - RedisSessionManager: Multi-node deployment (production, load-balanced, Vercel)
 *
 * Based on TODO.md Phase 2 specification (lines 119-131)
 */

import type { AuthInfo } from '@mcp-typescript-simple/persistence';

/**
 * Session information
 */
export interface SessionInfo {
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  authInfo?: AuthInfo;
  metadata?: Record<string, unknown>;
}

/**
 * Session statistics for monitoring
 */
export interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  expiredSessions: number;
}

/**
 * Unified session manager interface
 *
 * All methods are async for consistency (both memory and Redis implementations)
 */
export interface SessionManager {
  /**
   * Create a new session with metadata
   *
   * @param authInfo - Optional authentication information
   * @param metadata - Optional custom metadata
   * @param sessionId - Optional session ID (generated if not provided)
   * @returns Session information
   */
  createSession(
    authInfo?: AuthInfo,
    metadata?: Record<string, unknown>,
    sessionId?: string
  ): Promise<SessionInfo>;

  /**
   * Get session information by ID
   *
   * @param sessionId - Unique session identifier
   * @returns Session info or undefined if not found or expired
   */
  getSession(sessionId: string): Promise<SessionInfo | undefined>;

  /**
   * Check if session is valid (exists and not expired)
   *
   * @param sessionId - Unique session identifier
   * @returns True if session is valid
   */
  isSessionValid(sessionId: string): Promise<boolean>;

  /**
   * Close and delete session by ID
   *
   * @param sessionId - Unique session identifier
   * @returns True if session existed and was closed
   */
  closeSession(sessionId: string): Promise<boolean>;

  /**
   * Get all active (non-expired) sessions
   *
   * @returns Array of active session info
   */
  getActiveSessions(): Promise<SessionInfo[]>;

  /**
   * Get session statistics for monitoring
   *
   * @returns Session stats (counts)
   */
  getStats(): Promise<SessionStats>;

  /**
   * Clean up expired sessions
   *
   * @returns Number of sessions cleaned up
   */
  cleanup(): Promise<number>;

  /**
   * Clear all sessions (for testing)
   */
  clear(): Promise<void>;

  /**
   * Dispose of resources (cleanup timers, connections, etc.)
   */
  destroy(): Promise<void>;
}
