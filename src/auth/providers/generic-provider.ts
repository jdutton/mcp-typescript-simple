/**
 * Generic OAuth provider implementation
 *
 * Supports any OAuth 2.0 / OpenID Connect provider
 */

import { Request, Response } from 'express';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { BaseOAuthProvider } from './base-provider.js';
import {
  GenericOAuthConfig,
  OAuthEndpoints,
  OAuthProviderType,
  OAuthUserInfo,
  OAuthTokenResponse,
  StoredTokenInfo,
  OAuthTokenError,
  OAuthProviderError
} from './types.js';
import { logger } from '../../utils/logger.js';
import { OAuthSessionStore } from '../stores/session-store-interface.js';
import { OAuthTokenStore } from '../stores/oauth-token-store-interface.js';
import { PKCEStore } from '../stores/pkce-store-interface.js';

/**
 * Generic OAuth provider implementation
 */
export class GenericOAuthProvider extends BaseOAuthProvider {
  protected config: GenericOAuthConfig;

  constructor(config: GenericOAuthConfig, sessionStore?: OAuthSessionStore, tokenStore?: OAuthTokenStore, pkceStore?: PKCEStore) {
    super(config, sessionStore, tokenStore, pkceStore);
    this.config = config;
  }

  getProviderType(): OAuthProviderType {
    return 'generic';
  }

  getProviderName(): string {
    return this.config.providerName;
  }

  getEndpoints(): OAuthEndpoints {
    return {
      authEndpoint: '/auth/oauth',
      callbackEndpoint: '/auth/oauth/callback',
      refreshEndpoint: '/auth/oauth/refresh',
      logoutEndpoint: '/auth/oauth/logout',
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
      // Extract client parameters
      const { clientRedirectUri, clientCodeChallenge, clientCodeChallengeMethod, clientState } = this.extractClientParameters(req);

      // Setup PKCE parameters
      const { state, codeVerifier, codeChallenge } = this.setupPKCE(clientCodeChallenge);

      logger.oauthInfo('Authorization request PKCE', {
        provider: 'generic',
        hasClientCodeChallenge: !!clientCodeChallenge,
        codeChallengePrefix: codeChallenge.substring(0, 10),
        hasCodeVerifier: !!codeVerifier,
        codeVerifierLength: codeVerifier?.length
      });

      // Create OAuth session
      const session = this.createOAuthSession(state, codeVerifier, codeChallenge, clientRedirectUri, undefined, clientState);
      this.storeSession(state, session);

      // Build authorization URL
      const authUrl = new URL(this.config.authorizationUrl);
      authUrl.searchParams.set('client_id', this.config.clientId);
      authUrl.searchParams.set('redirect_uri', this.config.redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', session.scopes.join(' '));
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', clientCodeChallengeMethod || 'S256');

      logger.oauthInfo(`Redirecting to ${this.config.providerName}`, { provider: 'generic' });
      this.setAntiCachingHeaders(res);
      res.redirect(authUrl.toString());
    } catch (error) {
      logger.oauthError('Generic OAuth authorization error', error);
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
        logger.oauthError('Generic OAuth error', { error });
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
      const session = await this.validateState(state);

      // Handle client redirect flow
      if (await this.handleClientRedirect(session, code, state, res)) {
        return;
      }

      // For direct server usage, exchange authorization code for tokens
      const tokenResponse = await this.exchangeCodeForToken(code, session.codeVerifier);

      if (!tokenResponse.access_token) {
        throw new OAuthTokenError('No access token received', 'generic');
      }

      // Get user information
      const userInfo = await this.fetchUserInfo(tokenResponse.access_token);

      // Check allowlist authorization
      const allowlistError = this.checkUserAllowlist(userInfo.email);
      if (allowlistError) {
        logger.warn('User denied by allowlist', { email: userInfo.email, provider: 'generic' });
        this.setAntiCachingHeaders(res);
        res.status(403).json({
          error: 'access_denied',
          error_description: allowlistError
        });
        return;
      }

      // Store token information
      const tokenInfo: StoredTokenInfo = {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        idToken: tokenResponse.id_token,
        expiresAt: Date.now() + (tokenResponse.expires_in || 3600) * 1000,
        userInfo,
        provider: 'generic',
        scopes: session.scopes,
      };

      await this.storeToken(tokenResponse.access_token, tokenInfo);

      // Clean up session
      this.removeSession(state);

      // Return token response as JSON
      const response: OAuthTokenResponse = {
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token,
        expires_in: tokenResponse.expires_in || 3600,
        token_type: 'Bearer',
        user: userInfo,
      };

      this.setAntiCachingHeaders(res);
      res.json(response);

    } catch (error) {
      logger.oauthError('Generic OAuth callback error', error);
      this.setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'Authorization failed',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Exchange authorization code for access token
   */
  private async exchangeCodeForToken(code: string, codeVerifier?: string): Promise<{
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in?: number;
  }> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    if (codeVerifier) {
      params.set('code_verifier', codeVerifier);
    }

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new OAuthTokenError(`Token exchange failed: ${response.status} ${response.statusText}`, 'generic');
    }

    return response.json();
  }

  /**
   * Fetch user information from userinfo endpoint
   */
  private async fetchUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const response = await fetch(this.config.userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new OAuthProviderError(`Failed to fetch user info: ${response.status}`, 'generic');
    }

    const userData = await response.json();

    return {
      sub: userData.sub || userData.id || 'unknown',
      email: userData.email || 'unknown@example.com',
      name: userData.name || userData.email || 'Unknown User',
      picture: userData.picture || userData.avatar_url,
      provider: 'generic',
      providerData: userData,
    };
  }

