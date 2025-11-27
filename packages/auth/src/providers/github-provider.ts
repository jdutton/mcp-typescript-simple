/**
 * GitHub OAuth provider implementation
 */

import { Request, Response } from 'express';
import { BaseOAuthProvider } from './base-provider.js';
import {
  GitHubOAuthConfig,
  OAuthEndpoints,
  OAuthProviderType,
  OAuthUserInfo,
  OAuthProviderError
} from './types.js';
import { logger } from '../utils/logger.js';
import { OAuthSessionStore, OAuthTokenStore, PKCEStore } from '@mcp-typescript-simple/persistence';

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
      void this.storeSession(state, session);

      // Build authorization URL with PKCE
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
   * Get token URL for this provider
   */
  protected getTokenUrl(): string {
    return this.GITHUB_TOKEN_URL;
  }

  /**
   * Fetch user information from GitHub API
   */
  protected async fetchUserInfo(accessToken: string): Promise<OAuthUserInfo> {
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

      const userData = await userResponse.json() as {
        id: number;
        login: string;
        name: string | null;
        email: string | null;
        avatar_url: string;
      };
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
            const emails = await emailResponse.json() as Array<{
              email: string;
              primary: boolean;
              verified: boolean;
            }>;
            logger.oauthInfo('GitHub emails API response', {
              count: emails.length,
              emails: emails.map((e) => ({ email: e.email, primary: e.primary, verified: e.verified }))
            });

            const primary = emails.find((email) => email.primary && email.verified);
            const fallback = emails.find((email) => email.verified);
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