/**
 * OAuth provider factory for creating provider instances
 */

import {
  OAuthProvider,
  OAuthProviderFactory as IOAuthProviderFactory,
  OAuthConfig,
  OAuthProviderType,
  GoogleOAuthConfig,
  GitHubOAuthConfig,
  MicrosoftOAuthConfig,
  GenericOAuthConfig,
  OAuthProviderError
} from './providers/types.js';

import { GoogleOAuthProvider } from './providers/google-provider.js';
import { GitHubOAuthProvider } from './providers/github-provider.js';
import { MicrosoftOAuthProvider } from './providers/microsoft-provider.js';
// import { GenericOAuthProvider } from './providers/generic-provider.js';
import { EnvironmentConfig } from '../config/environment.js';
import { logger } from '../utils/logger.js';
import { createSessionStore } from './session-store-factory.js';
import { OAuthSessionStore } from './stores/session-store-interface.js';
import { createOAuthTokenStore } from './oauth-token-store-factory.js';
import { OAuthTokenStore } from './stores/oauth-token-store-interface.js';
import { createPKCEStore } from './pkce-store-factory.js';
import { PKCEStore } from './stores/pkce-store-interface.js';

/**
 * Factory for creating OAuth provider instances
 */
export class OAuthProviderFactory implements IOAuthProviderFactory {
  private static instance: OAuthProviderFactory | null = null;
  private static shutdownHookRegistered = false;
  private static exitHandler?: () => void;
  private readonly activeProviders = new Set<OAuthProvider>();
  private sessionStore: OAuthSessionStore;
  private tokenStore: OAuthTokenStore;
  private pkceStore: PKCEStore;

  constructor() {
    // Initialize stores (auto-detect Redis vs memory)
    this.sessionStore = createSessionStore();
    this.tokenStore = createOAuthTokenStore();
    this.pkceStore = createPKCEStore();
  }

  /**
   * Get singleton instance of the factory
   */
  static getInstance(): OAuthProviderFactory {
    if (!OAuthProviderFactory.instance) {
      OAuthProviderFactory.instance = new OAuthProviderFactory();
    }
    return OAuthProviderFactory.instance;
  }

  /**
   * Reset singleton instance (testing only)
   * Disposes all active providers and clears the instance
   * @internal
   */
  static resetInstance(): void {
    if (OAuthProviderFactory.instance) {
      OAuthProviderFactory.instance.disposeAll();
      OAuthProviderFactory.instance = null;
      OAuthProviderFactory.shutdownHookRegistered = false;

      // Remove exit handler
      if (OAuthProviderFactory.exitHandler) {
        process.off('exit', OAuthProviderFactory.exitHandler);
        OAuthProviderFactory.exitHandler = undefined;
      }

      logger.debug('OAuthProviderFactory instance reset');
    }
  }

  /**
   * Create an OAuth provider instance based on configuration
   */
  createProvider(config: OAuthConfig): OAuthProvider {
    switch (config.type) {
      case 'google':
        return this.registerProvider(new GoogleOAuthProvider(config as GoogleOAuthConfig, this.sessionStore, this.tokenStore, this.pkceStore));

      case 'github':
        return this.registerProvider(new GitHubOAuthProvider(config as GitHubOAuthConfig, this.sessionStore, this.tokenStore, this.pkceStore));

      case 'microsoft':
        return this.registerProvider(new MicrosoftOAuthProvider(config as MicrosoftOAuthConfig, this.sessionStore, this.tokenStore, this.pkceStore));

      case 'generic':
        // TODO: Implement Generic provider
        throw new OAuthProviderError(`Generic OAuth provider not yet implemented`, 'generic');
        // return new GenericOAuthProvider(config as GenericOAuthConfig, this.sessionStore, this.tokenStore);

      default: {
        const { type } = config as { type?: string };
        return this.throwUnsupportedProvider(type ?? 'unknown', config as never);
      }
    }
  }

  /**
   * Get list of supported provider types
   */
  getSupportedProviders(): OAuthProviderType[] {
    return [
      'google',
      'github',
      'microsoft',
      // 'generic'      // TODO: Implement
    ];
  }

  private throwUnsupportedProvider(type: string, configExhaustive: never): never {
    void configExhaustive;
    throw new OAuthProviderError(`Unsupported OAuth provider type: ${String(type)}`, type);
  }

  private registerProvider<T extends OAuthProvider>(provider: T): T {
    this.activeProviders.add(provider);
    this.ensureShutdownHook();
    return provider;
  }

  private ensureShutdownHook(): void {
    if (OAuthProviderFactory.shutdownHookRegistered) {
      return;
    }

    // Create exit handler and register it
    OAuthProviderFactory.exitHandler = () => {
      try {
        this.disposeAll();
      } catch (error) {
        logger.error('Failed to dispose OAuth providers on exit', error);
      }
    };
    process.on('exit', OAuthProviderFactory.exitHandler);

    OAuthProviderFactory.shutdownHookRegistered = true;
  }

