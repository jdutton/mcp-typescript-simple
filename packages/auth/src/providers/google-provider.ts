/**
 * Google OAuth provider implementation using the new provider interface
 */

import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import type { CodeChallengeMethod } from 'google-auth-library/build/src/auth/oauth2client.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { BaseOAuthProvider } from './base-provider.js';
import {
  GoogleOAuthConfig,
  OAuthEndpoints,
  OAuthProviderType,
  OAuthUserInfo,
  OAuthTokenResponse,
  StoredTokenInfo,
  OAuthTokenError,
  OAuthProviderError
} from './types.js';
import { logger } from '../utils/logger.js';
import {
  OAuthSessionStore,
  OAuthTokenStore,
  PKCEStore
} from '@mcp-typescript-simple/persistence';

/**
 * Google OAuth provider implementation
 */
export class GoogleOAuthProvider extends BaseOAuthProvider {
  private oauth2Client: OAuth2Client;
  protected config: GoogleOAuthConfig; // Override with specific config type

  constructor(config: GoogleOAuthConfig, sessionStore?: OAuthSessionStore, tokenStore?: OAuthTokenStore, pkceStore?: PKCEStore) {
    super(config, sessionStore, tokenStore, pkceStore);
    this.config = config; // Explicitly set the properly typed config

    this.oauth2Client = new OAuth2Client(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    );
  }

  getProviderType(): OAuthProviderType {
    return 'google';
  }

  getProviderName(): string {
    return 'Google';
  }

  getEndpoints(): OAuthEndpoints {
    return {
      authEndpoint: '/auth/google',
      callbackEndpoint: '/auth/google/callback',
      refreshEndpoint: '/auth/google/refresh',
      logoutEndpoint: '/auth/google/logout',
    };
  }

  getDefaultScopes(): string[] {
    return ['openid', 'email', 'profile'];
  }

  /**
   * Handle OAuth authorization request initiation
   */
  async handleAuthorizationRequest(req: Request, res: Response): Promise<void> {
    try {
      // Extract MCP Inspector / Claude Code client parameters
      const { clientRedirectUri, clientCodeChallenge, clientCodeChallengeMethod, clientState } = this.extractClientParameters(req);

      // Setup PKCE parameters (handles both client and server-generated codes)
      const { state, codeVerifier, codeChallenge } = this.setupPKCE(clientCodeChallenge);

      logger.oauthInfo('Authorization request PKCE', {
        provider: 'google',
        hasClientCodeChallenge: !!clientCodeChallenge,
        codeChallengePrefix: codeChallenge.substring(0, 10),
        hasCodeVerifier: !!codeVerifier,
        codeVerifierLength: codeVerifier?.length
      });

      // Create OAuth session with client redirect support and client state preservation
      const session = this.createOAuthSession(state, codeVerifier, codeChallenge, clientRedirectUri, undefined, clientState);
      void this.storeSession(state, session);

      // Generate authorization URL using Google's OAuth client (different from base method)
      const authUrl = this.oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: session.scopes,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: (clientCodeChallengeMethod ?? 'S256') as CodeChallengeMethod,
        prompt: 'consent',
        redirect_uri: this.config.redirectUri, // Use our registered redirect URI
      });

