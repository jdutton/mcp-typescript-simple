/**
 * Mock OAuth provider for testing HTTP server authentication flows
 * Consolidates mock implementations to provide a single source of truth
 */

import type { Request, Response } from 'express';
import type {
  OAuthConfig,
  OAuthProviderType,
  OAuthUserInfo,
  SessionAuthCache,
  AuthInfo,
  OAuthSessionStore
} from '@mcp-typescript-simple/auth';
import { BaseOAuthProvider } from '@mcp-typescript-simple/auth';
import { PKCEStore, MemoryPKCEStore } from '@mcp-typescript-simple/persistence';

export class MockOAuthProvider extends BaseOAuthProvider {
  public mockFetchUserInfo: ((_token: string) => Promise<OAuthUserInfo>) | null = null;

  constructor(
    config: OAuthConfig,
    private readonly _providerType: OAuthProviderType,
    pkceStore?: PKCEStore,
    sessionStore?: OAuthSessionStore
  ) {
    super(config, sessionStore, pkceStore || new MemoryPKCEStore());
  }

  getProviderType(): OAuthProviderType {
    return this._providerType;
  }

  getProviderName(): string {
    return this._providerType;
  }

  getEndpoints() {
    return {
      authEndpoint: `/auth/${this._providerType}`,
      callbackEndpoint: `/auth/${this._providerType}/callback`,
      refreshEndpoint: `/auth/${this._providerType}/refresh`,
      logoutEndpoint: `/auth/${this._providerType}/logout`
    };
  }

  getDefaultScopes(): string[] {
    return ['openid', 'profile', 'email'];
  }

  async handleAuthorizationRequest(_req: Request, _res: Response): Promise<void> {}
  async handleAuthorizationCallback(_req: Request, _res: Response): Promise<void> {}
  async handleTokenRefresh(_req: Request, _res: Response): Promise<void> {}
  async handleLogout(_req: Request, _res: Response): Promise<void> {}

  async verifyAccessToken(token: string) {
    return {
      token,
      clientId: this._config.clientId,
      scopes: ['openid', 'profile', 'email'],
      expiresAt: Math.floor((Date.now() + 3600000) / 1000),
      extra: {
        userInfo: await this.getUserInfo(token),
        provider: this._providerType
      }
    };
  }

  async getUserInfo(token: string): Promise<OAuthUserInfo> {
    if (this.mockFetchUserInfo) {
      return this.mockFetchUserInfo(token);
    }
    return {
      sub: 'user-123',
      name: 'Test User',
      email: 'test@example.com',
      email_verified: true,
      provider: this._providerType
    };
  }

  protected async fetchUserInfo(token: string): Promise<OAuthUserInfo> {
    return this.getUserInfo(token);
  }

  // Mock implementation for legacy O(N) authentication testing
  async hasToken(token: string): Promise<boolean> {
    // ADR 006: No server-side token storage, but for testing backward compatibility
    // we simulate that the provider "has" known tokens
    return token === 'test-access-token';
  }

  // Expose protected methods for testing session-based authentication (ADR 006)
  public testHashToken(token: string): string {
    return this.hashToken(token);
  }

  public async testCanUseCachedAuthentication(authCache: SessionAuthCache): Promise<boolean> {
    return this.canUseCachedAuthentication(authCache);
  }

  public testBuildAuthInfoFromSessionCache(token: string, authCache: SessionAuthCache): AuthInfo {
    return this.buildAuthInfoFromSessionCache(token, authCache);
  }

  public async testRevalidateAndUpdateBinding(
    token: string,
    tokenHash: string,
    sessionId: string,
    authCache: SessionAuthCache
  ): Promise<AuthInfo> {
    return this.revalidateAndUpdateBinding(token, tokenHash, sessionId, authCache);
  }

  public async testRevalidateAndUpdateCache(
    token: string,
    sessionId: string,
    authCache: SessionAuthCache
  ): Promise<AuthInfo> {
    return this.revalidateAndUpdateCache(token, sessionId, authCache);
  }

  public async testUpdateSessionAuthCache(sessionId: string, authCache: SessionAuthCache): Promise<void> {
    return this.updateSessionAuthCache(sessionId, authCache);
  }
}
