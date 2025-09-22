/**
 * OAuth provider interface and types for multi-provider authentication
 */

import { Request, Response } from 'express';
import { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

/**
 * Supported OAuth provider types
 */
export type OAuthProviderType = 'google' | 'github' | 'microsoft' | 'generic';

/**
 * Base configuration for any OAuth provider
 */
export interface BaseOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
}

/**
 * Google-specific OAuth configuration
 */
export interface GoogleOAuthConfig extends BaseOAuthConfig {
  type: 'google';
}

/**
 * GitHub-specific OAuth configuration
 */
export interface GitHubOAuthConfig extends BaseOAuthConfig {
  type: 'github';
}

/**
 * Microsoft Azure AD OAuth configuration
 */
export interface MicrosoftOAuthConfig extends BaseOAuthConfig {
  type: 'microsoft';
  tenantId?: string; // Optional tenant ID for Azure AD
}

/**
 * Generic OAuth provider configuration for custom providers
 */
export interface GenericOAuthConfig extends BaseOAuthConfig {
  type: 'generic';
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  revocationUrl?: string;
  providerName: string;
}

/**
 * Union type for all OAuth configurations
 */
export type OAuthConfig =
  | GoogleOAuthConfig
  | GitHubOAuthConfig
  | MicrosoftOAuthConfig
  | GenericOAuthConfig;

/**
 * OAuth provider endpoints information
 */
export interface OAuthEndpoints {
  authEndpoint: string;
  callbackEndpoint: string;
  refreshEndpoint: string;
  logoutEndpoint: string;
}

/**
 * User information returned from OAuth providers
 */
export interface OAuthUserInfo {
  sub: string;          // Subject identifier (unique user ID)
  email: string;        // User email address
  name: string;         // Display name
  picture?: string;     // Profile picture URL
  provider: string;     // Provider name
  providerData?: any;   // Provider-specific additional data
}

/**
 * OAuth token response from provider
 */
export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  user: OAuthUserInfo;
}

export interface ProviderTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  [key: string]: unknown;
}

/**
 * OAuth session data stored during the flow
 */
export interface OAuthSession {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  provider: OAuthProviderType;
  expiresAt: number;
}

/**
 * Stored token information with user data
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
 * Main OAuth provider interface that all providers must implement
 */
export interface OAuthProvider extends OAuthTokenVerifier {
  /**
   * Get the provider type/name
   */
  getProviderType(): OAuthProviderType;

  /**
   * Get the provider's human-readable name
   */
  getProviderName(): string;

  /**
   * Get the OAuth endpoints for this provider
   */
  getEndpoints(): OAuthEndpoints;

  /**
   * Get the default scopes for this provider
   */
  getDefaultScopes(): string[];

  /**
   * Initiate OAuth authorization flow
   * Redirects the user to the provider's authorization page
   */
  handleAuthorizationRequest(req: Request, res: Response): Promise<void>;

  /**
   * Handle OAuth authorization callback
   * Processes the authorization code and exchanges it for tokens
   */
  handleAuthorizationCallback(req: Request, res: Response): Promise<void>;

  /**
   * Handle token refresh requests
   * Refreshes an expired access token using the refresh token
   */
  handleTokenRefresh(req: Request, res: Response): Promise<void>;

  /**
   * Handle logout requests
   * Revokes tokens and cleans up session data
   */
  handleLogout(req: Request, res: Response): Promise<void>;

  /**
   * Verify an access token and return auth info
   * Implementation of OAuthTokenVerifier interface
   */
  verifyAccessToken(token: string): Promise<AuthInfo>;

  /**
   * Get user information from an access token
   */
  getUserInfo(accessToken: string): Promise<OAuthUserInfo>;

  /**
   * Check if a token is valid and not expired
   */
  isTokenValid(token: string): Promise<boolean>;

  /**
   * Get the current session count for monitoring
   */
  getSessionCount(): number;

  /**
   * Get the current token count for monitoring
   */
  getTokenCount(): number;

  /**
   * Clean up expired sessions and tokens
   */
  cleanup(): void;

  /**
   * Release resources held by the provider (timers, open handles, etc.)
   */
  dispose(): void;
}

/**
 * OAuth provider factory interface
 */
export interface OAuthProviderFactory {
  /**
   * Create an OAuth provider instance based on configuration
   */
  createProvider(config: OAuthConfig): OAuthProvider;

  /**
   * Get list of supported provider types
   */
  getSupportedProviders(): OAuthProviderType[];

  /**
   * Check if a provider type is supported
   */
  isProviderSupported(type: string): type is OAuthProviderType;
}

/**
 * OAuth error types
 */
export class OAuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public provider?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

export class OAuthStateError extends OAuthError {
  constructor(message: string, provider?: string) {
    super(message, 'invalid_state', provider);
    this.name = 'OAuthStateError';
  }
}

export class OAuthTokenError extends OAuthError {
  constructor(message: string, provider?: string, details?: any) {
    super(message, 'token_error', provider, details);
    this.name = 'OAuthTokenError';
  }
}

export class OAuthProviderError extends OAuthError {
  constructor(message: string, provider?: string, details?: any) {
    super(message, 'provider_error', provider, details);
    this.name = 'OAuthProviderError';
  }
}
