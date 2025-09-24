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

/**
 * Microsoft Azure AD OAuth provider implementation
 */
export class MicrosoftOAuthProvider extends BaseOAuthProvider {
  private readonly tenantId: string;
  private readonly MICROSOFT_AUTH_URL: string;
  private readonly MICROSOFT_TOKEN_URL: string;
  private readonly MICROSOFT_USER_URL = 'https://graph.microsoft.com/v1.0/me';

  constructor(config: MicrosoftOAuthConfig) {
    super(config);

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
      const { codeVerifier, codeChallenge } = this.generatePKCE();
      const state = this.generateState();

      // Store session data
      const session: OAuthSession = {
        state,
        codeVerifier,
        codeChallenge,
        redirectUri: this.config.redirectUri,
        scopes: this.config.scopes.length > 0 ? this.config.scopes : this.getDefaultScopes(),
        provider: 'microsoft',
        expiresAt: Date.now() + this.SESSION_TIMEOUT,
      };

      this.storeSession(state, session);

      // Build authorization URL
      const authUrl = this.buildAuthorizationUrl(
        this.MICROSOFT_AUTH_URL,
        state,
        codeChallenge,
        session.scopes
      );

      res.redirect(authUrl);
    } catch (error) {
      console.error('Microsoft OAuth authorization error:', error);
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
        console.error('Microsoft OAuth error:', error);
        res.status(400).json({ error: 'Authorization failed', details: error });
        return;
      }

      if (!code || !state || typeof code !== 'string' || typeof state !== 'string') {
        res.status(400).json({ error: 'Missing authorization code or state' });
        return;
      }

      // Validate session
      const session = this.validateState(state);

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

      this.storeToken(tokenData.access_token, tokenInfo);

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

      res.json(response);

    } catch (error) {
      console.error('Microsoft OAuth callback error:', error);
      res.status(500).json({
        error: 'Authorization failed',
        details: error instanceof Error ? error.message : String(error)
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
        res.status(400).json({ error: 'Missing refresh token' });
        return;
      }

      // Find token info by refresh token
      const tokenData = this.findTokenByRefreshToken(refresh_token);
      if (!tokenData) {
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
      this.removeToken(tokenData.accessToken);
      this.storeToken(refreshedToken.access_token, newTokenInfo);

      const response: Pick<OAuthTokenResponse, 'access_token' | 'refresh_token' | 'expires_in' | 'token_type'> = {
        access_token: refreshedToken.access_token,
        refresh_token: newTokenInfo.refreshToken,
        expires_in: refreshedToken.expires_in || 3600,
        token_type: 'Bearer',
      };

      res.json(response);

    } catch (error) {
      console.error('Microsoft token refresh error:', error);
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
          console.warn('Failed to revoke Microsoft token:', revokeError);
        }

        this.removeToken(token);
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Microsoft logout error:', error);
      res.status(500).json({ error: 'Logout failed' });
    }
  }

  /**
   * Verify an access token and return auth info
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      // Check our local token store first
      const tokenInfo = this.getToken(token);
      if (tokenInfo) {
        return {
          token,
          clientId: this.config.clientId,
          scopes: tokenInfo.scopes,
          expiresAt: Math.floor(tokenInfo.expiresAt / 1000),
          extra: {
            userInfo: tokenInfo.userInfo,
            provider: 'microsoft',
          },
        };
      }

      // If not in local store, verify with Microsoft Graph API
      const userInfo = await this.fetchMicrosoftUserInfo(token);

      return {
        token,
        clientId: this.config.clientId,
        scopes: this.getDefaultScopes(),
        extra: {
          userInfo,
          provider: 'microsoft',
        },
      };

    } catch (error) {
      console.error('Microsoft token verification error:', error);
      throw new OAuthTokenError('Invalid or expired token', 'microsoft');
    }
  }

  /**
   * Get user information from an access token
   */
  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    try {
      // Check local store first
      const tokenInfo = this.getToken(accessToken);
      if (tokenInfo) {
        return tokenInfo.userInfo;
      }

      // Fetch from Microsoft Graph API
      return await this.fetchMicrosoftUserInfo(accessToken);

    } catch (error) {
      console.error('Microsoft getUserInfo error:', error);
      throw new OAuthProviderError('Failed to get user information', 'microsoft');
    }
  }

  /**
   * Fetch user information from Microsoft Graph API
   */
  private async fetchMicrosoftUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    try {
      const userResponse = await fetch(this.MICROSOFT_USER_URL, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      });

      if (!userResponse.ok) {
        throw new OAuthProviderError(
          `Failed to fetch user profile: ${userResponse.status}`,
          'microsoft'
        );
      }

      const userData = await userResponse.json();

      if (!userData.id || !userData.mail && !userData.userPrincipalName) {
        throw new OAuthProviderError('Incomplete user data from Microsoft', 'microsoft');
      }

      return {
        sub: userData.id,
        email: userData.mail || userData.userPrincipalName,
        name: userData.displayName || userData.userPrincipalName,
        provider: 'microsoft',
        providerData: userData,
      };

    } catch (error) {
      console.error('Microsoft fetchUserInfo error:', error);
      throw new OAuthProviderError('Failed to fetch user information from Microsoft', 'microsoft');
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
      console.error('Microsoft token revocation error:', error);
      throw error;
    }
  }
}