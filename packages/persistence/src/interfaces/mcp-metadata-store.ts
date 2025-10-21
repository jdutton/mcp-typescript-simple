/**
 * MCP Session Metadata Store Interface
 *
 * Provides persistent storage for MCP session metadata to enable horizontal
 * scalability and serverless cold-start survival.
 *
 * Unlike StreamableHTTPServerTransport (which is non-serializable), this
 * stores only lightweight metadata that can be persisted to Redis/KV stores.
 * The actual Server + Transport instances are reconstructed on-demand.
 *
 * Architecture Pattern:
 * - Store: Lightweight session metadata (serializable)
 * - Cache: Server + Transport instances (in-memory, non-serializable)
 * - Reconstruction: Just-in-time instance creation from metadata
 *
 * Based on: https://github.com/yigitkonur/example-mcp-server-streamable-http
 */

import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

/**
 * Serialized event for storage and replay
 */
export interface SerializedEvent {
  eventId: string;
  streamId: string;
  message: JSONRPCMessage;
  timestamp: number;
}

/**
 * Authentication information for session
 */
export interface AuthInfo {
  provider?: string;
  userId?: string;
  email?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * MCP Session metadata stored in persistent storage
 *
 * This is the ONLY data persisted to Redis/KV stores.
 * Server + Transport instances are reconstructed from this metadata.
 */
export interface MCPSessionMetadata {
  /**
   * Unique session identifier (UUID from MCP transport)
   */
  sessionId: string;

  /**
   * Optional authentication information
   */
  authInfo?: AuthInfo;

  /**
   * Session creation timestamp (Unix milliseconds)
   */
  createdAt: number;

  /**
   * Session expiration timestamp (Unix milliseconds)
   *
   * Sessions are automatically deleted when Date.now() > expiresAt.
   * This enables TTL-based cleanup without mutable state.
   */
  expiresAt: number;

  /**
   * Additional custom metadata
   */
  metadata?: Record<string, unknown>;

  /**
   * Event history for resumability (optional)
   *
   * When enabled, stores full event history to support reconnection
   * and event replay. Can be large for long-running sessions.
   */
  events?: SerializedEvent[];
}

/**
 * Interface for MCP session metadata storage
 *
 * Mirrors OAuthSessionStore pattern for consistency.
 */
export interface MCPSessionMetadataStore {
  /**
   * Store session metadata by session ID
   *
   * @param sessionId - Unique session identifier
   * @param metadata - Session metadata to store
   */
  storeSession(sessionId: string, metadata: MCPSessionMetadata): Promise<void>;

  /**
   * Retrieve session metadata by session ID
   *
   * @param sessionId - Unique session identifier
   * @returns Session metadata or null if not found or expired
   */
  getSession(sessionId: string): Promise<MCPSessionMetadata | null>;

  /**
   * Delete session metadata by session ID
   *
   * @param sessionId - Unique session identifier
   */
  deleteSession(sessionId: string): Promise<void>;

  /**
   * Clean up expired sessions
   *
   * @returns Number of sessions cleaned up
   */
  cleanup(): Promise<number>;

  /**
   * Get the number of active sessions (for monitoring)
   *
   * @returns Total active session count
   */
  getSessionCount(): Promise<number>;

  /**
   * Dispose of resources (cleanup timers, connections, etc.)
   */
  dispose(): void;
}
