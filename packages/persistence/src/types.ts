/**
 * Persistence layer type definitions
 *
 * These types are extracted from the main application to support the
 * persistence package's independence while maintaining type safety.
 */

/**
 * Supported OAuth provider types
 */
export type OAuthProviderType = 'google' | 'github' | 'microsoft' | 'generic';

/**
 * OAuth user information structure
 */
export interface OAuthUserInfo {
  sub: string;          // Subject identifier (unique user ID)
  email: string;        // User email address
  name: string;         // Display name
  picture?: string;     // Profile picture URL
  provider: string;     // Provider name
  providerData?: Record<string, unknown>;   // Provider-specific additional data
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