      logger.oauthDebug('Generated auth URL', { provider: 'google', statePrefix: state.substring(0, 8) });
      logger.oauthInfo('Redirecting to Google', { provider: 'google' });
      this.setAntiCachingHeaders(res);
      res.redirect(authUrl);
    } catch (error) {
      logger.oauthError('Google OAuth authorization error', error);
      this.setAntiCachingHeaders(res);
      res.status(500).json({ error: 'Failed to initiate authorization' });
    }
  }

  /**
   * Handle OAuth authorization callback
   */
  async handleAuthorizationCallback(req: Request, res: Response): Promise<void> {
    try {
      const { code, state, error } = req.query;

      if (error) {
        logger.oauthError('Google OAuth error', { error });
        this.setAntiCachingHeaders(res);
        res.status(400).json({ error: 'Authorization failed', details: error });
        return;
      }

      if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
        this.setAntiCachingHeaders(res);
        res.status(400).json({ error: 'Missing authorization code or state' });
        return;
      }

      // Validate session
      logger.oauthDebug('Validating state', { provider: 'google', statePrefix: state.substring(0, 8) });
      const session = await this.validateState(state);

      // Handle client redirect flow (returns true if redirect was handled)
      if (await this.handleClientRedirect(session, code, state, res)) {
        return;
      }

      // For direct server usage (not MCP Inspector), do the token exchange ourselves
      // Exchange authorization code for tokens
      const { tokens } = await this.oauth2Client.getToken({
        code,
        codeVerifier: session.codeVerifier,
      });

      if (!tokens.access_token) {
        throw new OAuthTokenError('No access token received', 'google');
      }

      // Get user information from ID token
      const ticket = await this.oauth2Client.verifyIdToken({
        idToken: tokens.id_token ?? '',
        audience: this.config.clientId,
      });

      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) {
        throw new OAuthProviderError('Invalid ID token payload', 'google');
      }

      // Create user info
      const userInfo: OAuthUserInfo = {
        sub: payload.sub,
        email: payload.email,
        name: payload.name ?? payload.email,
        picture: payload.picture,
        provider: 'google',
        providerData: payload,
      };

      // Check allowlist authorization
      const allowlistError = this.checkUserAllowlist(userInfo.email);
      if (allowlistError) {
        logger.warn('User denied by allowlist', { email: userInfo.email, provider: 'google' });
        this.setAntiCachingHeaders(res);
        res.status(403).json({
          error: 'access_denied',
          error_description: allowlistError
        });
        return;
      }

      // Store token information
      const tokenInfo: StoredTokenInfo = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? undefined,
        idToken: tokens.id_token ?? undefined,
        expiresAt: tokens.expiry_date ?? (Date.now() + 3600 * 1000),
        userInfo,
        provider: 'google',
        scopes: session.scopes,
      };

      await this.storeToken(tokens.access_token, tokenInfo);

      // Clean up session
      void this.removeSession(state);

      // Fallback: Return token response as JSON for direct API usage
      const response: OAuthTokenResponse = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? undefined,
        expires_in: Math.floor((tokenInfo.expiresAt - Date.now()) / 1000),
        token_type: 'Bearer',
        user: userInfo,
      };

      this.setAntiCachingHeaders(res);
      res.json(response);

    } catch (error) {
      logger.oauthError('Google OAuth callback error', error);

      // Provide more user-friendly error messages
      if (error instanceof Error && error.name === 'OAuthStateError') {
        this.setAntiCachingHeaders(res);
        res.status(400).json({
          error: 'oauth_state_error',
          error_description: error.message,
          retry_suggestion: 'Please start the OAuth flow again by visiting /auth/google'
        });
      } else {
        this.setAntiCachingHeaders(res);
        res.status(500).json({
          error: 'Authorization failed',
          details: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  /**
   * Handle token refresh requests
   */
  async handleTokenRefresh(req: Request, res: Response): Promise<void> {
    try {
      const { refresh_token } = req.body;

      if (!refresh_token || typeof refresh_token !== 'string') {
        this.setAntiCachingHeaders(res);
        res.status(400).json({ error: 'Missing refresh token' });
        return;
      }

      // Find token info by refresh token
      const tokenData = await this.findTokenByRefreshToken(refresh_token);
      if (!tokenData) {
        this.setAntiCachingHeaders(res);
        res.status(401).json({ error: 'Invalid refresh token' });
        return;
      }

      // Use Google OAuth client to refresh token
      this.oauth2Client.setCredentials({
        refresh_token: refresh_token,
      });

      const { credentials } = await this.oauth2Client.refreshAccessToken();

      if (!credentials.access_token) {
        throw new OAuthTokenError('Failed to refresh access token', 'google');
      }

      // Update stored token information
      const newTokenInfo: StoredTokenInfo = {
        ...tokenData.tokenInfo,
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token ?? tokenData.tokenInfo.refreshToken,
        expiresAt: credentials.expiry_date ?? (Date.now() + 3600 * 1000),
      };

      // Remove old token and store new one
      await this.removeToken(tokenData.accessToken);
      await this.storeToken(credentials.access_token, newTokenInfo);

      const response: Pick<OAuthTokenResponse, 'access_token' | 'refresh_token' | 'expires_in' | 'token_type'> = {
        access_token: credentials.access_token,
        refresh_token: newTokenInfo.refreshToken,
        expires_in: Math.floor((newTokenInfo.expiresAt - Date.now()) / 1000),
        token_type: 'Bearer',
      };

      this.setAntiCachingHeaders(res);
      res.json(response);

    } catch (error) {
      logger.oauthError('Google token refresh error', error);
      this.setAntiCachingHeaders(res);
      res.status(401).json({
        error: 'Failed to refresh token',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle logout requests
   */
  async handleLogout(req: Request, res: Response): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        await this.removeToken(token);
      }

      this.setAntiCachingHeaders(res);
      res.json({ success: true });
    } catch (error) {
      logger.oauthError('Google logout error', error);
      this.setAntiCachingHeaders(res);
      res.status(500).json({ error: 'Logout failed' });
    }
  }

  /**
   * Verify an access token and return auth info
   */
  // eslint-disable-next-line sonarjs/cognitive-complexity -- Complex token verification logic with multiple fallback mechanisms
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      logger.oauthDebug('Verifying token', {
        provider: 'google',
        tokenPrefix: token.substring(0, 8),
        tokenSuffix: token.substring(token.length - 8)
      });

      // Check our local token store first
      logger.oauthDebug('Checking local token store first', { provider: 'google' });
      const tokenInfo = await this.getToken(token);
      if (tokenInfo) {
        logger.oauthDebug('Found token in local storage, using cached info', { provider: 'google' });
        return this.buildAuthInfoFromCache(token, tokenInfo);
      }

      // If not in local store, verify with Google
      logger.oauthDebug('Token not in local store, verifying with Google API', { provider: 'google' });

      let userInfo: { sub: string; email: string; scopes?: string[]; expiry_date?: number };

      try {
        // Try tokeninfo endpoint first
        logger.oauthDebug('Trying getTokenInfo method', { provider: 'google' });
        this.oauth2Client.setCredentials({ access_token: token });
        const tokenInfo_google = await this.oauth2Client.getTokenInfo(token);

        logger.oauthDebug('getTokenInfo successful', { provider: 'google' });
        logger.oauthDebug('Token info', {
          provider: 'google',
          sub: tokenInfo_google.sub,
          email: tokenInfo_google.email
        });

        if (!tokenInfo_google.sub || !tokenInfo_google.email) {
          throw new Error('Invalid token payload from getTokenInfo');
        }

        userInfo = {
          sub: tokenInfo_google.sub,
          email: tokenInfo_google.email,
          scopes: tokenInfo_google.scopes,
          expiry_date: tokenInfo_google.expiry_date
        };

      } catch (tokenInfoError) {
        logger.oauthDebug('getTokenInfo failed, trying userinfo endpoint as fallback', { provider: 'google' });
        logger.oauthDebug('TokenInfo error', {
          provider: 'google',
          error: tokenInfoError instanceof Error ? tokenInfoError.message : tokenInfoError
        });

        try {
          // Fallback to userinfo endpoint
          const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });

          if (!response.ok) {
            throw new Error(`Userinfo API returned ${response.status}: ${response.statusText}`);
          }

          const userData = await response.json() as {
            id?: string;
            email?: string;
          };
          logger.oauthDebug('Userinfo endpoint successful', { provider: 'google' });
          logger.oauthDebug('User data', { provider: 'google', id: userData.id, email: userData.email });

          if (!userData.id || !userData.email) {
            throw new Error('Invalid user data from userinfo endpoint');
          }

          userInfo = {
            sub: userData.id,
            email: userData.email,
            scopes: ['openid', 'email', 'profile'], // Default scopes for userinfo
          };

        } catch (userInfoError) {
          logger.oauthError('Both verification methods failed', { provider: 'google' });
          throw userInfoError;
        }
      }

      // Build OAuthUserInfo for helper methods
      const oauthUserInfo: OAuthUserInfo = {
        sub: userInfo.sub,
        email: userInfo.email,
        name: userInfo.email, // Use email as name fallback when not available
        provider: 'google',
      };

      // Use provider expiry_date if available, otherwise use default expiration
      if (userInfo.expiry_date) {
        const expiresAtSeconds = Math.floor(userInfo.expiry_date / 1000);
        logger.oauthDebug('Returning auth info for user (with provider expiry)', { provider: 'google', email: userInfo.email });
        return this.buildAuthInfoWithExpiration(token, oauthUserInfo, expiresAtSeconds, userInfo.scopes);
      } else {
        logger.oauthDebug('Returning auth info for user (with default expiry)', { provider: 'google', email: userInfo.email });
        return this.buildAuthInfoFromUserInfo(token, oauthUserInfo, userInfo.scopes);
      }

    } catch (error) {
      logger.oauthError('Token verification failed', error);
      if (error instanceof Error) {
        logger.oauthError('Error details', {
          name: error.name,
          message: error.message,
          stack: error.stack?.split('\n').slice(0, 5).join('\n')
        });
      }
      throw new OAuthTokenError('Invalid or expired token', 'google');
    }
  }

  /**
   * Handle token exchange from form data (for /token endpoint)
   * Implements OAuth 2.0 Authorization Code Grant (RFC 6749 Section 4.1.3)
   * Used by standard OAuth clients for PKCE token exchange (RFC 7636)
   */
  async handleTokenExchange(req: Request, res: Response): Promise<void> {
    try {
      // Common validation for token exchange requests
      const validation = this.validateTokenExchangeRequest(req, res);
      if (!validation.isValid) {
        return; // Response already sent by validation
      }

      const { code, code_verifier, redirect_uri } = validation;

      // Validation ensures code is non-null
      if (!code) {
        throw new OAuthProviderError('Validation error: code is required', 'google');
      }

      // Resolve code_verifier (OAuth proxy vs direct flow)
      const codeVerifierToUse = await this.resolveCodeVerifierForTokenExchange(code, code_verifier);

      // Log token exchange request (includes client's redirect_uri for debugging)
      await this.logTokenExchangeRequest(code, code_verifier, redirect_uri);

      // IMPORTANT: Always use server's registered redirect_uri for token exchange
      // Per OAuth 2.0 RFC 6749 Section 3.1.2: The redirect_uri MUST match the
      // registered redirect URI. Client-provided redirect_uri is logged but not used
      // for security - prevents redirect_uri substitution attacks.
      const redirectUriToUse = this.config.redirectUri;

      // Use the correct code_verifier (server's stored one for proxy flows, client's for direct flows)
      const result = await this.oauth2Client.getToken({
        code,
        codeVerifier: codeVerifierToUse,
        redirect_uri: redirectUriToUse,
      });

      const tokens = result.tokens;

      if (!tokens?.access_token) {
        throw new OAuthTokenError('No access token received', 'google');
      }

      // Get user information from ID token
      const ticket = await this.oauth2Client.verifyIdToken({
        idToken: tokens.id_token ?? '',
        audience: this.config.clientId,
      });

      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) {
        throw new OAuthProviderError('Invalid ID token payload', 'google');
      }

      // Create user info
      const userInfo: OAuthUserInfo = {
        sub: payload.sub,
        email: payload.email,
        name: payload.name ?? payload.email,
        picture: payload.picture,
        provider: 'google',
        providerData: payload,
      };

      // Store token information
      const tokenInfo: StoredTokenInfo = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? undefined,
        idToken: tokens.id_token ?? undefined,
        expiresAt: tokens.expiry_date ?? (Date.now() + 3600 * 1000),
        userInfo,
        provider: 'google',
        scopes: ['openid', 'email', 'profile'], // Default scopes for token exchange
      };

      await this.storeToken(tokens.access_token, tokenInfo);

      // Clean up authorization code mapping and session after successful token exchange
      await this.cleanupAfterTokenExchange(code);

      // Return standard OAuth 2.0 token response (RFC 6749 Section 5.1)
      const expiresIn = Math.floor((tokenInfo.expiresAt - Date.now()) / 1000);
      const response: OAuthTokenResponse = {
        access_token: tokens.access_token,
        token_type: 'Bearer',
        expires_in: expiresIn,
        refresh_token: tokens.refresh_token ?? undefined,
        scope: tokenInfo.scopes.join(' '), // Add scope as required by OAuth spec
        user: userInfo,
      };

      // Remove undefined fields to clean up response
      for (const key of Object.keys(response)) {
        if (response[key as keyof typeof response] === undefined) {
          delete response[key as keyof typeof response];
        }
      }

      logger.oauthInfo('Token exchange successful', { provider: 'google', userEmail: userInfo.email });
      logger.oauthDebug('Sending response to client', { provider: 'google', response: JSON.stringify(response, null, 2) });
      this.setAntiCachingHeaders(res);
      res.json(response);

    } catch (error) {
      logger.oauthError('Google OAuth token exchange error', error);
      this.setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get token URL for this provider
   */
  protected getTokenUrl(): string {
    return 'https://oauth2.googleapis.com/token';
  }

  /**
   * Fetch user information from Google's API
   */
  protected async fetchUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new OAuthProviderError(`Failed to fetch user info: ${response.status}`, 'google');
    }

    const userData = await response.json() as {
      id: string;
      email: string;
      name?: string;
      picture?: string;
    };

    return {
      sub: userData.id,
      email: userData.email,
      name: userData.name ?? userData.email,
      picture: userData.picture,
      provider: 'google',
      providerData: userData,
    };
  }

  /**
   * Get user information from an access token
   */
  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    try {
      // Check local store first
      const tokenInfo = await this.getToken(accessToken);
      if (tokenInfo) {
        return tokenInfo.userInfo;
      }

      // Fetch from Google API
      return await this.fetchUserInfo(accessToken);

    } catch (error) {
      logger.oauthError('Google getUserInfo error', error);
      throw new OAuthProviderError('Failed to get user information', 'google');
    }
  }
}
