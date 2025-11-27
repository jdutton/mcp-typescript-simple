/**
 * OAuth 2.0 Discovery Metadata Generator
 *
 * Generates RFC-compliant metadata for OAuth discovery endpoints:
 * - RFC 8414: OAuth 2.0 Authorization Server Metadata
 * - RFC 9728: OAuth 2.0 Protected Resource Metadata
 * - OpenID Connect Discovery 1.0
 * - MCP-specific protected resource metadata
 */

import { OAuthProvider, OAuthProviderType } from './providers/types.js';

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  token_endpoint_auth_methods_supported: string[];
  token_endpoint_auth_signing_alg_values_supported?: string[];
  userinfo_endpoint?: string;
  revocation_endpoint?: string;
  registration_endpoint?: string; // RFC 7591 Dynamic Client Registration
  scopes_supported: string[];
  response_types_supported: string[];
  response_modes_supported?: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported?: string[];
  subject_types_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
  claims_supported?: string[];
  service_documentation?: string;
  ui_locales_supported?: string[];
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  resource_documentation?: string;
  resource_policy_uri?: string;
  resource_tos_uri?: string;
  bearer_methods_supported?: string[];
  resource_signing_alg_values_supported?: string[];
  authorization_data_types_supported?: string[];
}

export interface MCPProtectedResourceMetadata extends ProtectedResourceMetadata {
  mcp_version: string;
  transport_capabilities: string[];
  tool_discovery_endpoint?: string;
  supported_tool_types?: string[];
  scopes_supported?: string[];
  session_management?: {
    resumability_supported: boolean;
    session_timeout_seconds?: number;
  };
}

export interface OpenIDConnectConfiguration extends AuthorizationServerMetadata {
  jwks_uri?: string;
  registration_endpoint?: string;
  end_session_endpoint?: string;
  frontchannel_logout_supported?: boolean;
  frontchannel_logout_session_supported?: boolean;
  backchannel_logout_supported?: boolean;
  backchannel_logout_session_supported?: boolean;
}

/**
 * OAuth Discovery Metadata Generator
 */
export class OAuthDiscoveryMetadata {
  constructor(
    private readonly _provider: OAuthProvider,
    private readonly _baseUrl: string,
    private readonly _options: {
      enableResumability?: boolean;
      sessionTimeoutSeconds?: number;
      toolDiscoveryEndpoint?: string;
    } = {},
  ) {}

  /**
   * Generate OAuth 2.0 Authorization Server Metadata (RFC 8414)
   */
  generateAuthorizationServerMetadata(): AuthorizationServerMetadata {
    const endpoints = this._provider.getEndpoints();
    const providerType = this._provider.getProviderType();

    const metadata: AuthorizationServerMetadata = {
      issuer: this._baseUrl,
      authorization_endpoint: `${this._baseUrl}/auth/authorize`, // Generic authorize endpoint redirects to provider selection
      token_endpoint: `${this._baseUrl}/auth/token`, // Universal token endpoint (handles all providers)
      registration_endpoint: `${this._baseUrl}/register`, // RFC 7591 Dynamic Client Registration
      token_endpoint_auth_methods_supported: [
        'client_secret_post',
        'client_secret_basic'
      ],
      scopes_supported: this.getSupportedScopes(providerType),
      response_types_supported: ['code'],
      grant_types_supported: [
        'authorization_code',
        'refresh_token'
      ],
      code_challenge_methods_supported: ['S256'], // Advertise PKCE support (required by MCP Inspector)
    };

    // Add provider-specific metadata
    this.addProviderSpecificMetadata(metadata, providerType);

    // Add optional endpoints if available
    if (endpoints.logoutEndpoint) {
      metadata.revocation_endpoint = `${this._baseUrl}${endpoints.logoutEndpoint}`;
    }

    return metadata;
  }

  /**
   * Generate OAuth 2.0 Protected Resource Metadata (RFC 9728)
   */
  generateProtectedResourceMetadata(): ProtectedResourceMetadata {
    return {
      resource: this._baseUrl,
      authorization_servers: [this._baseUrl],
      resource_documentation: `${this._baseUrl}/docs`,
      bearer_methods_supported: ['header', 'body'],
      authorization_data_types_supported: [
        'application/json',
        'application/x-www-form-urlencoded'
      ]
    };
  }

  /**
   * Generate MCP-specific Protected Resource Metadata
   */
  generateMCPProtectedResourceMetadata(): MCPProtectedResourceMetadata {
    const baseMetadata = this.generateProtectedResourceMetadata();

    return {
      ...baseMetadata,
      mcp_version: '1.18.0',
      transport_capabilities: [
        'stdio',
        'streamable_http'
      ],
      tool_discovery_endpoint: this._options.toolDiscoveryEndpoint ?? `${this._baseUrl}/mcp`,
      supported_tool_types: [
        'function',
        'text_generation',
        'analysis'
      ],
      scopes_supported: ['mcp:read', 'mcp:write'],
      session_management: {
        resumability_supported: this._options.enableResumability ?? false,
        session_timeout_seconds: this._options.sessionTimeoutSeconds
      }
    };
  }