  /**
   * Handle token refresh requests
   */
  async handleTokenRefresh(req: Request, res: Response): Promise<void> {
    this.setAntiCachingHeaders(res);
    res.status(501).json({ error: 'Token refresh not implemented for generic provider' });
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
      logger.oauthError('Generic OAuth logout error', error);
      this.setAntiCachingHeaders(res);
      res.status(500).json({ error: 'Logout failed' });
    }
  }

  /**
   * Verify an access token and return auth info
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    try {
      // Check local token store first
      const tokenInfo = await this.getToken(token);
      if (tokenInfo) {
        return this.buildAuthInfoFromCache(token, tokenInfo);
      }

      // If not in local store, fetch from userinfo endpoint
      const userInfo = await this.fetchUserInfo(token);
      return this.buildAuthInfoFromUserInfo(token, userInfo);

    } catch (error) {
      logger.oauthError('Token verification failed', error);
      throw new OAuthTokenError('Invalid or expired token', 'generic');
    }
  }

  /**
   * Handle token exchange from form data (for /token endpoint)
   */
  async handleTokenExchange(req: Request, res: Response): Promise<void> {
    try {
      const validation = this.validateTokenExchangeRequest(req, res);
      if (!validation.isValid) {
        return;
      }

      const { code, code_verifier } = validation;

      // Resolve code_verifier
      const codeVerifierToUse = await this.resolveCodeVerifierForTokenExchange(code!, code_verifier);

      // Exchange code for token
      const tokenResponse = await this.exchangeCodeForToken(code!, codeVerifierToUse);

      if (!tokenResponse.access_token) {
        throw new OAuthTokenError('No access token received', 'generic');
      }

      // Get user information
      const userInfo = await this.fetchUserInfo(tokenResponse.access_token);

      // Store token information
      const tokenInfo: StoredTokenInfo = {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        idToken: tokenResponse.id_token,
        expiresAt: Date.now() + (tokenResponse.expires_in || 3600) * 1000,
        userInfo,
        provider: 'generic',
        scopes: ['openid', 'email', 'profile'],
      };

      await this.storeToken(tokenResponse.access_token, tokenInfo);

      // Clean up
      await this.cleanupAfterTokenExchange(code!);

      // Return standard OAuth 2.0 token response
      const response: OAuthTokenResponse = {
        access_token: tokenResponse.access_token,
        token_type: 'Bearer',
        expires_in: tokenResponse.expires_in || 3600,
        refresh_token: tokenResponse.refresh_token,
        scope: tokenInfo.scopes.join(' '),
        user: userInfo,
      };

      this.setAntiCachingHeaders(res);
      res.json(response);

    } catch (error) {
      logger.oauthError('Generic OAuth token exchange error', error);
      this.setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error)
      });
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

      // Fetch from userinfo endpoint
      return await this.fetchUserInfo(accessToken);

    } catch (error) {
      logger.oauthError('Generic getUserInfo error', error);
      throw new OAuthProviderError('Failed to get user information', 'generic');
    }
  }
}
