/**
 * Base OAuth provider implementation with common functionality
 */

import { randomBytes, createHash } from 'node:crypto';
import { Request, Response } from 'express';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { EnvironmentConfig } from '@mcp-typescript-simple/config';
import {
  OAuthProvider,
  OAuthSession,
  StoredTokenInfo,
  OAuthConfig,
  OAuthEndpoints,
  OAuthProviderType,
  OAuthStateError,
  OAuthTokenError,
  OAuthProviderError,
  OAuthUserInfo,
  OAuthTokenResponse,
  ProviderTokenResponse
} from './types.js';
import { logger } from '../utils/logger.js';
import { loadAllowlistConfig, checkAllowlistAuthorization, type AllowlistConfig } from '../allowlist.js';
import { OAuthSessionStore , MemorySessionStore , OAuthTokenStore , MemoryOAuthTokenStore , PKCEStore } from '@mcp-typescript-simple/persistence';
import { logonEvent, logoffEvent, emitOCSFEvent, StatusId } from '@mcp-typescript-simple/observability/ocsf';

/**
 * Abstract base class providing common OAuth functionality
 */
export abstract class BaseOAuthProvider implements OAuthProvider {
  protected sessionStore: OAuthSessionStore;
  protected tokenStore: OAuthTokenStore;
  protected pkceStore: PKCEStore;
  protected readonly SESSION_TIMEOUT = 10 * 60 * 1000; // 10 minutes
  protected readonly TOKEN_BUFFER = 60 * 1000; // 1 minute buffer for token expiry
  protected readonly DEFAULT_TOKEN_EXPIRATION_SECONDS = 60 * 60; // 1 hour default when provider doesn't supply expiration
  // PKCE TTL: 10 minutes - balances security (short-lived codes) with UX (user has time to complete OAuth flow)
  // Matches OAuth 2.0 recommendation for authorization code lifetime (RFC 6749 §4.1.2)
  protected readonly PKCE_TTL_SECONDS = 600;
  private readonly cleanupTimer: NodeJS.Timeout;
  protected readonly allowlistConfig: AllowlistConfig;

  /**
   * Get a safe prefix from a sensitive value for logging
   * @param value The sensitive value (code, verifier, etc.)
   * @param length Number of characters to include (default: 10)
   * @returns Safe prefix for logging (e.g., "abc123defg...")
   */
  private getSafePrefix(value: string, length: number = 10): string {
    return value.substring(0, length);
  }

  /**
   * Get stored code_verifier for an authorization code (OAuth proxy PKCE)
   * Returns the server's code_verifier if it was stored, undefined otherwise
   */
  protected async getStoredCodeVerifier(code: string): Promise<string | undefined> {
    const data = await this.pkceStore.getCodeVerifier(this.getProviderCodeKey(code));
    if (data) {
      logger.oauthDebug('Retrieved stored code_verifier', {
        provider: this.getProviderName(),
        codePrefix: this.getSafePrefix(code),
        verifierPrefix: this.getSafePrefix(data.codeVerifier)
      });
      return data.codeVerifier;
    }

    // Warning: PKCE lookup failed - could indicate multi-instance issue or code reuse
    logger.oauthWarn('PKCE lookup failed - code_verifier not found', {
      provider: this.getProviderName(),
      codePrefix: this.getSafePrefix(code)
    });

    return undefined;
  }

