/**
 * Microsoft Azure AD OAuth provider implementation
 */

import { Request, Response } from 'express';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { BaseOAuthProvider } from './base-provider.js';
import {
  MicrosoftOAuthConfig,
  OAuthEndpoints,
  OAuthProviderType,
  OAuthUserInfo,
  OAuthTokenResponse,
  OAuthSession,
  StoredTokenInfo,
  OAuthTokenError,
  OAuthProviderError
} from './types.js';
import { logger } from '../../utils/logger.js';
import { OAuthSessionStore } from '../stores/session-store-interface.js';
import { OAuthTokenStore } from '../stores/oauth-token-store-interface.js';
import { PKCEStore } from '../stores/pkce-store-interface.js';

/**
 * Microsoft Azure AD OAuth provider implementation
 */
export class MicrosoftOAuthProvider extends BaseOAuthProvider {
  private readonly tenantId: string;
  private readonly MICROSOFT_AUTH_URL: string;
  private readonly MICROSOFT_TOKEN_URL: string;
  private readonly MICROSOFT_USER_URL = 'https://graph.microsoft.com/v1.0/me';

  constructor(config: MicrosoftOAuthConfig, sessionStore?: OAuthSessionStore, tokenStore?: OAuthTokenStore, pkceStore?: PKCEStore) {
    super(config, sessionStore, tokenStore, pkceStore);

    this.tenantId = config.tenantId || 'common';
    this.MICROSOFT_AUTH_URL = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/authorize`;
    this.MICROSOFT_TOKEN_URL = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
  }

  getProviderType(): OAuthProviderType {
    return 'microsoft';
  }

  getProviderName(): string {
    return 'Microsoft';
  }

  getEndpoints(): OAuthEndpoints {
    return {
      authEndpoint: '/auth/microsoft',
      callbackEndpoint: '/auth/microsoft/callback',
      refreshEndpoint: '/auth/microsoft/refresh',
      logoutEndpoint: '/auth/microsoft/logout',
    };
  }

  getDefaultScopes(): string[] {
    return ['openid', 'profile', 'email'];
  }

  /**
   * Handle OAuth authorization request initiation
   */
  async handleAuthorizationRequest(req: Request, res: Response): Promise<void> {
    try {
      // Extract MCP Inspector / Claude Code client parameters
      const { clientRedirectUri, clientCodeChallenge, clientState } = this.extractClientParameters(req);

      // Setup PKCE parameters (handles both client and server-generated codes)
      const { state, codeVerifier, codeChallenge } = this.setupPKCE(clientCodeChallenge);

      // Create OAuth session with client redirect support and client state preservation
      const session = this.createOAuthSession(state, codeVerifier, codeChallenge, clientRedirectUri, undefined, clientState);
      this.storeSession(state, session);

      // Build authorization URL
      const authUrl = this.buildAuthorizationUrl(
        this.MICROSOFT_AUTH_URL,
        state,
        codeChallenge,
        session.scopes
      );

      logger.oauthDebug('Generated auth URL', { provider: 'microsoft', statePrefix: state.substring(0, 8) });
      logger.oauthInfo('Redirecting to Microsoft', { provider: 'microsoft' });
      this.setAntiCachingHeaders(res);
      res.redirect(authUrl);
    } catch (error) {
      logger.oauthError('Microsoft OAuth authorization error', error);
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
        logger.oauthError('Microsoft OAuth error', { error });
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
      logger.oauthDebug('Validating state', { provider: 'microsoft', statePrefix: state.substring(0, 8) });
      const session = await this.validateState(state);

      // Handle client redirect flow (returns true if redirect was handled)
      if (await this.handleClientRedirect(session, code, state, res)) {
        return;
      }

      // Exchange authorization code for tokens
      const tokenData = await this.exchangeCodeForTokens(
        this.MICROSOFT_TOKEN_URL,
        code,
        session.codeVerifier
      );

      if (!tokenData.access_token) {
        throw new OAuthTokenError('No access token received', 'microsoft');
      }

      // Get user information
      const userInfo = await this.fetchMicrosoftUserInfo(tokenData.access_token);

      // Check allowlist authorization
      const allowlistError = this.checkUserAllowlist(userInfo.email);
      if (allowlistError) {
        logger.warn('User denied by allowlist', { email: userInfo.email, provider: 'microsoft' });
        this.setAntiCachingHeaders(res);
        res.status(403).json({
          error: 'access_denied',
          error_description: allowlistError
        });
        return;
      }

      // Store token information
      const tokenInfo: StoredTokenInfo = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || undefined,
        idToken: tokenData.id_token || undefined,
        expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
        userInfo,
        provider: 'microsoft',
        scopes: session.scopes,
      };

      await this.storeToken(tokenData.access_token, tokenInfo);

      // Clean up session
      this.removeSession(state);

      // Return token response
      const response: OAuthTokenResponse = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        id_token: tokenData.id_token,
        expires_in: tokenData.expires_in || 3600,
        token_type: 'Bearer',
        scope: tokenData.scope,
        user: userInfo,
      };

      this.setAntiCachingHeaders(res);
      res.json(response);

    } catch (error) {
      logger.oauthError('Microsoft OAuth callback error', error);
      this.setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'Authorization failed',
        details: error instanceof Error ? error.message : String(error)
      });
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

      // Resolve code_verifier (OAuth proxy vs direct flow)
      const codeVerifierToUse = await this.resolveCodeVerifierForTokenExchange(code!, code_verifier);

      // Log token exchange request (includes client's redirect_uri for debugging)
      await this.logTokenExchangeRequest(code!, code_verifier, redirect_uri);

      // IMPORTANT: Always use server's registered redirect_uri for token exchange
      // Per OAuth 2.0 RFC 6749 Section 3.1.2: The redirect_uri MUST match the
      // registered redirect URI. Client-provided redirect_uri is logged but not used
      // for security - prevents redirect_uri substitution attacks.
      const tokenData = await this.exchangeCodeForTokens(
        this.MICROSOFT_TOKEN_URL,
        code!,
        codeVerifierToUse!, // Use correct code_verifier (server's or client's)
        {}, // No additional params
        this.config.redirectUri // MUST match authorization request redirect_uri
      );

      if (!tokenData.access_token) {
        throw new OAuthTokenError('No access token received', 'microsoft');
      }

      // Get user information from Microsoft Graph API
      const userInfo = await this.fetchMicrosoftUserInfo(tokenData.access_token);

      // Store token information (for server-side tracking)
      const tokenInfo: StoredTokenInfo = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || undefined,
        expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
        userInfo,
        provider: 'microsoft',
        scopes: tokenData.scope?.split(' ') || [],
      };

      await this.storeToken(tokenData.access_token, tokenInfo);

      // Clean up authorization code mapping and session after successful token exchange
      await this.cleanupAfterTokenExchange(code!);

      // Return standard OAuth 2.0 token response (RFC 6749 Section 5.1)
      const response: OAuthTokenResponse = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        id_token: tokenData.id_token,
        expires_in: tokenData.expires_in || 3600,
        token_type: 'Bearer',
        scope: tokenData.scope,
        user: userInfo,
      };

      logger.oauthInfo('Token exchange successful', { provider: 'microsoft', userName: userInfo.name });
      this.setAntiCachingHeaders(res);
      res.json(response);

    } catch (error) {
      logger.oauthError('Token exchange error', error);
      this.setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error)
      });
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

      // Refresh the token using Microsoft endpoint
      const refreshedToken = await this.refreshAccessToken(
        this.MICROSOFT_TOKEN_URL,
        refresh_token
      );

      if (!refreshedToken.access_token) {
        throw new OAuthTokenError('Failed to refresh access token', 'microsoft');
      }

      // Update stored token information
      const newTokenInfo: StoredTokenInfo = {
        ...tokenData.tokenInfo,
        accessToken: refreshedToken.access_token,
        refreshToken: refreshedToken.refresh_token || tokenData.tokenInfo.refreshToken,
        expiresAt: Date.now() + (refreshedToken.expires_in || 3600) * 1000,
      };

      // Remove old token and store new one
      await this.removeToken(tokenData.accessToken);
      await this.storeToken(refreshedToken.access_token, newTokenInfo);

      const response: Pick<OAuthTokenResponse, 'access_token' | 'refresh_token' | 'expires_in' | 'token_type'> = {
        access_token: refreshedToken.access_token,
        refresh_token: newTokenInfo.refreshToken,
        expires_in: refreshedToken.expires_in || 3600,
        token_type: 'Bearer',
      };

      this.setAntiCachingHeaders(res);
      res.json(response);

    } catch (error) {
      logger.oauthError('Microsoft token refresh error', error);
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
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);

        // Try to revoke the token with Microsoft
        try {
          await this.revokeMicrosoftToken(token);
        } catch (revokeError) {
          logger.oauthWarn('Failed to revoke Microsoft token', { error: revokeError });
        }

        await this.removeToken(token);
      }

      this.setAntiCachingHeaders(res);
      res.json({ success: true });
    } catch (error) {
      logger.oauthError('Microsoft logout error', error);
      this.setAntiCachingHeaders(res);
      res.status(500).json({ error: 'Logout failed' });
    }
  }

  /**
   * Verify an access token and return auth info
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      // Check our local token store first
      const tokenInfo = await this.getToken(token);
      if (tokenInfo) {
        return this.buildAuthInfoFromCache(token, tokenInfo);
      }

      // If not in local store, verify with Microsoft Graph API
      const userInfo = await this.fetchMicrosoftUserInfo(token);
      return this.buildAuthInfoFromUserInfo(token, userInfo);

    } catch (error) {
      logger.oauthError('Microsoft token verification error', error);
      throw new OAuthTokenError('Invalid or expired token', 'microsoft');
    }
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

      // Fetch from Microsoft Graph API
      return await this.fetchMicrosoftUserInfo(accessToken);

    } catch (error) {
      logger.oauthError('Microsoft getUserInfo error', error);
      throw new OAuthProviderError('Failed to get user information', 'microsoft');
    }
  }

  /**
   * Fetch user information from Microsoft Graph API
   */
  private async fetchMicrosoftUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    try {
      logger.oauthDebug('Fetching Microsoft user info', { tokenPrefix: accessToken.substring(0, 10) });

      // Get user profile from Microsoft Graph API
      const userResponse = await fetch(this.MICROSOFT_USER_URL, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'User-Agent': 'MCP-TypeScript-Server',
        },
      });

      logger.oauthDebug('Microsoft Graph API response', { status: userResponse.status, statusText: userResponse.statusText });

      if (!userResponse.ok) {
        const errorBody = await userResponse.text();
        logger.oauthError('Microsoft Graph API error response', { errorBody });
        throw new OAuthProviderError(
          `Failed to fetch user profile: ${userResponse.status} ${userResponse.statusText} - ${errorBody}`,
          'microsoft'
        );
      }

      const userData = await userResponse.json();
      logger.oauthDebug('Microsoft user data received', {
        id: userData.id,
        mail: userData.mail,
        userPrincipalName: userData.userPrincipalName,
        displayName: userData.displayName,
        emailPreference: userData.mail ? 'mail' : 'userPrincipalName'
      });

      if (!userData.id || (!userData.mail && !userData.userPrincipalName)) {
        logger.oauthError('Incomplete user data from Microsoft', { userData });
        throw new OAuthProviderError('Incomplete user data from Microsoft', 'microsoft');
      }

      const email = userData.mail || userData.userPrincipalName;
      logger.oauthDebug('Selected email', { email });

      return {
        sub: userData.id,
        email: email,
        name: userData.displayName || userData.userPrincipalName,
        provider: 'microsoft',
        providerData: userData,
      };

    } catch (error) {
      logger.oauthError('Microsoft fetchUserInfo error', error);

      // Provide more specific error information
      if (error instanceof OAuthProviderError) {
        throw error; // Re-throw our own errors
      }

      // For other errors, provide more context
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new OAuthProviderError(`Failed to fetch user information from Microsoft: ${errorMessage}`, 'microsoft');
    }
  }

  /**
   * Revoke a Microsoft access token
   */
  private async revokeMicrosoftToken(accessToken: string): Promise<void> {
    try {
      const revokeUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/logout`;

      const response = await fetch(revokeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token: accessToken,
          token_type_hint: 'access_token',
        }).toString(),
      });

      if (!response.ok) {
        throw new OAuthProviderError(
          `Failed to revoke token: ${response.status}`,
          'microsoft'
        );
      }
    } catch (error) {
      logger.oauthError('Microsoft token revocation error', error);
      throw error;
    }
  }
}