  /**
   * Generate OpenID Connect Discovery Configuration
   */
  generateOpenIDConnectConfiguration(): OpenIDConnectConfiguration {
    const authServerMetadata = this.generateAuthorizationServerMetadata();
    const providerType = this._provider.getProviderType();

    const config: OpenIDConnectConfiguration = {
      ...authServerMetadata,
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      claims_supported: this.getSupportedClaims(providerType),
      ui_locales_supported: ['en-US']
    };

    // Add provider-specific OpenID Connect metadata
    this.addOpenIDConnectMetadata(config, providerType);

    return config;
  }

  /**
   * Get supported scopes for a provider
   */
  private getSupportedScopes(providerType: OAuthProviderType): string[] {
    const commonScopes = ['openid', 'profile', 'email'];

    switch (providerType) {
      case 'google':
        return [...commonScopes, 'https://www.googleapis.com/auth/userinfo.profile'];

      case 'github':
        return ['user:email', 'read:user', 'user:profile'];

      case 'microsoft':
        return [...commonScopes, 'User.Read'];

      case 'generic':
        return commonScopes;

      default:
        return commonScopes;
    }
  }

  /**
   * Get supported claims for OpenID Connect
   */
  private getSupportedClaims(providerType: OAuthProviderType): string[] {
    const commonClaims = [
      'sub', 'name', 'email', 'email_verified',
      'picture', 'locale', 'iat', 'exp'
    ];

    switch (providerType) {
      case 'google':
        return [...commonClaims, 'given_name', 'family_name', 'hd'];

      case 'github':
        return [...commonClaims, 'login', 'avatar_url', 'company', 'location'];

      case 'microsoft':
        return [...commonClaims, 'given_name', 'family_name', 'preferred_username'];

      default:
        return commonClaims;
    }
  }

  /**
   * Add provider-specific metadata to authorization server metadata
   */
  private addProviderSpecificMetadata(
    metadata: AuthorizationServerMetadata,
    providerType: OAuthProviderType
  ): void {
    switch (providerType) {
      case 'google':
        metadata.service_documentation = 'https://developers.google.com/identity/protocols/oauth2';
        metadata.userinfo_endpoint = 'https://www.googleapis.com/oauth2/v2/userinfo';
        break;

      case 'github':
        metadata.service_documentation = 'https://docs.github.com/en/developers/apps/building-oauth-apps';
        metadata.userinfo_endpoint = 'https://api.github.com/user';
        break;

      case 'microsoft':
        metadata.service_documentation = 'https://docs.microsoft.com/en-us/azure/active-directory/develop/';
        metadata.userinfo_endpoint = 'https://graph.microsoft.com/v1.0/me';
        break;
    }
  }

  /**
   * Add provider-specific OpenID Connect metadata
   */
  private addOpenIDConnectMetadata(
    config: OpenIDConnectConfiguration,
    providerType: OAuthProviderType
  ): void {
    switch (providerType) {
      case 'google':
        config.jwks_uri = 'https://www.googleapis.com/oauth2/v3/certs';
        config.end_session_endpoint = 'https://accounts.google.com/logout';
        break;

      case 'microsoft':
        config.jwks_uri = 'https://login.microsoftonline.com/common/discovery/v2.0/keys';
        config.end_session_endpoint = 'https://login.microsoftonline.com/common/oauth2/v2.0/logout';
        break;

      case 'github':
        // GitHub doesn't provide JWKS or end session endpoints in the same way
        config.frontchannel_logout_supported = false;
        config.backchannel_logout_supported = false;
        break;
    }
  }

  /**
   * Generate all discovery metadata
   */
  generateAllMetadata(): {
    authorizationServer: AuthorizationServerMetadata;
    protectedResource: ProtectedResourceMetadata;
    mcpProtectedResource: MCPProtectedResourceMetadata;
    openidConfiguration: OpenIDConnectConfiguration;
  } {
    return {
      authorizationServer: this.generateAuthorizationServerMetadata(),
      protectedResource: this.generateProtectedResourceMetadata(),
      mcpProtectedResource: this.generateMCPProtectedResourceMetadata(),
      openidConfiguration: this.generateOpenIDConnectConfiguration()
    };
  }
}

/**
 * Factory function to create discovery metadata generator
 */
export function createOAuthDiscoveryMetadata(
  provider: OAuthProvider,
  baseUrl: string,
  options?: {
    enableResumability?: boolean;
    sessionTimeoutSeconds?: number;
    toolDiscoveryEndpoint?: string;
  }
): OAuthDiscoveryMetadata {
  return new OAuthDiscoveryMetadata(provider, baseUrl, options);
}