  disposeProvider(provider: OAuthProvider): void {
    if (!this.activeProviders.delete(provider)) {
      return;
    }

    try {
      provider.dispose();
    } catch (error) {
      logger.error('Failed to dispose OAuth provider', error);
    }
  }

  disposeAll(): void {
    const errors: Error[] = [];

    for (const provider of this.activeProviders) {
      try {
        provider.dispose();
      } catch (error) {
        logger.error('Failed to dispose OAuth provider', error);
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    this.activeProviders.clear();

    if (errors.length > 0) {
      const message = errors.map(err => err.message).join('; ');
      throw new Error(`One or more OAuth providers failed to dispose: ${message}`);
    }
  }

  static disposeProvider(provider: OAuthProvider): void {
    OAuthProviderFactory.getInstance().disposeProvider(provider);
  }

  static disposeAll(): void {
    try {
      OAuthProviderFactory.getInstance().disposeAll();
    } catch (error) {
      // Surface aggregated disposal errors to callers but ensure shutdown hook references reset
      throw error;
    }
  }

  /**
   * Check if a provider type is supported
   */
  isProviderSupported(type: string): type is OAuthProviderType {
    return this.getSupportedProviders().includes(type as OAuthProviderType);
  }

  /**
   * Create provider from environment configuration (single provider mode)
   * @deprecated Use createAllFromEnvironment() for multi-provider support
   */
  static async createFromEnvironment(): Promise<OAuthProvider | null> {
    const factory = OAuthProviderFactory.getInstance();

    // Check if OAuth provider is configured
    const providerType = process.env.OAUTH_PROVIDER as OAuthProviderType;

    if (!providerType) {
      logger.oauthWarn('No OAuth provider configured. Set OAUTH_PROVIDER environment variable to enable OAuth authentication.');
      return null;
    }

    if (!factory.isProviderSupported(providerType)) {
      logger.oauthWarn('Unsupported OAuth provider', {
        provider: providerType,
        supportedProviders: factory.getSupportedProviders()
      });
      return null;
    }

    try {
      switch (providerType) {
        case 'google':
          return await factory.createGoogleProvider();

        case 'github':
          return factory.createGitHubProvider();

        case 'microsoft':
          return factory.createMicrosoftProvider();

        case 'generic':
          return factory.createGenericProvider();

        default:
          return null;
      }
    } catch (error) {
      logger.oauthError('Failed to create OAuth provider from environment', error);
      return null;
    }
  }

  /**
   * Create all configured OAuth providers from environment
   *
   * Detects which providers have credentials configured and creates instances for each.
   * This enables multi-provider support where users can choose their preferred provider.
   *
   * @returns Map of provider type to provider instance, or null if no providers configured
   */
  static async createAllFromEnvironment(): Promise<Map<OAuthProviderType, OAuthProvider> | null> {
    const factory = OAuthProviderFactory.getInstance();
    const providers = new Map<OAuthProviderType, OAuthProvider>();

    // Try to create each provider if credentials are present
    const providerAttempts: Array<{
      type: OAuthProviderType;
      create: () => Promise<OAuthProvider> | OAuthProvider;
    }> = [
      { type: 'google', create: () => factory.createGoogleProvider() },
      { type: 'github', create: () => factory.createGitHubProvider() },
      { type: 'microsoft', create: () => factory.createMicrosoftProvider() },
    ];

    for (const { type, create } of providerAttempts) {
      try {
        const provider = await create();
        providers.set(type, provider);
        logger.info('OAuth provider initialized', { provider: type });
      } catch (error) {
        // Provider not configured - skip silently (credentials missing)
        logger.debug('OAuth provider not configured', {
          provider: type,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (providers.size === 0) {
      logger.oauthWarn('No OAuth providers configured. Set credentials for at least one provider (Google, GitHub, or Microsoft).');
      return null;
    }

    logger.info('Multi-provider OAuth initialized', {
      providers: Array.from(providers.keys()),
      count: providers.size
    });

    return providers;
  }

  /**
   * Create Google OAuth provider from environment
   */
  private async createGoogleProvider(): Promise<OAuthProvider> {
    try {
      const env = EnvironmentConfig.get();
      const clientId = env.GOOGLE_CLIENT_ID;
      const clientSecret = env.GOOGLE_CLIENT_SECRET;
      const redirectUri = env.GOOGLE_REDIRECT_URI || this.getDefaultRedirectUri('google');

      if (!clientId || !clientSecret) {
        throw new OAuthProviderError(
          'Google OAuth credentials missing. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env file or environment variables.',
          'google'
        );
      }

      const config: GoogleOAuthConfig = {
        type: 'google',
        clientId,
        clientSecret,
        redirectUri: redirectUri || this.getDefaultRedirectUri('google'),
        scopes: this.getScopesFromEnv('GOOGLE_SCOPES') || ['openid', 'email', 'profile'],
      };

      return this.createProvider(config);
    } catch (error) {
      if (error instanceof OAuthProviderError) {
        throw error;
      }
      throw new OAuthProviderError(
        `Failed to load Google OAuth credentials: ${error instanceof Error ? error.message : String(error)}`,
        'google'
      );
    }
  }

  /**
   * Create GitHub OAuth provider from environment
   */
  private createGitHubProvider(): OAuthProvider {
    const env = EnvironmentConfig.get();
    const clientId = env.GITHUB_CLIENT_ID;
    const clientSecret = env.GITHUB_CLIENT_SECRET;
    const redirectUri = env.GITHUB_REDIRECT_URI;

    if (!clientId || !clientSecret) {
      throw new OAuthProviderError(
        'GitHub OAuth credentials missing. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET environment variables.',
        'github'
      );
    }

    const config: GitHubOAuthConfig = {
      type: 'github',
      clientId,
      clientSecret,
      redirectUri: redirectUri || this.getDefaultRedirectUri('github'),
      scopes: this.getScopesFromEnv('GITHUB_SCOPES') || ['read:user', 'user:email'],
    };

    return this.createProvider(config);
  }

  /**
   * Create Microsoft OAuth provider from environment
   */
  private createMicrosoftProvider(): OAuthProvider {
    const env = EnvironmentConfig.get();
    const clientId = env.MICROSOFT_CLIENT_ID;
    const clientSecret = env.MICROSOFT_CLIENT_SECRET;
    const redirectUri = env.MICROSOFT_REDIRECT_URI;
    const tenantId = env.MICROSOFT_TENANT_ID;

    if (!clientId || !clientSecret) {
      throw new OAuthProviderError(
        'Microsoft OAuth credentials missing. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET environment variables.',
        'microsoft'
      );
    }

    const config: MicrosoftOAuthConfig = {
      type: 'microsoft',
      clientId,
      clientSecret,
      redirectUri: redirectUri || this.getDefaultRedirectUri('microsoft'),
      scopes: this.getScopesFromEnv('MICROSOFT_SCOPES') || ['openid', 'profile', 'email'],
      tenantId,
    };

    return this.createProvider(config);
  }

  /**
   * Create Generic OAuth provider from environment
   */
  private createGenericProvider(): OAuthProvider {
    const env = EnvironmentConfig.get();
    const clientId = env.OAUTH_CLIENT_ID;
    const clientSecret = env.OAUTH_CLIENT_SECRET;
    const redirectUri = env.OAUTH_REDIRECT_URI;
    const authorizationUrl = env.OAUTH_AUTHORIZATION_URL;
    const tokenUrl = env.OAUTH_TOKEN_URL;
    const userInfoUrl = env.OAUTH_USER_INFO_URL;
    const revocationUrl = env.OAUTH_REVOCATION_URL;
    const providerName = env.OAUTH_PROVIDER_NAME || 'Custom OAuth Provider';

    if (!clientId || !clientSecret || !authorizationUrl || !tokenUrl || !userInfoUrl) {
      throw new OAuthProviderError(
        'Generic OAuth configuration incomplete. Required: OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_AUTHORIZATION_URL, OAUTH_TOKEN_URL, OAUTH_USER_INFO_URL',
        'generic'
      );
    }

    const config: GenericOAuthConfig = {
      type: 'generic',
      clientId,
      clientSecret,
      redirectUri: redirectUri || this.getDefaultRedirectUri('oauth'),
      scopes: this.getScopesFromEnv('OAUTH_SCOPES') || ['openid', 'profile', 'email'],
      authorizationUrl,
      tokenUrl,
      userInfoUrl,
      revocationUrl,
      providerName,
    };

    return this.createProvider(config);
  }

  /**
   * Get default redirect URI for a provider
   */
  private getDefaultRedirectUri(provider: string): string {
    const host = process.env.HTTP_HOST || 'localhost';
    const port = process.env.HTTP_PORT || '3000';
    const protocol = process.env.REQUIRE_HTTPS === 'true' ? 'https' : 'http';

    return `${protocol}://${host}:${port}/auth/${provider}/callback`;
  }

  /**
   * Parse scopes from environment variable
   */
  private getScopesFromEnv(envVar: string): string[] | null {
    const scopes = process.env[envVar];
    if (!scopes) return null;

    return scopes.split(/[,\s]+/).filter(scope => scope.length > 0);
  }
}
