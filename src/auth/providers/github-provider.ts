/**
 * GitHub OAuth provider implementation
 */

import { Request, Response } from 'express';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { BaseOAuthProvider } from './base-provider.js';
import {
  GitHubOAuthConfig,
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
 * GitHub OAuth provider implementation
 */
export class GitHubOAuthProvider extends BaseOAuthProvider {
  private readonly GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
  private readonly GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
  private readonly GITHUB_USER_URL = 'https://api.github.com/user';
  private readonly GITHUB_USER_EMAIL_URL = 'https://api.github.com/user/emails';

  constructor(config: GitHubOAuthConfig) {
    super(config);
  }

  getProviderType(): OAuthProviderType {
    return 'github';
  }

  getProviderName(): string {
    return 'GitHub';
  }

  getEndpoints(): OAuthEndpoints {
    return {
      authEndpoint: '/auth/github',
      callbackEndpoint: '/auth/github/callback',
      refreshEndpoint: '/auth/github/refresh',
      logoutEndpoint: '/auth/github/logout',
    };
  }

  getDefaultScopes(): string[] {
    return ['user:email'];
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
        provider: 'github',
        expiresAt: Date.now() + this.SESSION_TIMEOUT,
      };

      this.storeSession(state, session);

      // Build authorization URL
      const authUrl = this.buildAuthorizationUrl(
        this.GITHUB_AUTH_URL,
        state,
        codeChallenge,
        session.scopes
      );

      res.redirect(authUrl);
    } catch (error) {
      console.error('GitHub OAuth authorization error:', error);
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
        console.error('GitHub OAuth error:', error);
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
        this.GITHUB_TOKEN_URL,
        code,
        session.codeVerifier
      );

      if (!tokenData.access_token) {
        throw new OAuthTokenError('No access token received', 'github');
      }

      // Get user information
      const userInfo = await this.fetchGitHubUserInfo(tokenData.access_token);

      // Store token information
      const tokenInfo: StoredTokenInfo = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || undefined,
        expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
        userInfo,
        provider: 'github',
        scopes: session.scopes,
      };

      this.storeToken(tokenData.access_token, tokenInfo);

      // Clean up session
      this.removeSession(state);

      // Return token response
      const response: OAuthTokenResponse = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in || 3600,
        token_type: 'Bearer',
        scope: tokenData.scope,
        user: userInfo,
      };

      res.json(response);

    } catch (error) {
      console.error('GitHub OAuth callback error:', error);
      res.status(500).json({
        error: 'Authorization failed',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle token refresh requests
   * Note: GitHub doesn't support refresh tokens in the traditional sense
   */
  async handleTokenRefresh(req: Request, res: Response): Promise<void> {
    try {
      // GitHub access tokens don't expire, so we don't need to refresh them
      // However, we can check if the token is still valid
      const { access_token } = req.body;

      if (!access_token || typeof access_token !== 'string') {
        res.status(400).json({ error: 'Missing access token' });
        return;
      }

      const isValid = await this.isTokenValid(access_token);
      if (!isValid) {
        res.status(401).json({ error: 'Token is no longer valid' });
        return;
      }

      const tokenInfo = this.getToken(access_token);
      if (!tokenInfo) {
        res.status(401).json({ error: 'Token not found' });
        return;
      }

      res.json({
        access_token: access_token,
        expires_in: Math.floor((tokenInfo.expiresAt - Date.now()) / 1000),
        token_type: 'Bearer',
      });

    } catch (error) {
      console.error('GitHub token refresh error:', error);
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
      console.error('GitHub logout error:', error);
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
            provider: 'github',
          },
        };
      }

      // If not in local store, verify with GitHub
      const userInfo = await this.fetchGitHubUserInfo(token);

      return {
        token,
        clientId: this.config.clientId,
        scopes: this.getDefaultScopes(),
        extra: {
          userInfo,
          provider: 'github',
        },
      };

    } catch (error) {
      console.error('GitHub token verification error:', error);
      throw new OAuthTokenError('Invalid or expired token', 'github');
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

      // Fetch from GitHub API
      return await this.fetchGitHubUserInfo(accessToken);

    } catch (error) {
      console.error('GitHub getUserInfo error:', error);
      throw new OAuthProviderError('Failed to get user information', 'github');
    }
  }

  /**
   * Fetch user information from GitHub API
   */
  private async fetchGitHubUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    try {
      // Get user profile
      const userResponse = await fetch(this.GITHUB_USER_URL, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'MCP-TypeScript-Server',
        },
      });

      if (!userResponse.ok) {
        throw new OAuthProviderError(
          `Failed to fetch user profile: ${userResponse.status}`,
          'github'
        );
      }

      const userData = await userResponse.json();

      // Get user emails (needed for primary email)
      let primaryEmail = userData.email;
      if (!primaryEmail) {
        try {
          const emailResponse = await fetch(this.GITHUB_USER_EMAIL_URL, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'MCP-TypeScript-Server',
            },
          });

          if (emailResponse.ok) {
            const emails = await emailResponse.json();
            const primary = emails.find((email: any) => email.primary);
            primaryEmail = primary?.email || emails[0]?.email;
          }
        } catch (emailError) {
          console.warn('Could not fetch GitHub user emails:', emailError);
        }
      }

      if (!primaryEmail) {
        throw new OAuthProviderError('No email address found for GitHub user', 'github');
      }

      return {
        sub: userData.id.toString(),
        email: primaryEmail,
        name: userData.name || userData.login,
        picture: userData.avatar_url,
        provider: 'github',
        providerData: userData,
      };

    } catch (error) {
      console.error('GitHub fetchUserInfo error:', error);
      throw new OAuthProviderError('Failed to fetch user information from GitHub', 'github');
    }
  }
}