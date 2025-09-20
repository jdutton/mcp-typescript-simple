/**
 * Google OAuth provider implementation using the new provider interface
 */

import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { BaseOAuthProvider } from './base-provider.js';
import {
  GoogleOAuthConfig,
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
 * Google OAuth provider implementation
 */
export class GoogleOAuthProvider extends BaseOAuthProvider {
  private oauth2Client: OAuth2Client;

  constructor(config: GoogleOAuthConfig) {
    super(config);

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
      const { codeVerifier, codeChallenge } = this.generatePKCE();
      const state = this.generateState();

      // Store session data
      const session: OAuthSession = {
        state,
        codeVerifier,
        codeChallenge,
        redirectUri: this.config.redirectUri,
        scopes: this.config.scopes.length > 0 ? this.config.scopes : this.getDefaultScopes(),
        provider: 'google',
        expiresAt: Date.now() + this.SESSION_TIMEOUT,
      };

      this.storeSession(state, session);

      // Generate authorization URL
      const authUrl = this.oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: session.scopes,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256' as any,
        prompt: 'consent',
      });

      res.redirect(authUrl);
    } catch (error) {
      console.error('Google OAuth authorization error:', error);
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
        console.error('Google OAuth error:', error);
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
      const { tokens } = await this.oauth2Client.getToken({
        code,
        codeVerifier: session.codeVerifier,
      });

      if (!tokens.access_token) {
        throw new OAuthTokenError('No access token received', 'google');
      }

      // Get user information from ID token
      const ticket = await this.oauth2Client.verifyIdToken({
        idToken: tokens.id_token || '',
        audience: this.config.clientId,
      });

      const payload = ticket.getPayload();
      if (!payload || !payload.sub || !payload.email) {
        throw new OAuthProviderError('Invalid ID token payload', 'google');
      }

      // Create user info
      const userInfo: OAuthUserInfo = {
        sub: payload.sub,
        email: payload.email,
        name: payload.name || payload.email,
        picture: payload.picture,
        provider: 'google',
        providerData: payload,
      };

      // Store token information
      const tokenInfo: StoredTokenInfo = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        idToken: tokens.id_token || undefined,
        expiresAt: tokens.expiry_date || (Date.now() + 3600 * 1000),
        userInfo,
        provider: 'google',
        scopes: session.scopes,
      };

      this.storeToken(tokens.access_token, tokenInfo);

      // Clean up session
      this.removeSession(state);

      // Return token response
      const response: OAuthTokenResponse = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || undefined,
        expires_in: Math.floor((tokenInfo.expiresAt - Date.now()) / 1000),
        token_type: 'Bearer',
        user: userInfo,
      };

      res.json(response);

    } catch (error) {
      console.error('Google OAuth callback error:', error);
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
        refreshToken: credentials.refresh_token || tokenData.tokenInfo.refreshToken,
        expiresAt: credentials.expiry_date || (Date.now() + 3600 * 1000),
      };

      // Remove old token and store new one
      this.removeToken(tokenData.accessToken);
      this.storeToken(credentials.access_token, newTokenInfo);

      const response: Pick<OAuthTokenResponse, 'access_token' | 'refresh_token' | 'expires_in' | 'token_type'> = {
        access_token: credentials.access_token,
        refresh_token: newTokenInfo.refreshToken,
        expires_in: Math.floor((newTokenInfo.expiresAt - Date.now()) / 1000),
        token_type: 'Bearer',
      };

      res.json(response);

    } catch (error) {
      console.error('Google token refresh error:', error);
      res.status(401).json({
        error: 'Failed to refresh token',
        details: error instanceof Error ? error.message : String(error)
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
        this.removeToken(token);
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Google logout error:', error);
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
            provider: 'google',
          },
        };
      }

      // If not in local store, verify with Google
      this.oauth2Client.setCredentials({ access_token: token });
      const tokenInfo_google = await this.oauth2Client.getTokenInfo(token);

      if (!tokenInfo_google.sub || !tokenInfo_google.email) {
        throw new OAuthTokenError('Invalid token payload', 'google');
      }

      return {
        token,
        clientId: this.config.clientId,
        scopes: tokenInfo_google.scopes || [],
        expiresAt: tokenInfo_google.expiry_date ? Math.floor(tokenInfo_google.expiry_date / 1000) : undefined,
        extra: {
          userInfo: {
            sub: tokenInfo_google.sub,
            email: tokenInfo_google.email,
            provider: 'google',
          },
        },
      };

    } catch (error) {
      console.error('Google token verification error:', error);
      throw new OAuthTokenError('Invalid or expired token', 'google');
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

      // Fetch from Google API
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new OAuthProviderError(`Failed to fetch user info: ${response.status}`, 'google');
      }

      const userData = await response.json();

      return {
        sub: userData.id,
        email: userData.email,
        name: userData.name || userData.email,
        picture: userData.picture,
        provider: 'google',
        providerData: userData,
      };

    } catch (error) {
      console.error('Google getUserInfo error:', error);
      throw new OAuthProviderError('Failed to get user information', 'google');
    }
  }
}