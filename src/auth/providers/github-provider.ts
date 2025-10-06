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
import { logger } from '../../utils/logger.js';
import { OAuthSessionStore } from '../stores/session-store-interface.js';
import { OAuthTokenStore } from '../stores/oauth-token-store-interface.js';
import { PKCEStore } from '../stores/pkce-store-interface.js';

/**
 * GitHub OAuth provider implementation
 */
export class GitHubOAuthProvider extends BaseOAuthProvider {
  private readonly GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
  private readonly GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
  private readonly GITHUB_USER_URL = 'https://api.github.com/user';
  private readonly GITHUB_USER_EMAIL_URL = 'https://api.github.com/user/emails';

  constructor(config: GitHubOAuthConfig, sessionStore?: OAuthSessionStore, tokenStore?: OAuthTokenStore, pkceStore?: PKCEStore) {
    super(config, sessionStore, tokenStore, pkceStore);
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
    return ['read:user', 'user:email'];
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
        this.GITHUB_AUTH_URL,
        state,
        codeChallenge,
        session.scopes
      );

      logger.oauthDebug('Generated auth URL', { provider: 'github', statePrefix: state.substring(0, 8) });
      logger.oauthInfo('Redirecting to GitHub', { provider: 'github' });
      this.setAntiCachingHeaders(res);
      res.redirect(authUrl);
    } catch (error) {
      logger.oauthError('GitHub OAuth authorization error', error);
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
        logger.oauthError('GitHub OAuth error', { error });
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
      logger.oauthDebug('Validating state', { provider: 'github', statePrefix: state.substring(0, 8) });
      const session = await this.validateState(state);

      // Handle client redirect flow (returns true if redirect was handled)
      if (await this.handleClientRedirect(session, code, state, res)) {
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

      // Check allowlist authorization
      const allowlistError = this.checkUserAllowlist(userInfo.email);
      if (allowlistError) {
        logger.warn('User denied by allowlist', { email: userInfo.email, provider: 'github' });
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
        expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
        userInfo,
        provider: 'github',
        scopes: session.scopes,
      };

      await this.storeToken(tokenData.access_token, tokenInfo);

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

      this.setAntiCachingHeaders(res);
      res.json(response);

    } catch (error) {
      logger.oauthError('GitHub OAuth callback error', error);
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
        this.GITHUB_TOKEN_URL,
        code!,
        codeVerifierToUse!, // Use correct code_verifier (server's or client's)
        {}, // No additional params
        this.config.redirectUri // MUST match authorization request redirect_uri
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

      await this.storeToken(tokenData.access_token, tokenInfo);

      // Clean up authorization code mapping and session after successful token exchange
      await this.cleanupAfterTokenExchange(code!);

      // Return standard OAuth token response
      const response: OAuthTokenResponse = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_in: tokenData.expires_in || 28800, // GitHub tokens now have 8 hour expiry
        token_type: 'Bearer',
        scope: tokenData.scope,
        user: userInfo,
      };

      logger.oauthInfo('Token exchange successful', { provider: 'github', userName: userInfo.name });
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
   * Note: GitHub doesn't support refresh tokens in the traditional sense
   */
  async handleTokenRefresh(req: Request, res: Response): Promise<void> {
    try {
      // GitHub access tokens don't expire, so we don't need to refresh them
      // However, we can check if the token is still valid
      const { access_token } = req.body;

      if (!access_token || typeof access_token !== 'string') {
        this.setAntiCachingHeaders(res);
        res.status(400).json({ error: 'Missing access token' });
        return;
      }

      const isValid = await this.isTokenValid(access_token);
      if (!isValid) {
        this.setAntiCachingHeaders(res);
        res.status(401).json({ error: 'Token is no longer valid' });
        return;
      }

      const tokenInfo = await this.getToken(access_token);
      if (!tokenInfo) {
        this.setAntiCachingHeaders(res);
        res.status(401).json({ error: 'Token not found' });
        return;
      }

      this.setAntiCachingHeaders(res);
      res.json({
        access_token: access_token,
        expires_in: Math.floor((tokenInfo.expiresAt - Date.now()) / 1000),
        token_type: 'Bearer',
      });

    } catch (error) {
      logger.oauthError('GitHub token refresh error', error);
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
        await this.removeToken(token);
      }

      this.setAntiCachingHeaders(res);
      res.json({ success: true });
    } catch (error) {
      logger.oauthError('GitHub logout error', error);
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

      // If not in local store, verify with GitHub
      const userInfo = await this.fetchGitHubUserInfo(token);
      return this.buildAuthInfoFromUserInfo(token, userInfo);

    } catch (error) {
      logger.oauthError('GitHub token verification error', error);
      throw new OAuthTokenError('Invalid or expired token', 'github');
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

      // Fetch from GitHub API
      return await this.fetchGitHubUserInfo(accessToken);

    } catch (error) {
      logger.oauthError('GitHub getUserInfo error', error);
      throw new OAuthProviderError('Failed to get user information', 'github');
    }
  }

  /**
   * Fetch user information from GitHub API
   */
  private async fetchGitHubUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    try {
      logger.oauthDebug('Fetching GitHub user info', { tokenPrefix: accessToken.substring(0, 10) });

      // Get user profile
      const userResponse = await fetch(this.GITHUB_USER_URL, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'MCP-TypeScript-Server',
        },
      });

      logger.oauthDebug('GitHub user API response', { status: userResponse.status, statusText: userResponse.statusText });

      if (!userResponse.ok) {
        const errorBody = await userResponse.text();
        logger.oauthError('GitHub user API error response', { errorBody });
        throw new OAuthProviderError(
          `Failed to fetch user profile: ${userResponse.status} ${userResponse.statusText} - ${errorBody}`,
          'github'
        );
      }

      const userData = await userResponse.json();
      logger.oauthDebug('GitHub user data received', {
        login: userData.login,
        id: userData.id,
        name: userData.name,
        email: userData.email,
        isPrivate: userData.email === null
      });

      // Get user emails (needed for primary email)
      let primaryEmail = userData.email;
      logger.oauthDebug('Initial email from user profile', { email: primaryEmail || 'private' });

      if (!primaryEmail) {
        logger.oauthDebug('Fetching user emails from /user/emails endpoint');
        try {
          const emailResponse = await fetch(this.GITHUB_USER_EMAIL_URL, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'MCP-TypeScript-Server',
            },
          });

          logger.oauthDebug('GitHub emails API response', { status: emailResponse.status, statusText: emailResponse.statusText });

          if (emailResponse.ok) {
            const emails = await emailResponse.json();
            logger.oauthInfo('GitHub emails API response', {
              count: emails.length,
              emails: emails.map((e: any) => ({ email: e.email, primary: e.primary, verified: e.verified }))
            });

            const primary = emails.find((email: any) => email.primary && email.verified);
            const fallback = emails.find((email: any) => email.verified);
            primaryEmail = primary?.email || fallback?.email || emails[0]?.email;

            logger.oauthInfo('Selected email', { email: primaryEmail || 'none' });
          } else {
            const errorBody = await emailResponse.text();
            logger.oauthError('GitHub emails API error', {
              status: emailResponse.status,
              statusText: emailResponse.statusText,
              errorBody
            });
          }
        } catch (emailError) {
          logger.oauthError('Could not fetch GitHub user emails', emailError);
        }
      }

      // Fallback to GitHub noreply email if no email found
      if (!primaryEmail) {
        logger.oauthWarn('No email address found - using GitHub noreply email', {
          userId: userData.id,
          login: userData.login
        });
        primaryEmail = `${userData.id}+${userData.login}@users.noreply.github.com`;
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
      logger.oauthError('GitHub fetchUserInfo error', error);

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