  /**
   * Resolve code_verifier for token exchange with security validation
   *
   * Security Model:
   * - OAuth Proxy Flow: Server generates PKCE, stores code_verifier, client gets authorization code
   *   → MUST use server-stored code_verifier (client doesn't have it)
   * - Direct OAuth Flow: Client generates PKCE, sends code_challenge to server
   *   → MUST use client-provided code_verifier (server doesn't store it)
   *
   * This prevents PKCE bypass attacks where a malicious client could provide their own
   * code_verifier for a code issued through the OAuth proxy flow.
   *
   * @param code Authorization code from OAuth provider
   * @param clientCodeVerifier code_verifier provided by client in token exchange request
   * @returns code_verifier to use for token exchange, or undefined if invalid
   */
  protected async resolveCodeVerifierForTokenExchange(code: string, clientCodeVerifier?: string): Promise<string | undefined> {
    const storedCodeVerifier = await this.getStoredCodeVerifier(code);

    // OAuth Proxy Flow: Server generated PKCE and stored it
    // Client MUST NOT provide code_verifier (they don't have it)
    if (storedCodeVerifier) {
      if (clientCodeVerifier) {
        logger.oauthWarn('OAuth Proxy Flow: Client attempted to provide code_verifier when server already stored one', {
          provider: this.getProviderType(),
          codePrefix: this.getSafePrefix(code),
          storedVerifierPrefix: this.getSafePrefix(storedCodeVerifier),
          clientVerifierPrefix: this.getSafePrefix(clientCodeVerifier),
          message: 'Ignoring client code_verifier for security (using server-stored)'
        });
      }
      return storedCodeVerifier;
    }

    // Direct OAuth Flow: Client generated PKCE (sent code_challenge)
    // Client MUST provide code_verifier
    if (clientCodeVerifier) {
      logger.oauthDebug('Direct OAuth Flow: Using client-provided code_verifier', {
        provider: this.getProviderType(),
        codePrefix: this.getSafePrefix(code),
        verifierPrefix: this.getSafePrefix(clientCodeVerifier)
      });
      return clientCodeVerifier;
    }

    // Invalid: No code_verifier available from either source
    logger.oauthError('Token exchange failed: No code_verifier available', {
      provider: this.getProviderType(),
      codePrefix: this.getSafePrefix(code),
      hasStored: !!storedCodeVerifier,
      hasClient: !!clientCodeVerifier,
      message: 'Authorization code may have expired or been used already'
    });

    return undefined;
  }

  /**
   * Log token exchange request with standardized format
   */
  protected async logTokenExchangeRequest(
    code: string,
    clientCodeVerifier?: string,
    redirectUri?: string
  ): Promise<void> {
    const storedCodeVerifier = await this.getStoredCodeVerifier(code);
    const codeVerifierToUse = storedCodeVerifier ?? clientCodeVerifier;

    logger.oauthInfo('Token exchange request', {
      provider: this.getProviderType(),
      clientProvidedRedirectUri: redirectUri,
      clientProvidedCodeVerifier: clientCodeVerifier?.substring(0, 10),
      serverStoredCodeVerifier: storedCodeVerifier?.substring(0, 10),
      usingCodeVerifier: codeVerifierToUse?.substring(0, 10),
      serverRedirectUri: this._config.redirectUri,
      hasCode: !!code,
      codeLength: code?.length
    });
  }

  /**
   * Clean up after successful token exchange
   * Removes the authorization code mapping and the associated session
   * Uses atomic get-and-delete to prevent code reuse attacks
   */
  protected async cleanupAfterTokenExchange(code: string): Promise<void> {
    // Atomically retrieve and delete PKCE data to prevent code reuse
    const data = await this.pkceStore.getAndDeleteCodeVerifier(this.getProviderCodeKey(code));
    if (data) {
      // Clean up session
      await this.removeSession(data.state);

      logger.oauthDebug('Cleaned up after token exchange', {
        provider: this.getProviderName(),
        codePrefix: code.substring(0, 10),
        statePrefix: data.state.substring(0, 8)
      });
    }
  }

  /**
   * Check if this provider has a stored code_verifier for the given authorization code
   *
   * Multi-Provider Routing Mechanism:
   * ===================================
   * When multiple OAuth providers are enabled simultaneously (Google, GitHub, Microsoft),
   * the server needs to route token exchange requests to the correct provider.
   *
   * How It Works:
   * -------------
   * 1. Authorization Request: Client initiates OAuth flow with specific provider
   *    Example: GET /auth/google/authorize
   *
   * 2. Provider Stores Code: When provider redirects back with authorization code,
   *    server stores code → { codeVerifier, state } in PKCE store with provider-specific key
   *
   * 3. Token Exchange: Client calls unified endpoint with authorization code
   *    Example: POST /auth/token with { code: "abc123" }
   *
   * 4. Provider Identification: Server checks each provider's PKCE store:
   *    - googleProvider.hasStoredCodeForProvider("abc123") → true ✅
   *    - githubProvider.hasStoredCodeForProvider("abc123") → false
   *    - microsoftProvider.hasStoredCodeForProvider("abc123") → false
   *
   * 5. Route to Correct Provider: Token exchange is routed to Google provider
   *
   * Code Collision Prevention:
   * --------------------------
   * Authorization codes are globally unique UUIDs issued by OAuth providers, making
   * collisions between different providers virtually impossible (2^128 possibilities).
   * Each provider maintains its own PKCE store namespace.
   *
   * @param code Authorization code from OAuth provider
   * @returns true if this provider has PKCE data for the code, false otherwise
   */
  async hasStoredCodeForProvider(code: string): Promise<boolean> {
    return await this.pkceStore.hasCodeVerifier(this.getProviderCodeKey(code));
  }

