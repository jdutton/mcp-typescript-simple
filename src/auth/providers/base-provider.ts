/**
 * Base OAuth provider implementation with common functionality
 */

import { randomBytes, createHash } from 'crypto';
import { Request, Response } from 'express';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  OAuthProvider,
  OAuthSession,
  StoredTokenInfo,
  OAuthConfig,
  OAuthEndpoints,
  OAuthProviderType,
  OAuthStateError,
  OAuthTokenError,
  OAuthUserInfo,
  ProviderTokenResponse
} from './types.js';

/**
 * Abstract base class providing common OAuth functionality
 */
export abstract class BaseOAuthProvider implements OAuthProvider {
  protected sessions: Map<string, OAuthSession> = new Map();
  protected tokens: Map<string, StoredTokenInfo> = new Map();
  protected readonly SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes
  protected readonly TOKEN_BUFFER = 60 * 1000; // 1 minute buffer for token expiry
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(protected config: OAuthConfig) {
    // Clean up expired sessions and tokens periodically
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000); // Every 5 minutes
    if (typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  // Abstract methods that must be implemented by concrete providers
  abstract getProviderType(): OAuthProviderType;
  abstract getProviderName(): string;
  abstract getEndpoints(): OAuthEndpoints;
  abstract getDefaultScopes(): string[];
  abstract handleAuthorizationRequest(req: Request, res: Response): Promise<void>;
  abstract handleAuthorizationCallback(req: Request, res: Response): Promise<void>;
  abstract handleTokenRefresh(req: Request, res: Response): Promise<void>;
  abstract handleLogout(req: Request, res: Response): Promise<void>;
  abstract verifyAccessToken(token: string): Promise<AuthInfo>;
  abstract getUserInfo(accessToken: string): Promise<OAuthUserInfo>;

  /**
   * Generate PKCE code verifier and challenge
   */
  protected generatePKCE(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return { codeVerifier, codeChallenge };
  }

  /**
   * Generate a secure random state parameter
   */
  protected generateState(): string {
    return randomBytes(16).toString('hex');
  }

  /**
   * Store OAuth session data
   */
  protected storeSession(state: string, session: OAuthSession): void {
    this.sessions.set(state, session);
  }

  /**
   * Retrieve OAuth session data
   */
  protected getSession(state: string): OAuthSession | undefined {
    const session = this.sessions.get(state);
    if (session && session.expiresAt < Date.now()) {
      this.sessions.delete(state);
      return undefined;
    }
    return session;
  }

  /**
   * Remove OAuth session data
   */
  protected removeSession(state: string): void {
    this.sessions.delete(state);
  }

  /**
   * Store token information
   */
  protected storeToken(accessToken: string, tokenInfo: StoredTokenInfo): void {
    this.tokens.set(accessToken, tokenInfo);
  }

  /**
   * Retrieve token information
   */
  protected getToken(accessToken: string): StoredTokenInfo | undefined {
    const tokenInfo = this.tokens.get(accessToken);
    if (tokenInfo && tokenInfo.expiresAt - this.TOKEN_BUFFER <= Date.now()) {
      this.tokens.delete(accessToken);
      return undefined;
    }
    return tokenInfo;
  }

  /**
   * Remove token information
   */
  protected removeToken(accessToken: string): void {
    this.tokens.delete(accessToken);
  }

  /**
   * Find token by refresh token
   */
  protected findTokenByRefreshToken(refreshToken: string): { accessToken: string; tokenInfo: StoredTokenInfo } | undefined {
    for (const [accessToken, tokenInfo] of this.tokens) {
      if (tokenInfo.refreshToken === refreshToken) {
        return { accessToken, tokenInfo };
      }
    }
    return undefined;
  }

  /**
   * Validate OAuth state parameter
   */
  protected validateState(state: string): OAuthSession {
    if (!state) {
      throw new OAuthStateError('Missing state parameter', this.getProviderType());
    }

    const session = this.getSession(state);
    if (!session) {
      throw new OAuthStateError('Invalid or expired state parameter', this.getProviderType());
    }

    return session;
  }

  /**
   * Build authorization URL with PKCE
   */
  protected buildAuthorizationUrl(
    authUrl: string,
    state: string,
    codeChallenge: string,
    scopes: string[] = this.getDefaultScopes()
  ): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      scope: scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return `${authUrl}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  protected async exchangeCodeForTokens(
    tokenUrl: string,
    code: string,
    codeVerifier: string,
    additionalParams: Record<string, string> = {}
  ): Promise<ProviderTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: this.config.redirectUri,
      ...additionalParams,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new OAuthTokenError(
        `Token exchange failed: ${response.status} ${response.statusText}`,
        this.getProviderType(),
        { status: response.status, body: errorText }
      );
    }

    return response.json() as Promise<ProviderTokenResponse>;
  }

  /**
   * Refresh access token using refresh token
   */
  protected async refreshAccessToken(
    tokenUrl: string,
    refreshToken: string,
    additionalParams: Record<string, string> = {}
  ): Promise<ProviderTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      ...additionalParams,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new OAuthTokenError(
        `Token refresh failed: ${response.status} ${response.statusText}`,
        this.getProviderType(),
        { status: response.status, body: errorText }
      );
    }

    return response.json() as Promise<ProviderTokenResponse>;
  }

  /**
   * Check if a token is valid and not expired
   */
  async isTokenValid(token: string): Promise<boolean> {
    try {
      const tokenInfo = this.getToken(token);
      if (!tokenInfo) {
        return false;
      }

      // Check expiration with buffer
      if (tokenInfo.expiresAt - this.TOKEN_BUFFER <= Date.now()) {
        this.removeToken(token);
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current session count for monitoring
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Get current token count for monitoring
   */
  getTokenCount(): number {
    return this.tokens.size;
  }

  /**
   * Clean up expired sessions and tokens
   */
  cleanup(): void {
    const now = Date.now();

    // Clean up expired sessions
    for (const [state, session] of this.sessions) {
      if (session.expiresAt < now) {
        this.sessions.delete(state);
      }
    }

    // Clean up expired tokens
    for (const [token, info] of this.tokens) {
      if (info.expiresAt < now) {
        this.tokens.delete(token);
      }
    }
  }

  dispose(): void {
    clearInterval(this.cleanupTimer);
  }
}
