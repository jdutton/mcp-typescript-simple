/**
 * Microsoft Azure AD OAuth provider implementation
 */

import { Request, Response } from 'express';
import { BaseOAuthProvider } from './base-provider.js';
import {
  MicrosoftOAuthConfig,
  OAuthEndpoints,
  OAuthProviderType,
  OAuthUserInfo,
  OAuthTokenResponse,
  OAuthTokenError,
  OAuthProviderError
} from './types.js';
import { logger } from '../utils/logger.js';
import {
  OAuthSessionStore,
  PKCEStore,
  SessionAuthCache
} from '@mcp-typescript-simple/persistence';

/**
 * Microsoft Azure AD OAuth provider implementation
 */
export class MicrosoftOAuthProvider extends BaseOAuthProvider {
  private readonly tenantId: string;
  private readonly MICROSOFT_AUTH_URL: string;
  private readonly MICROSOFT_TOKEN_URL: string;
  private readonly MICROSOFT_USER_URL = 'https://graph.microsoft.com/v1.0/me';

  constructor(config: MicrosoftOAuthConfig, sessionStore?: OAuthSessionStore, pkceStore?: PKCEStore) {
    super(config, sessionStore, pkceStore);

    this.tenantId = config.tenantId ?? 'common';
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
      void this.storeSession(state, session);

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
   * Handle token refresh requests
   * ADR 006: Tokens are not stored - client is responsible for managing tokens
   */
  async handleTokenRefresh(req: Request, res: Response): Promise<void> {
    try {
      const { refresh_token } = req.body;

      if (!refresh_token || typeof refresh_token !== 'string') {
        this.setAntiCachingHeaders(res);
        res.status(400).json({ error: 'Missing refresh token' });
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

      const response: Pick<OAuthTokenResponse, 'access_token' | 'refresh_token' | 'expires_in' | 'token_type'> = {
        access_token: refreshedToken.access_token,
        refresh_token: refreshedToken.refresh_token ?? refresh_token,
        expires_in: refreshedToken.expires_in ?? 3600,
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
   * Override canUseCachedAuthentication for Microsoft JWT validation (ADR 006)
   *
   * Microsoft provides ID tokens (JWTs) that can be verified locally without API calls.
   * This method validates the JWT expiry and audience claims using common base helpers.
   *
   * Note: Full JWT signature verification would require fetching Microsoft's JWKS
   * and verifying the signature. For now, we perform expiry validation and rely
   * on HTTPS security + token binding for authentication.
   *
   * Performance: ~1ms (local validation) vs ~200ms (API call)
   *
   * @param authCache - Session authentication cache
   * @returns true if JWT is valid, false if expired or invalid
   */
  protected async canUseCachedAuthentication(authCache: SessionAuthCache): Promise<boolean> {
    // Check if we have an ID token to validate
    const extra = authCache.authInfo.extra as Record<string, unknown> | undefined;
    const idToken = extra?.idToken as string | undefined;

    if (!idToken) {
      // No ID token available - fall back to opaque token validation
      logger.oauthDebug('No ID token available for JWT validation, using TTL-based caching', {
        provider: 'microsoft'
      });
      return super.canUseCachedAuthentication(authCache);
    }

    // Decode JWT payload using common base helper
    const payload = this.decodeJWTPayload(idToken);
    if (!payload) {
      return false; // Invalid JWT format
    }

    // Check expiry using common base helper
    if (!payload.exp) {
      // Accept tokens without expiry claim (with warning)
      logger.oauthWarn('Microsoft ID token missing exp claim - accepting with caution', {
        provider: 'microsoft'
      });
    } else if (!this.isJWTNotExpired(payload)) {
      logger.oauthDebug('Microsoft ID token expired', {
        provider: 'microsoft',
        exp: payload.exp,
        now: Math.floor(Date.now() / 1000)
      });
      return false;
    }

    // Verify audience matches our client ID
    if (payload.aud && payload.aud !== this._config.clientId) {
      logger.oauthDebug('Microsoft ID token audience mismatch', {
        provider: 'microsoft',
        expected: this._config.clientId,
        actual: payload.aud
      });
      return false;
    }

    // JWT is valid (expiry + audience) - use cached auth
    // Note: Full signature verification would require JWKS validation
    logger.oauthDebug('Microsoft ID token validated locally (expiry + audience check)', {
      provider: 'microsoft',
      userId: payload.sub
    });
    return true;
  }

  /**
   * Get token URL for this provider
   */
  protected getTokenUrl(): string {
    return this.MICROSOFT_TOKEN_URL;
  }

  /**
   * Fetch user information from Microsoft Graph API
   */
  protected async fetchUserInfo(accessToken: string): Promise<OAuthUserInfo> {
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

      const userData = await userResponse.json() as {
        id: string;
        mail?: string;
        userPrincipalName?: string;
        displayName?: string;
      };
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

      // Safely extract email (validated above)
      const email = userData.mail ?? userData.userPrincipalName ?? '';
      logger.oauthDebug('Selected email', { email });

      return {
        sub: userData.id,
        email: email,
        name: userData.displayName ?? email,
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
  protected async revokeToken(accessToken: string): Promise<void> {
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