  /**
   * Create a provider-namespaced key for PKCE storage.
   * This prevents code collisions when multiple providers share the same PKCE store.
   *
   * @param code Authorization code from OAuth provider
   * @returns Namespaced key: "{providerType}:{code}"
   */
  protected getProviderCodeKey(code: string): string {
    return `${this.getProviderType()}:${code}`;
  }

  constructor(
    protected _config: OAuthConfig,
    sessionStore?: OAuthSessionStore,
    tokenStore?: OAuthTokenStore,
    pkceStore?: PKCEStore
  ) {
    // Use provided stores or default to memory stores
    this.sessionStore = sessionStore ?? new MemorySessionStore();
    this.tokenStore = tokenStore ?? new MemoryOAuthTokenStore();

    // PKCE store is required - throw error if not provided
    if (!pkceStore) {
      throw new Error('PKCEStore is required for OAuth providers. Use RedisPKCEStore for multi-instance deployments.');
    }
    this.pkceStore = pkceStore;

    // Load allowlist configuration
    this.allowlistConfig = loadAllowlistConfig();

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
  abstract handleTokenRefresh(req: Request, res: Response): Promise<void>;

  /**
   * Fetch user information from provider's API
   *
   * Each provider implements this to fetch user data from their specific endpoint.
   * This is the ONLY provider-specific method that differs between implementations.
   *
   * @param accessToken - Valid access token
   * @returns User information in standardized format
   */
  protected abstract fetchUserInfo(accessToken: string): Promise<OAuthUserInfo>;

  /**
   * Get token URL for this provider (must be implemented by subclasses)
   *
   * This method returns the token endpoint URL used for token exchange.
   *
   * @returns Token endpoint URL
   */
  protected abstract getTokenUrl(): string;

  /**
   * Optional hook for provider-specific token revocation
   *
   * Default implementation does nothing. Providers like Microsoft that support
   * token revocation can override this method.
   *
   * @param accessToken - Token to revoke
   */
  protected async revokeToken(accessToken: string): Promise<void> {
    // Default: no-op
    // Microsoft will override this
  }

  /**
   * Build AuthInfo from cached token information
   *
   * Use this when token is found in local token store with complete metadata.
   */
  protected buildAuthInfoFromCache(
    token: string,
    tokenInfo: StoredTokenInfo
  ): AuthInfo {
    return {
      token,
      clientId: this._config.clientId,
      scopes: tokenInfo.scopes,
      expiresAt: Math.floor(tokenInfo.expiresAt / 1000),
      extra: {
        userInfo: tokenInfo.userInfo,
        provider: this.getProviderType(),
      },
    };
  }

  /**
   * Build AuthInfo from fresh user info without provider-supplied expiration
   *
   * Use this when verifying token directly with provider API and the provider
   * doesn't return token expiration info (GitHub, Microsoft).
   * Applies DEFAULT_TOKEN_EXPIRATION_SECONDS (1 hour).
   */
  protected buildAuthInfoFromUserInfo(
    token: string,
    userInfo: OAuthUserInfo,
    scopes?: string[]
  ): AuthInfo {
    const expiresAt = Math.floor(Date.now() / 1000) + this.DEFAULT_TOKEN_EXPIRATION_SECONDS;

    return {
      token,
      clientId: this._config.clientId,
      scopes: scopes ?? this.getDefaultScopes(),
      expiresAt,
      extra: {
        userInfo,
        provider: this.getProviderType(),
      },
    };
  }

  /**
   * Build AuthInfo with custom expiration timestamp
   *
   * Use this when provider supplies token expiration info (Google with expiry_date).
   *
   * @param expiresAtSeconds - Unix timestamp in seconds when token expires
   */
  protected buildAuthInfoWithExpiration(
    token: string,
    userInfo: OAuthUserInfo,
    expiresAtSeconds: number,
    scopes?: string[]
  ): AuthInfo {
    return {
      token,
      clientId: this._config.clientId,
      scopes: scopes ?? this.getDefaultScopes(),
      expiresAt: expiresAtSeconds,
      extra: {
        userInfo,
        provider: this.getProviderType(),
      },
    };
  }

  /**
   * Check if user is authorized based on allowlist
   * Returns error message if not authorized, undefined if authorized
   */
  protected checkUserAllowlist(userEmail: string | undefined): string | undefined {
    return checkAllowlistAuthorization(userEmail, this.allowlistConfig);
  }

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
  protected async storeSession(state: string, session: OAuthSession): Promise<void> {
    this.logDebug(
      `Storing session for provider: ${this.getProviderType()}`,
      {
        statePrefix: state.substring(0, 8),
        expires: new Date(session.expiresAt).toISOString()
      }
    );
    await this.sessionStore.storeSession(state, session);
  }

  /**
   * Retrieve OAuth session data
   */
  protected async getSession(state: string): Promise<OAuthSession | null> {
    const session = await this.sessionStore.getSession(state);

    if (!session) {
      this.logDebug(
        `Session not found`,
        {
          statePrefix: state.substring(0, 8),
          provider: this.getProviderType()
        }
      );
      return null;
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
      await this.sessionStore.deleteSession(state);
      return null;
    }

    return session;
  }

  /**
   * Remove OAuth session data
   */
  protected async removeSession(state: string): Promise<void> {
    await this.sessionStore.deleteSession(state);
  }

  /**
   * Store token information
   */
  protected async storeToken(accessToken: string, tokenInfo: StoredTokenInfo): Promise<void> {
    this.logDebug(
      `Token stored successfully`,
      {
        provider: this.getProviderType(),
        tokenKey: accessToken,
        expires: new Date(tokenInfo.expiresAt).toISOString(),
        userEmail: tokenInfo.userInfo.email
      }
    );
    await this.tokenStore.storeToken(accessToken, tokenInfo);
  }

  /**
   * Retrieve token information
   */
  protected async getToken(accessToken: string): Promise<StoredTokenInfo | null> {
    const tokenInfo = await this.tokenStore.getToken(accessToken);

    if (!tokenInfo) {
      this.logDebug(
        `Token not found in storage`,
        {
          provider: this.getProviderType(),
          tokenKey: accessToken
        }
      );
      return null;
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
      await this.tokenStore.deleteToken(accessToken);
      return null;
    }

    return tokenInfo;
  }

  /**
   * Remove token information (RFC 7009 token revocation)
   * Public method accessible for universal revoke endpoint
   */
  async removeToken(accessToken: string): Promise<void> {
    await this.tokenStore.deleteToken(accessToken);
  }

  /**
   * Get token store instance (for optimized multi-provider routing)
   * @internal Used by oauth-routes for efficient provider selection
   */
  getTokenStore(): OAuthTokenStore {
    return this.tokenStore;
  }

  /**
   * Check if this provider has a token in its local store (no external API call)
   * Fast, local-only lookup to identify which provider owns a token
   */
  async hasToken(accessToken: string): Promise<boolean> {
    try {
      const tokenInfo = await this.tokenStore.getToken(accessToken);
      return tokenInfo !== null && tokenInfo.provider === this.getProviderType();
    } catch (error) {
      this.logDebug('Token lookup failed in hasToken', { error });
      return false;
    }
  }

  /**
   * Find token by refresh token
   */
  protected async findTokenByRefreshToken(refreshToken: string): Promise<{ accessToken: string; tokenInfo: StoredTokenInfo } | undefined> {
    const result = await this.tokenStore.findByRefreshToken(refreshToken);
    return result ?? undefined;
  }

  /**
   * Validate OAuth state parameter
   */
  protected async validateState(state: string): Promise<OAuthSession> {
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

    const session = await this.getSession(state);
    if (!session) {
      // Log context for debugging in development only
      this.logDebug(
        `OAuth state validation failed`,
        {
          statePrefix: state.substring(0, 8),
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
      client_id: this._config.clientId,
      response_type: 'code',
      redirect_uri: this._config.redirectUri,
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
    additionalParams: Record<string, string> = {},
    redirectUri?: string
  ): Promise<ProviderTokenResponse> {
    const params: Record<string, string> = {
      client_id: this._config.clientId,
      client_secret: this._config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri ?? this._config.redirectUri,
      ...additionalParams,
    };

    // Include code_verifier for PKCE validation (RFC 7636)
    if (codeVerifier) {
      params.code_verifier = codeVerifier;
    }

    const urlParams = new URLSearchParams(params);

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: urlParams.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.oauthError('Token exchange failed', {
        provider: this.getProviderType(),
        status: response.status,
        statusText: response.statusText,
        errorBody: errorText,
        redirectUri: redirectUri ?? this._config.redirectUri,
        hasCodeVerifier: !!codeVerifier
      });
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
      client_id: this._config.clientId,
      client_secret: this._config.clientSecret,
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
      const tokenInfo = await this.getToken(token);
      if (!tokenInfo) {
        return false;
      }

      // Check expiration with buffer
      if (tokenInfo.expiresAt - this.TOKEN_BUFFER <= Date.now()) {
        await this.removeToken(token);
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
  async getSessionCount(): Promise<number> {
    return await this.sessionStore.getSessionCount();
  }

  /**
   * Get current token count for monitoring
   */
  async getTokenCount(): Promise<number> {
    return await this.tokenStore.getTokenCount();
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

    // Handle case where req.query is undefined (common in tests)
    const query = req.query ?? {};

    return {
      clientRedirectUri: query.redirect_uri as string,
      clientCodeChallenge: query.code_challenge as string,
      clientCodeChallengeMethod: query.code_challenge_method as string,
      clientState: query.state as string,
      clientId: query.client_id as string,
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
    let codeChallenge = clientCodeChallenge ?? '';

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
   * Handle client redirect flow for MCP Inspector and Claude Code compatibility
   * Returns true if client redirect was handled, false if should continue with normal flow
   */
  protected async handleClientRedirect(
    session: OAuthSession,
    code: string,
    state: string,
    res: Response
  ): Promise<boolean> {
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

      // Use client's original state if provided, otherwise use our server state
      // This is critical for OAuth clients (Claude Code, MCP Inspector) that manage their own state
      const stateToReturn = session.clientState ?? state;
      redirectUrl.searchParams.set('state', stateToReturn);

      if (session.clientState) {
        logger.oauthDebug('Returning client original state', {
          provider: providerName,
          clientStatePrefix: session.clientState.substring(0, 8)
        });
      }

      // DON'T clean up session yet - client still needs it for token exchange!
      // Session will be cleaned up in handleTokenExchange after successful token exchange
      //
      // Session Lifecycle in OAuth Proxy Flow:
      // 1. Session created during authorization request (SESSION_TIMEOUT = 10 minutes)
      // 2. Authorization code returned to client
      // 3. Session preserved (not deleted) - client needs it for token exchange
      // 4. Client performs token exchange → cleanupAfterTokenExchange() removes session
      // 5. If client never completes token exchange, session expires after SESSION_TIMEOUT
      //
      // Note: Abandoned sessions (client never exchanges code) will be cleaned up by:
      // - Session expiration timer (10 minutes from creation)
      // - Periodic cleanup task (runs every 5 minutes via cleanup() method)
      // This prevents memory leaks and session ID exhaustion in high-traffic scenarios

      // CRITICAL: Store authorization code → { code_verifier, state } mapping for PKCE
      // This is needed when server generated PKCE (client didn't provide code_challenge)
      // but client will perform the token exchange with the code
      // Also stores state for session cleanup after successful token exchange
      if (session.codeVerifier) {
        await this.pkceStore.storeCodeVerifier(this.getProviderCodeKey(code), {
          codeVerifier: session.codeVerifier,
          state: state
        }, this.PKCE_TTL_SECONDS);
        logger.oauthDebug('Stored code_verifier and state for OAuth proxy flow', {
          provider: providerName,
          codePrefix: code.substring(0, 10),
          codeVerifierPrefix: session.codeVerifier.substring(0, 10),
          statePrefix: state.substring(0, 8),
          ttlSeconds: this.PKCE_TTL_SECONDS
        });
      }

      logger.oauthDebug('Preserving session for client token exchange', {
        provider: providerName,
        serverState: state.substring(0, 8)
      });

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

    // Handle case where req.body is undefined (common in tests)
    const body = req.body ?? {};

    // Log complete request body structure for debugging (redacted)
    const bodyKeys = Object.keys(body);
    logger.oauthDebug('Token exchange request body structure', {
      provider: providerName,
      bodyKeys,
      hasGrantType: 'grant_type' in body,
      hasCode: 'code' in body,
      hasCodeVerifier: 'code_verifier' in body,
      hasClientId: 'client_id' in body,
      hasRedirectUri: 'redirect_uri' in body,
      bodyKeyCount: bodyKeys.length
    });

    const { grant_type, code, code_verifier, client_id, redirect_uri } = body;

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

    logger.oauthDebug('Token exchange parameters', {
      provider: providerName,
      codePrefix: code?.substring(0, 10),
      hasCodeVerifier: !!code_verifier,
      codeVerifierPrefix: code_verifier?.substring(0, 8),
      hasClientId: !!client_id,
      clientIdPrefix: client_id?.substring(0, 10),
      hasRedirectUri: !!redirect_uri
    });
    logger.oauthDebug('Using redirect_uri', { provider: providerName, redirectUri: this._config.redirectUri });

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
    customScopes?: string[],
    clientState?: string
  ): OAuthSession {
    const providerName = this.getProviderName();

    if (clientRedirectUri) {
      logger.oauthDebug('Client redirect URI', { provider: providerName, clientRedirectUri });
    }

    if (clientState) {
      logger.oauthDebug('Client state parameter', { provider: providerName, clientStatePrefix: clientState.substring(0, 8) });
    }

    return {
      state,
      codeVerifier, // Empty if using client's challenge, populated if we generated it
      codeChallenge,
      redirectUri: this._config.redirectUri,
      clientRedirectUri, // Store MCP Inspector's or Claude Code's redirect URI
      clientState, // Store client's original state for validation
      scopes: customScopes ?? (this._config.scopes.length > 0 ? this._config.scopes : this.getDefaultScopes()),
      provider: this.getProviderType(),
      expiresAt: Date.now() + this.SESSION_TIMEOUT,
    };
  }

  /**
   * Handle OAuth authorization callback (common implementation)
   *
   * This implementation is shared by GitHub, Microsoft, and Generic providers.
   * Google uses its own implementation due to OAuth2Client library.
   */
  async handleAuthorizationCallback(req: Request, res: Response): Promise<void> {
    try {
      const { code, state, error } = req.query;

      // Error handling
      if (error) {
        logger.oauthError(`${this.getProviderName()} OAuth error`, { error });
        this.setAntiCachingHeaders(res);
        res.status(400).json({ error: 'Authorization failed', details: error });
        return;
      }

      // Parameter validation
      if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
        this.setAntiCachingHeaders(res);
        res.status(400).json({ error: 'Missing authorization code or state' });
        return;
      }

      // Validate session
      logger.oauthDebug('Validating state', {
        provider: this.getProviderType(),
        statePrefix: state.substring(0, 8)
      });
      const session = await this.validateState(state);

      // Handle client redirect flow
      if (await this.handleClientRedirect(session, code, state, res)) {
        return;
      }

      // Exchange code for tokens
      const tokenData = await this.exchangeCodeForTokens(
        this.getTokenUrl(),
        code,
        session.codeVerifier
      );

      if (!tokenData.access_token) {
        throw new OAuthTokenError('No access token received', this.getProviderType());
      }

      // Get user information (calls subclass implementation)
      const userInfo = await this.fetchUserInfo(tokenData.access_token);

      // Check allowlist
      const allowlistError = this.checkUserAllowlist(userInfo.email);
      if (allowlistError) {
        logger.warn('User denied by allowlist', {
          email: userInfo.email,
          provider: this.getProviderType()
        });

        // Emit OCSF logon failure event (allowlist denial)
        this.emitLogonEvent({
          status: StatusId.Failure,
          userInfo,
          errorMessage: `Access denied: ${allowlistError}`
        });

        this.setAntiCachingHeaders(res);
        res.status(403).json({
          error: 'access_denied',
          error_description: allowlistError
        });
        return;
      }

      // Store token
      const tokenInfo: StoredTokenInfo = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? undefined,
        idToken: tokenData.id_token ?? undefined,
        expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
        userInfo,
        provider: this.getProviderType(),
        scopes: session.scopes,
      };

      await this.storeToken(tokenData.access_token, tokenInfo);

      // Emit OCSF logon success event
      this.emitLogonEvent({
        status: StatusId.Success,
        userInfo
      });

      // Clean up session
      void this.removeSession(state);

      // Return response
      const response: OAuthTokenResponse = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        id_token: tokenData.id_token,
        expires_in: tokenData.expires_in ?? 3600,
        token_type: 'Bearer',
        scope: tokenData.scope,
        user: userInfo,
      };

      this.setAntiCachingHeaders(res);
      res.json(response);

    } catch (error) {
      logger.oauthError(`${this.getProviderName()} OAuth callback error`, error);

      // Emit OCSF logon failure event
      this.emitLogonEvent({
        status: StatusId.Failure,
        errorMessage: error instanceof Error ? error.message : String(error)
      });

      this.setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'Authorization failed',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle token exchange (common implementation)
   */
  async handleTokenExchange(req: Request, res: Response): Promise<void> {
    try {
      const validation = this.validateTokenExchangeRequest(req, res);
      if (!validation.isValid) {
        return;
      }

      const { code, code_verifier, redirect_uri } = validation;

      // Code must be present at this point (validated earlier)
      if (!code) {
        throw new Error('Code is required but not present');
      }

      // Resolve code_verifier
      const codeVerifierToUse = await this.resolveCodeVerifierForTokenExchange(code, code_verifier);

      // Validate code_verifier is available
      if (!codeVerifierToUse) {
        logger.oauthInfo('Token exchange: No code_verifier found - not my code, skipping to next provider', {
          provider: this.getProviderType(),
          codePrefix: code.substring(0, 10),
          hasClientCodeVerifier: !!code_verifier
        });
        // Return silently without sending response - let loop try next provider
        // If no provider responds, api/auth.ts will send generic error
        return;
      }

      logger.oauthInfo('Token exchange: Code verifier resolved - this is my code', {
        provider: this.getProviderType(),
        codePrefix: code.substring(0, 10)
      });

      // Log request
      await this.logTokenExchangeRequest(code, code_verifier, redirect_uri);

      // Exchange code for tokens
      const tokenData = await this.exchangeCodeForTokens(
        this.getTokenUrl(),
        code!,
        codeVerifierToUse,
        {},
        this._config.redirectUri
      );

      if (!tokenData.access_token) {
        throw new OAuthTokenError('No access token received', this.getProviderType());
      }

      // Get user info
      const userInfo = await this.fetchUserInfo(tokenData.access_token);

      // Store token
      const tokenInfo: StoredTokenInfo = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? undefined,
        idToken: tokenData.id_token ?? undefined,
        expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
        userInfo,
        provider: this.getProviderType(),
        scopes: tokenData.scope?.split(/[,\s]+/).filter(Boolean) ?? [],
      };

      await this.storeToken(tokenData.access_token, tokenInfo);

      // Emit OCSF logon success event
      this.emitLogonEvent({
        status: StatusId.Success,
        userInfo
      });

      // Cleanup
      await this.cleanupAfterTokenExchange(code);

      // Response
      const response: OAuthTokenResponse = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in ?? 3600,
        token_type: 'Bearer',
        scope: tokenData.scope,
        user: userInfo,
      };

      logger.oauthInfo('Token exchange successful', {
        provider: this.getProviderType(),
        userName: userInfo.name
      });
      this.setAntiCachingHeaders(res);
      res.json(response);

    } catch (error) {
      logger.oauthError('Token exchange error', error);

      // Emit OCSF logon failure event
      this.emitLogonEvent({
        status: StatusId.Failure,
        errorMessage: error instanceof Error ? error.message : String(error)
      });

      this.setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle logout (common implementation)
   */
  async handleLogout(req: Request, res: Response): Promise<void> {
    try {
      let userInfo: OAuthUserInfo | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);

        // Retrieve user info before removing token (for audit event)
        const tokenInfo = await this.getToken(token);
        if (tokenInfo) {
          userInfo = tokenInfo.userInfo;
        }

        // Optional provider-specific revocation
        try {
          await this.revokeToken(token);
        } catch (revokeError) {
          logger.oauthWarn(`Failed to revoke ${this.getProviderName()} token`, { error: revokeError });
        }

        await this.removeToken(token);
      }

      // Emit OCSF logoff success event
      this.emitLogoffEvent({
        status: StatusId.Success,
        userInfo
      });

      this.setAntiCachingHeaders(res);
      res.json({ success: true });
    } catch (error) {
      logger.oauthError(`${this.getProviderName()} logout error`, error);

      // Emit OCSF logoff failure event
      this.emitLogoffEvent({
        status: StatusId.Failure,
        errorMessage: error instanceof Error ? error.message : String(error)
      });

      this.setAntiCachingHeaders(res);
      res.status(500).json({ error: 'Logout failed' });
    }
  }

  /**
   * Verify access token (common implementation)
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      // Check local store first
      const tokenInfo = await this.getToken(token);
      if (tokenInfo) {
        return this.buildAuthInfoFromCache(token, tokenInfo);
      }

      // Fetch from provider API
      const userInfo = await this.fetchUserInfo(token);
      return this.buildAuthInfoFromUserInfo(token, userInfo);

    } catch (error) {
      logger.oauthError(`${this.getProviderName()} token verification error`, error);
      throw new OAuthTokenError('Invalid or expired token', this.getProviderType());
    }
  }

  /**
   * Get user info (common implementation)
   */
  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    try {
      // Check local store first
      const tokenInfo = await this.getToken(accessToken);
      if (tokenInfo) {
        return tokenInfo.userInfo;
      }

      // Fetch from provider API
      return await this.fetchUserInfo(accessToken);

    } catch (error) {
      logger.oauthError(`${this.getProviderName()} getUserInfo error`, error);
      throw new OAuthProviderError('Failed to get user information', this.getProviderType());
    }
  }

  /**
   * Emit OCSF logon event
   */
  protected emitLogonEvent(params: {
    status: StatusId;
    userInfo?: OAuthUserInfo;
    errorMessage?: string;
  }): void {
    const event = logonEvent()
      .status(params.status, undefined, params.errorMessage)
      .message(params.status === StatusId.Success
        ? `OAuth ${this.getProviderName()} logon successful`
        : `OAuth ${this.getProviderName()} logon failed: ${params.errorMessage ?? 'Unknown error'}`)
      .authProtocol(4); // OAuth 2.0

    // OCSF requires user info - use actual user if available, otherwise use anonymous placeholder
    if (params.userInfo) {
      event.user({
        uid: params.userInfo.sub,
        name: params.userInfo.name,
        email_addr: params.userInfo.email,
      });
    } else {
      // Provide anonymous user placeholder when actual user info is not available
      event.user({
        uid: 'anonymous',
        name: 'Anonymous',
      });
    }

    // Set severity based on status
    if (params.status === StatusId.Failure) {
      event.severity(3, 'Medium'); // Medium severity for failures
    }

    emitOCSFEvent(event.build());
  }

  /**
   * Emit OCSF logoff event
   */
  protected emitLogoffEvent(params: {
    status: StatusId;
    userInfo?: OAuthUserInfo;
    errorMessage?: string;
  }): void {
    const event = logoffEvent()
      .status(params.status, undefined, params.errorMessage)
      .message(params.status === StatusId.Success
        ? `OAuth ${this.getProviderName()} logoff successful`
        : `OAuth ${this.getProviderName()} logoff failed: ${params.errorMessage ?? 'Unknown error'}`)
      .authProtocol(4); // OAuth 2.0

    // OCSF requires user info - use actual user if available, otherwise use anonymous placeholder
    if (params.userInfo) {
      event.user({
        uid: params.userInfo.sub,
        name: params.userInfo.name,
        email_addr: params.userInfo.email,
      });
    } else {
      // Provide anonymous user placeholder when actual user info is not available
      event.user({
        uid: 'anonymous',
        name: 'Anonymous',
      });
    }

    // Set severity based on status
    if (params.status === StatusId.Failure) {
      event.severity(3, 'Medium'); // Medium severity for failures
    }

    emitOCSFEvent(event.build());
  }

  /**
   * Clean up expired sessions and tokens
   */
  async cleanup(): Promise<void> {
    // Clean up expired sessions and tokens (delegated to stores)
    await this.sessionStore.cleanup();
    await this.tokenStore.cleanup();
  }

  dispose(): void {
    clearInterval(this.cleanupTimer);
    this.sessionStore.dispose();
    this.tokenStore.dispose();
  }
}
