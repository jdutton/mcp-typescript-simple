/**
 * Base OAuth provider implementation with common functionality
 */

import { randomBytes, createHash } from 'crypto';
import { Request, Response } from 'express';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { EnvironmentConfig } from '../../config/environment.js';
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
import { logger } from '../../utils/logger.js';

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

  /**
   * Log debug information with environment-aware verbosity
   * Reduces sensitive data exposure in production
   */
  protected logDebug(message: string, sensitiveData?: Record<string, unknown>): void {
    const isProduction = EnvironmentConfig.isProduction();

    if (isProduction) {
      // Production: minimal logging, no sensitive data
      logger.oauthInfo(message);
    } else {
      // Development: detailed logging with sensitive data redacted
      if (sensitiveData) {
        const redactedData: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(sensitiveData)) {
          if (typeof value === 'string' && value.length > 16) {
            // Redact long strings that might be tokens
            redactedData[key] = `${value.substring(0, 8)}...${value.substring(value.length - 8)}`;
          } else {
            redactedData[key] = value;
          }
        }
        logger.oauthDebug(message, redactedData);
      } else {
        logger.oauthDebug(message);
      }
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
   * Set anti-caching headers for OAuth responses per RFC 6749 and RFC 9700
   * These headers prevent sensitive OAuth data from being cached
   */
  protected setAntiCachingHeaders(res: Response): void {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

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
    this.logDebug(
      `Storing session for provider: ${this.getProviderType()}`,
      {
        statePrefix: state.substring(0, 8),
        expires: new Date(session.expiresAt).toISOString(),
        totalSessions: this.sessions.size + 1
      }
    );
    this.sessions.set(state, session);
  }

  /**
   * Retrieve OAuth session data
   */
  protected getSession(state: string): OAuthSession | undefined {
    const session = this.sessions.get(state);

    if (!session) {
      this.logDebug(
        `Session not found`,
        {
          statePrefix: state.substring(0, 8),
          totalSessions: this.sessions.size,
          provider: this.getProviderType()
        }
      );
      return undefined;
    }

    const now = Date.now();
    const isExpired = session.expiresAt < now;

    this.logDebug(
      `Session lookup result`,
      {
        statePrefix: state.substring(0, 8),
        expires: new Date(session.expiresAt).toISOString(),
        isExpired,
        provider: this.getProviderType()
      }
    );

    if (isExpired) {
      this.logDebug(`Session expired, removing from storage`);
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
    this.logDebug(
      `Token stored successfully`,
      {
        provider: this.getProviderType(),
        tokenKey: accessToken,
        expires: new Date(tokenInfo.expiresAt).toISOString(),
        userEmail: tokenInfo.userInfo.email,
        totalTokens: this.tokens.size + 1
      }
    );
    this.tokens.set(accessToken, tokenInfo);
  }

  /**
   * Retrieve token information
   */
  protected getToken(accessToken: string): StoredTokenInfo | undefined {
    const tokenInfo = this.tokens.get(accessToken);

    if (!tokenInfo) {
      this.logDebug(
        `Token not found in local storage`,
        {
          provider: this.getProviderType(),
          tokenKey: accessToken,
          totalTokens: this.tokens.size
        }
      );
      return undefined;
    }

    const now = Date.now();
    const expiresAt = tokenInfo.expiresAt - this.TOKEN_BUFFER;
    const isExpired = expiresAt <= now;

    this.logDebug(
      `Token lookup result`,
      {
        provider: this.getProviderType(),
        tokenKey: accessToken,
        expires: new Date(tokenInfo.expiresAt).toISOString(),
        isExpired
      }
    );

    if (isExpired) {
      this.logDebug(`Token expired, removing from storage`);
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
    this.logDebug(
      `Validating state parameter`,
      {
        provider: this.getProviderType(),
        statePrefix: state?.substring(0, 8)
      }
    );

    if (!state) {
      throw new OAuthStateError('Missing state parameter', this.getProviderType());
    }

    const session = this.getSession(state);
    if (!session) {
      // Log context for debugging in development only
      this.logDebug(
        `OAuth state validation failed`,
        {
          statePrefix: state.substring(0, 8),
          sessionsCount: this.sessions.size,
          provider: this.getProviderType()
        }
      );

      throw new OAuthStateError(
        'Invalid or expired state parameter. This could be due to browser caching, multiple tabs, or server restart. Please try the authentication flow again.',
        this.getProviderType()
      );
    }

    logger.oauthDebug('State validation successful');
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
   * Extract MCP Inspector client parameters from authorization request
   * Common pattern across all OAuth providers for MCP Inspector compatibility
   */
  protected extractClientParameters(req: Request): {
    clientRedirectUri?: string;
    clientCodeChallenge?: string;
    clientCodeChallengeMethod?: string;
    clientState?: string;
    clientId?: string;
  } {
    const providerName = this.getProviderName();
    logger.oauthDebug('Starting authorization request', { provider: providerName });
    logger.oauthDebug('Query parameters', { provider: providerName, query: req.query });

    return {
      clientRedirectUri: req.query.redirect_uri as string,
      clientCodeChallenge: req.query.code_challenge as string,
      clientCodeChallengeMethod: req.query.code_challenge_method as string,
      clientState: req.query.state as string,
      clientId: req.query.client_id as string,
    };
  }

  /**
   * Setup PKCE parameters for authorization request
   * Handles both client-provided and server-generated PKCE codes
   */
  protected setupPKCE(clientCodeChallenge?: string): {
    state: string;
    codeVerifier: string;
    codeChallenge: string;
  } {
    const providerName = this.getProviderName();
    const state = this.generateState();
    let codeVerifier = '';
    let codeChallenge = clientCodeChallenge || '';

    // If no client code challenge provided, generate our own PKCE pair
    if (!clientCodeChallenge) {
      const pkce = this.generatePKCE();
      codeVerifier = pkce.codeVerifier;
      codeChallenge = pkce.codeChallenge;
    }
    // If client provided challenge, we don't have the verifier (client keeps it)

    logger.oauthDebug('Using state', { provider: providerName, statePrefix: state.substring(0, 8) });
    logger.oauthDebug('Using code challenge', { provider: providerName, codeChallengePrefix: codeChallenge.substring(0, 8) });

    return { state, codeVerifier, codeChallenge };
  }

  /**
   * Handle client redirect flow for MCP Inspector compatibility
   * Returns true if client redirect was handled, false if should continue with normal flow
   */
  protected handleClientRedirect(
    session: OAuthSession,
    code: string,
    state: string,
    res: Response
  ): boolean {
    const providerName = this.getProviderName();

    if (session.clientRedirectUri) {
      logger.oauthInfo('Redirecting back to client', {
        provider: providerName,
        clientRedirectUri: session.clientRedirectUri
      });
      logger.oauthDebug('Client will handle token exchange with code_verifier', { provider: providerName });

      // Build redirect URL with authorization code (OAuth standard flow)
      const redirectUrl = new URL(session.clientRedirectUri);
      redirectUrl.searchParams.set('code', code);
      redirectUrl.searchParams.set('state', state);

      // Clean up session since we're done with this flow
      this.removeSession(state);

      this.setAntiCachingHeaders(res);
      res.redirect(redirectUrl.toString());
      return true; // Indicates redirect was handled
    }

    return false; // Continue with normal flow
  }

  /**
   * Common validation for token exchange requests (RFC 6749 Section 4.1.3)
   * Used by handleTokenExchange implementations across all providers
   */
  protected validateTokenExchangeRequest(req: Request, res: Response): {
    isValid: boolean;
    grant_type?: string;
    code?: string;
    code_verifier?: string;
    client_id?: string;
    redirect_uri?: string;
  } {
    const providerName = this.getProviderName();
    logger.oauthDebug('Handling token exchange from form data', { provider: providerName });

    const { grant_type, code, code_verifier, client_id, redirect_uri } = req.body;

    // Validate grant_type (RFC 6749 Section 4.1.3)
    if (grant_type !== 'authorization_code') {
      res.status(400).json({
        error: 'unsupported_grant_type',
        error_description: 'Only authorization_code grant type is supported'
      });
      return { isValid: false };
    }

    // Validate required parameters (RFC 6749 Section 4.1.3)
    if (!code) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing required parameter: code'
      });
      return { isValid: false };
    }

    logger.oauthDebug('Using code_verifier from client', {
      provider: providerName,
      codeVerifierPrefix: code_verifier?.substring(0, 8)
    });
    logger.oauthDebug('Using redirect_uri', { provider: providerName, redirectUri: this.config.redirectUri });

    return {
      isValid: true,
      grant_type,
      code,
      code_verifier,
      client_id,
      redirect_uri
    };
  }

  /**
   * Create a complete OAuth session with client redirect support
   */
  protected createOAuthSession(
    state: string,
    codeVerifier: string,
    codeChallenge: string,
    clientRedirectUri?: string,
    customScopes?: string[]
  ): OAuthSession {
    const providerName = this.getProviderName();

    if (clientRedirectUri) {
      logger.oauthDebug('Client redirect URI', { provider: providerName, clientRedirectUri });
    }

    return {
      state,
      codeVerifier, // Empty if using client's challenge, populated if we generated it
      codeChallenge,
      redirectUri: this.config.redirectUri,
      clientRedirectUri, // Store MCP Inspector's redirect URI
      scopes: customScopes || (this.config.scopes.length > 0 ? this.config.scopes : this.getDefaultScopes()),
      provider: this.getProviderType(),
      expiresAt: Date.now() + this.SESSION_TIMEOUT,
    };
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
