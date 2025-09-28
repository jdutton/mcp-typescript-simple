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
      // Extract MCP Inspector client parameters
      const { clientRedirectUri, clientCodeChallenge } = this.extractClientParameters(req);

      // Setup PKCE parameters (handles both client and server-generated codes)
      const { state, codeVerifier, codeChallenge } = this.setupPKCE(clientCodeChallenge);

      // Create OAuth session with client redirect support
      const session = this.createOAuthSession(state, codeVerifier, codeChallenge, clientRedirectUri);
      this.storeSession(state, session);

      // Build authorization URL
      const authUrl = this.buildAuthorizationUrl(
        this.GITHUB_AUTH_URL,
        state,
        codeChallenge,
        session.scopes
      );

      console.log(`[GitHub OAuth] Generated auth URL with state: ${state.substring(0, 8)}...`);
      console.log(`[GitHub OAuth] Redirecting to GitHub...`);
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
      console.log(`[GitHub OAuth] Validating state: ${state.substring(0, 8)}...`);
      const session = this.validateState(state);

      // Handle client redirect flow (returns true if redirect was handled)
      if (this.handleClientRedirect(session, code, state, res)) {
        return;
      }

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

      const { code, code_verifier } = validation;

      // Exchange authorization code for tokens using GitHub OAuth
      // Use our configured redirect_uri (which was used in authorization request)
      // Use the code_verifier provided by the OAuth client (PKCE RFC 7636)
      const tokenData = await this.exchangeCodeForTokens(
        this.GITHUB_TOKEN_URL,
        code!,
        code_verifier! // Use client's code_verifier for PKCE
      );

      if (!tokenData.access_token) {
        throw new OAuthTokenError('No access token received', 'github');
      }

      // Get user information
      const userInfo = await this.fetchGitHubUserInfo(tokenData.access_token);

      // Store token information (optional - for server-side tracking)
      const tokenInfo: StoredTokenInfo = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || undefined,
        expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
        userInfo,
        provider: 'github',
        scopes: tokenData.scope?.split(',') || [],
      };

      this.storeToken(tokenData.access_token, tokenInfo);

      // Return standard OAuth token response
      const response: OAuthTokenResponse = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in || 28800, // GitHub tokens now have 8 hour expiry
        token_type: 'Bearer',
        scope: tokenData.scope,
        user: userInfo,
      };

      console.log(`[GitHub OAuth] ✅ Token exchange successful for user: ${userInfo.name}`);
      res.json(response);

    } catch (error) {
      console.error('[GitHub OAuth] Token exchange error:', error);
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error)
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
      console.log('🔍 Fetching GitHub user info with token:', accessToken.substring(0, 10) + '...');

      // Get user profile
      const userResponse = await fetch(this.GITHUB_USER_URL, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'MCP-TypeScript-Server',
        },
      });

      console.log('📡 GitHub user API response status:', userResponse.status, userResponse.statusText);

      if (!userResponse.ok) {
        const errorBody = await userResponse.text();
        console.error('❌ GitHub user API error response:', errorBody);
        throw new OAuthProviderError(
          `Failed to fetch user profile: ${userResponse.status} ${userResponse.statusText} - ${errorBody}`,
          'github'
        );
      }

      const userData = await userResponse.json();
      console.log('👤 GitHub user data received:', {
        login: userData.login,
        id: userData.id,
        name: userData.name,
        email: userData.email,
        private_email: userData.email === null ? 'private' : 'public'
      });

      // Get user emails (needed for primary email)
      let primaryEmail = userData.email;
      console.log('📧 Initial email from user profile:', primaryEmail || 'null (private)');

      if (!primaryEmail) {
        console.log('🔍 Fetching user emails from /user/emails endpoint...');
        try {
          const emailResponse = await fetch(this.GITHUB_USER_EMAIL_URL, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'MCP-TypeScript-Server',
            },
          });

          console.log('📧 GitHub emails API response status:', emailResponse.status, emailResponse.statusText);

          if (emailResponse.ok) {
            const emails = await emailResponse.json();
            console.log('📧 Available emails:', emails.map((e: any) => ({ email: e.email, primary: e.primary, verified: e.verified })));

            const primary = emails.find((email: any) => email.primary && email.verified);
            const fallback = emails.find((email: any) => email.verified);
            primaryEmail = primary?.email || fallback?.email || emails[0]?.email;

            console.log('📧 Selected email:', primaryEmail);
          } else {
            const errorBody = await emailResponse.text();
            console.error('❌ GitHub emails API error:', errorBody);
          }
        } catch (emailError) {
          console.error('❌ Could not fetch GitHub user emails:', emailError);
        }
      }

      if (!primaryEmail) {
        console.error('❌ No email address found - user may have private email settings');
        throw new OAuthProviderError('No email address found for GitHub user. Please ensure your GitHub account has a public email or the user:email scope is granted.', 'github');
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
      console.error('❌ GitHub fetchUserInfo error:', error);

      // Provide more specific error information
      if (error instanceof OAuthProviderError) {
        throw error; // Re-throw our own errors
      }

      // For other errors, provide more context
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new OAuthProviderError(`Failed to fetch user information from GitHub: ${errorMessage}`, 'github');
    }
  }
}