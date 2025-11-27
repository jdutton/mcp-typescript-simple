/**
 * Generic OAuth provider implementation
 *
 * Supports any OAuth 2.0 / OpenID Connect provider
 */

import { Request, Response } from 'express';
import { BaseOAuthProvider } from './base-provider.js';
import {
  GenericOAuthConfig,
  OAuthEndpoints,
  OAuthProviderType,
  OAuthUserInfo,
  OAuthTokenError,
  OAuthProviderError
} from './types.js';
import { logger } from '../utils/logger.js';
import { OAuthSessionStore, OAuthTokenStore, PKCEStore } from '@mcp-typescript-simple/persistence';

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
      void this.storeSession(state, session);

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

    const tokenData = await response.json() as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
      expires_in?: number;
    };

    return tokenData;
  }

  /**
   * Get token URL for this provider
   */
  protected getTokenUrl(): string {
    return this.config.tokenUrl;
  }

  /**
   * Fetch user information from userinfo endpoint
   */
  protected async fetchUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const response = await fetch(this.config.userInfoUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new OAuthProviderError(`Failed to fetch user info: ${response.status}`, 'generic');
    }

    const userData = await response.json() as Record<string, unknown>;

    return {
      sub: (userData.sub as string) || (userData.id as string) || 'unknown',
      email: (userData.email as string) || 'unknown@example.com',
      name: (userData.name as string) || (userData.email as string) || 'Unknown User',
      picture: (userData.picture as string) || (userData.avatar_url as string),
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
}
