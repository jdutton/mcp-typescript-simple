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

/**
 * Factory for creating OAuth provider instances
 */
export class OAuthProviderFactory implements IOAuthProviderFactory {
  private static instance: OAuthProviderFactory | null = null;

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
   * Create an OAuth provider instance based on configuration
   */
  createProvider(config: OAuthConfig): OAuthProvider {
    switch (config.type) {
      case 'google':
        return new GoogleOAuthProvider(config as GoogleOAuthConfig);

      case 'github':
        return new GitHubOAuthProvider(config as GitHubOAuthConfig);

      case 'microsoft':
        return new MicrosoftOAuthProvider(config as MicrosoftOAuthConfig);

      case 'generic':
        // TODO: Implement Generic provider
        throw new OAuthProviderError(`Generic OAuth provider not yet implemented`, 'generic');
        // return new GenericOAuthProvider(config as GenericOAuthConfig);

      default: {
        const unknownConfig = config as { type?: string };
        throw new OAuthProviderError(
          `Unsupported OAuth provider type: ${unknownConfig.type ?? 'unknown'}`
        );
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

  /**
   * Check if a provider type is supported
   */
  isProviderSupported(type: string): type is OAuthProviderType {
    return this.getSupportedProviders().includes(type as OAuthProviderType);
  }

  /**
   * Create provider from environment configuration
   */
  static createFromEnvironment(): OAuthProvider | null {
    const factory = OAuthProviderFactory.getInstance();

    // Try to detect which provider is configured
    const providerType = process.env.OAUTH_PROVIDER as OAuthProviderType || 'google';

    if (!factory.isProviderSupported(providerType)) {
      console.warn(`Unsupported OAuth provider: ${providerType}`);
      return null;
    }

    try {
      switch (providerType) {
        case 'google':
          return factory.createGoogleProvider();

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
      console.error('Failed to create OAuth provider from environment:', error);
      return null;
    }
  }

  /**
   * Create Google OAuth provider from environment
   */
  private createGoogleProvider(): OAuthProvider {
    const clientId = process.env.GOOGLE_CLIENT_ID || process.env.OAUTH_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.OAUTH_GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || process.env.OAUTH_GOOGLE_REDIRECT_URI;

    if (!clientId || !clientSecret) {
      throw new OAuthProviderError(
        'Google OAuth credentials missing. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.',
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
  }

  /**
   * Create GitHub OAuth provider from environment
   */
  private createGitHubProvider(): OAuthProvider {
    const clientId = process.env.GITHUB_CLIENT_ID || process.env.OAUTH_GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET || process.env.OAUTH_GITHUB_CLIENT_SECRET;
    const redirectUri = process.env.GITHUB_REDIRECT_URI || process.env.OAUTH_GITHUB_REDIRECT_URI;

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
      scopes: this.getScopesFromEnv('GITHUB_SCOPES') || ['user:email'],
    };

    return this.createProvider(config);
  }

  /**
   * Create Microsoft OAuth provider from environment
   */
  private createMicrosoftProvider(): OAuthProvider {
    const clientId = process.env.MICROSOFT_CLIENT_ID || process.env.OAUTH_MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || process.env.OAUTH_MICROSOFT_CLIENT_SECRET;
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI || process.env.OAUTH_MICROSOFT_REDIRECT_URI;
    const tenantId = process.env.MICROSOFT_TENANT_ID || process.env.OAUTH_MICROSOFT_TENANT_ID;

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
    const clientId = process.env.OAUTH_CLIENT_ID;
    const clientSecret = process.env.OAUTH_CLIENT_SECRET;
    const redirectUri = process.env.OAUTH_REDIRECT_URI;
    const authorizationUrl = process.env.OAUTH_AUTHORIZATION_URL;
    const tokenUrl = process.env.OAUTH_TOKEN_URL;
    const userInfoUrl = process.env.OAUTH_USER_INFO_URL;
    const revocationUrl = process.env.OAUTH_REVOCATION_URL;
    const providerName = process.env.OAUTH_PROVIDER_NAME || 'Custom OAuth Provider';

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
