/**
 * Persistence layer type definitions
 *
 * These types are extracted from the main application to support the
 * persistence package's independence while maintaining type safety.
 */

import type { AuthInfo } from './interfaces/mcp-metadata-store.js';

/**
 * Supported OAuth provider types
 */
export type OAuthProviderType = 'google' | 'github' | 'microsoft' | 'generic';

/**
 * Re-export AuthInfo from mcp-metadata-store to avoid duplication
 */
export type { AuthInfo };

/**
 * OAuth user information structure
 */
export interface OAuthUserInfo {
  sub: string;          // Subject identifier (unique user ID)
  email: string;        // User email address
  name: string;         // Display name
  picture?: string;     // Profile picture URL
  provider: string;     // Provider name
  providerData?: unknown;   // Provider-specific additional data
}

/**
 * OAuth session data structure
 *
 * Stores temporary session information during OAuth authorization flow.
 * Expires after a short time (typically 10 minutes).
 */
export interface OAuthSession {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  redirectUri: string;
  clientRedirectUri?: string; // Original client redirect URI (e.g., MCP Inspector, Claude Code)
  clientState?: string; // Original client state parameter (for OAuth clients that manage their own state)
  scopes: string[];
  provider: OAuthProviderType;
  expiresAt: number;
}

/**
 * Stored token information with user data
 *
 * Long-lived OAuth access token storage with associated user information.
 */
export interface StoredTokenInfo {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
  userInfo: OAuthUserInfo;
  provider: OAuthProviderType;
  scopes: string[];
}

/**
 * Session-based authentication cache (ADR 006)
 *
 * Stores authentication information within session metadata to eliminate
 * the need for separate token storage.
 *
 * Key Design Principles:
 * - NO bearer tokens stored (only SHA-256 hashes)
 * - Token binding prevents substitution attacks
 * - JWT validation is local (no API calls)
 * - Opaque token validation uses TTL-based caching
 * - Client manages token lifecycle (refresh)
 *
 * @see docs/adr/006-session-based-auth-caching.md
 */
export interface SessionAuthCache {
  /**
   * OAuth provider identity
   */
  provider: OAuthProviderType;

  /**
   * User identity from OAuth (sub claim)
   */
  userId: string;

  /**
   * User email address (optional)
   */
  email?: string;

  /**
   * Granted OAuth scopes
   */
  scopes: string[];

  /**
   * Full MCP SDK AuthInfo structure (cached from provider)
   */
  authInfo: {
    token: string;
    clientId: string;
    scopes: string[];
    expiresAt: number;
    extra?: Record<string, unknown>;
  };

  /**
   * SHA-256 hash of current access token (NOT the token itself)
   * Used for token binding verification and refresh detection
   */
  tokenHash: string;

  /**
   * Timestamp when token binding was established (Unix milliseconds)
   */
  tokenBindingTime: number;

  /**
   * Timestamp of last provider validation (Unix milliseconds)
   * Used for opaque token TTL-based caching
   */
  lastValidated?: number;

  /**
   * Time-to-live before re-validation required (milliseconds)
   * Default: 300000ms (5 minutes)
   * Only applicable for opaque tokens (GitHub)
   */
  validationTTL?: number;
}

/**
 * Session information
 * Moved from http-server to avoid circular dependency
 */
export interface SessionInfo {
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  authInfo?: AuthInfo; // Deprecated - use auth.authInfo (kept for backward compatibility during migration)
  auth?: SessionAuthCache; // NEW: Session-based authentication cache (ADR 006)
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
 * Moved from http-server to avoid circular dependency
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
    _authInfo?: AuthInfo,
    _metadata?: Record<string, unknown>,
    _sessionId?: string
  ): Promise<SessionInfo>;

  /**
   * Get session information by ID
   *
   * @param sessionId - Unique session identifier
   * @returns Session info or undefined if not found or expired
   */
  getSession(_sessionId: string): Promise<SessionInfo | undefined>;

  /**
   * Check if session is valid (exists and not expired)
   *
   * @param sessionId - Unique session identifier
   * @returns True if session is valid
   */
  isSessionValid(_sessionId: string): Promise<boolean>;

  /**
   * Close and delete session by ID
   *
   * @param sessionId - Unique session identifier
   */
  deleteSession(_sessionId: string): Promise<void>;

  /**
   * Get session statistics
   *
   * @returns Session statistics
   */
  getStats(): Promise<SessionStats>;

  /**
   * Clean up expired sessions
   */
  cleanup(): Promise<void>;
}
