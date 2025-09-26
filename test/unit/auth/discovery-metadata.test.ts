import { jest } from '@jest/globals';
import {
  OAuthDiscoveryMetadata,
  createOAuthDiscoveryMetadata,
  type AuthorizationServerMetadata,
  type ProtectedResourceMetadata,
  type MCPProtectedResourceMetadata,
  type OpenIDConnectConfiguration
} from '../../../src/auth/discovery-metadata.js';
import type { OAuthProvider, OAuthEndpoints, OAuthProviderType } from '../../../src/auth/providers/types.js';

describe('OAuthDiscoveryMetadata', () => {
  let mockProvider: jest.Mocked<OAuthProvider>;
  const baseUrl = 'https://example.com';

  beforeEach(() => {
    mockProvider = {
      getProviderType: jest.fn(),
      getProviderName: jest.fn(),
      getEndpoints: jest.fn(),
      getDefaultScopes: jest.fn(),
      handleAuthorizationRequest: jest.fn(),
      handleAuthorizationCallback: jest.fn(),
      handleTokenRefresh: jest.fn(),
      handleLogout: jest.fn(),
      verifyAccessToken: jest.fn(),
      getUserInfo: jest.fn(),
      isTokenValid: jest.fn(),
      getSessionCount: jest.fn(),
      getTokenCount: jest.fn(),
      cleanup: jest.fn(),
      dispose: jest.fn()
    } as jest.Mocked<OAuthProvider>;

    // Default mock implementations
    mockProvider.getEndpoints.mockReturnValue({
      authEndpoint: '/auth/google',
      callbackEndpoint: '/auth/google/callback',
      refreshEndpoint: '/auth/google/refresh',
      logoutEndpoint: '/auth/google/logout'
    });
    mockProvider.getProviderType.mockReturnValue('google');
  });

  describe('Constructor and Factory', () => {
    it('creates instance through constructor', () => {
      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);
      expect(generator).toBeInstanceOf(OAuthDiscoveryMetadata);
    });

    it('creates instance through factory function', () => {
      const generator = createOAuthDiscoveryMetadata(mockProvider, baseUrl);
      expect(generator).toBeInstanceOf(OAuthDiscoveryMetadata);
    });

    it('accepts optional configuration options', () => {
      const options = {
        enableResumability: true,
        sessionTimeoutSeconds: 3600,
        toolDiscoveryEndpoint: '/custom/discovery'
      };

      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl, options);
      expect(generator).toBeInstanceOf(OAuthDiscoveryMetadata);
    });
  });

  describe('Authorization Server Metadata Generation', () => {
    it('generates basic authorization server metadata for Google', () => {
      mockProvider.getProviderType.mockReturnValue('google');
      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);

      const metadata = generator.generateAuthorizationServerMetadata();

      expect(metadata).toMatchObject({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/token`,
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256']
      });
    });

    it('includes Google-specific metadata', () => {
      mockProvider.getProviderType.mockReturnValue('google');
      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);

      const metadata = generator.generateAuthorizationServerMetadata();

      expect(metadata.scopes_supported).toEqual([
        'openid', 'profile', 'email',
        'https://www.googleapis.com/auth/userinfo.profile'
      ]);
      expect(metadata.service_documentation).toBe('https://developers.google.com/identity/protocols/oauth2');
      expect(metadata.userinfo_endpoint).toBe('https://www.googleapis.com/oauth2/v2/userinfo');
    });

    it('includes GitHub-specific metadata', () => {
      mockProvider.getProviderType.mockReturnValue('github');
      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);

      const metadata = generator.generateAuthorizationServerMetadata();

      expect(metadata.scopes_supported).toEqual(['user:email', 'read:user', 'user:profile']);
      expect(metadata.service_documentation).toBe('https://docs.github.com/en/developers/apps/building-oauth-apps');
      expect(metadata.userinfo_endpoint).toBe('https://api.github.com/user');
    });

    it('includes Microsoft-specific metadata', () => {
      mockProvider.getProviderType.mockReturnValue('microsoft');
      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);

      const metadata = generator.generateAuthorizationServerMetadata();

      expect(metadata.scopes_supported).toEqual(['openid', 'profile', 'email', 'User.Read']);
      expect(metadata.service_documentation).toBe('https://docs.microsoft.com/en-us/azure/active-directory/develop/');
      expect(metadata.userinfo_endpoint).toBe('https://graph.microsoft.com/v1.0/me');
    });

    it('handles generic provider type', () => {
      mockProvider.getProviderType.mockReturnValue('generic');
      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);

      const metadata = generator.generateAuthorizationServerMetadata();

      expect(metadata.scopes_supported).toEqual(['openid', 'profile', 'email']);
      expect(metadata.service_documentation).toBeUndefined();
      expect(metadata.userinfo_endpoint).toBeUndefined();
    });

    it('includes logout endpoint when available', () => {
      mockProvider.getEndpoints.mockReturnValue({
        authEndpoint: '/auth/test',
        callbackEndpoint: '/auth/test/callback',
        refreshEndpoint: '/auth/test/refresh',
        logoutEndpoint: '/auth/test/logout'
      });

      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);
      const metadata = generator.generateAuthorizationServerMetadata();

      expect(metadata.revocation_endpoint).toBe(`${baseUrl}/auth/test/logout`);
    });

    it('omits logout endpoint when not available', () => {
      mockProvider.getEndpoints.mockReturnValue({
        authEndpoint: '/auth/test',
        callbackEndpoint: '/auth/test/callback',
        refreshEndpoint: '/auth/test/refresh',
        logoutEndpoint: '' // Empty string to simulate not available
      });

      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);
      const metadata = generator.generateAuthorizationServerMetadata();

      expect(metadata.revocation_endpoint).toBeUndefined();
    });

    it('handles unknown provider type with default values', () => {
      mockProvider.getProviderType.mockReturnValue('unknown' as any);
      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);

      const metadata = generator.generateAuthorizationServerMetadata();

      expect(metadata.scopes_supported).toEqual(['openid', 'profile', 'email']);
      expect(metadata.service_documentation).toBeUndefined();
    });
  });

  describe('Protected Resource Metadata Generation', () => {
    it('generates basic protected resource metadata', () => {
      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);
      const metadata = generator.generateProtectedResourceMetadata();

      expect(metadata).toEqual({
        resource: baseUrl,
        authorization_servers: [baseUrl],
        resource_documentation: `${baseUrl}/docs`,
        bearer_methods_supported: ['header', 'body'],
        authorization_data_types_supported: [
          'application/json',
          'application/x-www-form-urlencoded'
        ]
      });
    });
  });

  describe('MCP Protected Resource Metadata Generation', () => {
    it('generates MCP-specific metadata with defaults', () => {
      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);
      const metadata = generator.generateMCPProtectedResourceMetadata();

      expect(metadata).toMatchObject({
        resource: baseUrl,
        authorization_servers: [baseUrl],
        resource_documentation: `${baseUrl}/docs`,
        bearer_methods_supported: ['header', 'body'],
        authorization_data_types_supported: [
          'application/json',
          'application/x-www-form-urlencoded'
        ],
        mcp_version: '1.18.0',
        transport_capabilities: ['stdio', 'streamable_http'],
        tool_discovery_endpoint: `${baseUrl}/mcp`,
        supported_tool_types: ['function', 'text_generation', 'analysis'],
        scopes_supported: ['mcp:read', 'mcp:write'],
        session_management: {
          resumability_supported: false,
          session_timeout_seconds: undefined
        }
      });
    });

    it('includes custom options when provided', () => {
      const options = {
        enableResumability: true,
        sessionTimeoutSeconds: 7200,
        toolDiscoveryEndpoint: '/custom/tools'
      };

      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl, options);
      const metadata = generator.generateMCPProtectedResourceMetadata();

      expect(metadata.tool_discovery_endpoint).toBe('/custom/tools');
      expect(metadata.session_management).toEqual({
        resumability_supported: true,
        session_timeout_seconds: 7200
      });
    });
  });

  describe('OpenID Connect Configuration Generation', () => {
    it('generates basic OpenID Connect configuration', () => {
      mockProvider.getProviderType.mockReturnValue('google');
      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);

      const config = generator.generateOpenIDConnectConfiguration();

      expect(config).toMatchObject({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/token`,
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        ui_locales_supported: ['en-US']
      });
    });

    it('includes Google-specific OpenID Connect metadata', () => {
      mockProvider.getProviderType.mockReturnValue('google');
      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);

      const config = generator.generateOpenIDConnectConfiguration();

      expect(config.jwks_uri).toBe('https://www.googleapis.com/oauth2/v3/certs');
      expect(config.end_session_endpoint).toBe('https://accounts.google.com/logout');
      expect(config.claims_supported).toEqual([
        'sub', 'name', 'email', 'email_verified',
        'picture', 'locale', 'iat', 'exp',
        'given_name', 'family_name', 'hd'
      ]);
    });

    it('includes Microsoft-specific OpenID Connect metadata', () => {
      mockProvider.getProviderType.mockReturnValue('microsoft');
      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);

      const config = generator.generateOpenIDConnectConfiguration();

      expect(config.jwks_uri).toBe('https://login.microsoftonline.com/common/discovery/v2.0/keys');
      expect(config.end_session_endpoint).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/logout');
      expect(config.claims_supported).toEqual([
        'sub', 'name', 'email', 'email_verified',
        'picture', 'locale', 'iat', 'exp',
        'given_name', 'family_name', 'preferred_username'
      ]);
    });

    it('includes GitHub-specific OpenID Connect metadata', () => {
      mockProvider.getProviderType.mockReturnValue('github');
      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);

      const config = generator.generateOpenIDConnectConfiguration();

      expect(config.frontchannel_logout_supported).toBe(false);
      expect(config.backchannel_logout_supported).toBe(false);
      expect(config.claims_supported).toEqual([
        'sub', 'name', 'email', 'email_verified',
        'picture', 'locale', 'iat', 'exp',
        'login', 'avatar_url', 'company', 'location'
      ]);
    });

    it('handles generic provider with default claims', () => {
      mockProvider.getProviderType.mockReturnValue('generic');
      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);

      const config = generator.generateOpenIDConnectConfiguration();

      expect(config.claims_supported).toEqual([
        'sub', 'name', 'email', 'email_verified',
        'picture', 'locale', 'iat', 'exp'
      ]);
      expect(config.jwks_uri).toBeUndefined();
      expect(config.end_session_endpoint).toBeUndefined();
    });
  });

  describe('Complete Metadata Generation', () => {
    it('generates all metadata types', () => {
      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);
      const allMetadata = generator.generateAllMetadata();

      expect(allMetadata).toHaveProperty('authorizationServer');
      expect(allMetadata).toHaveProperty('protectedResource');
      expect(allMetadata).toHaveProperty('mcpProtectedResource');
      expect(allMetadata).toHaveProperty('openidConfiguration');

      expect(allMetadata.authorizationServer).toHaveProperty('issuer', baseUrl);
      expect(allMetadata.protectedResource).toHaveProperty('resource', baseUrl);
      expect(allMetadata.mcpProtectedResource).toHaveProperty('mcp_version', '1.18.0');
      expect(allMetadata.openidConfiguration).toHaveProperty('issuer', baseUrl);
    });

    it('maintains consistency across all metadata types', () => {
      const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);
      const allMetadata = generator.generateAllMetadata();

      // All should use the same base URL
      expect(allMetadata.authorizationServer.issuer).toBe(baseUrl);
      expect(allMetadata.protectedResource.resource).toBe(baseUrl);
      expect(allMetadata.mcpProtectedResource.resource).toBe(baseUrl);
      expect(allMetadata.openidConfiguration.issuer).toBe(baseUrl);

      // Authorization endpoints should match
      expect(allMetadata.authorizationServer.authorization_endpoint).toBe(
        allMetadata.openidConfiguration.authorization_endpoint
      );
    });
  });

  describe('Private Method Coverage through Public Interface', () => {
    it('exercises all provider types through public methods', () => {
      const providerTypes: OAuthProviderType[] = ['google', 'github', 'microsoft', 'generic'];

      providerTypes.forEach(providerType => {
        mockProvider.getProviderType.mockReturnValue(providerType);
        const generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);

        // Call methods that exercise private getSupportedScopes
        const authMetadata = generator.generateAuthorizationServerMetadata();
        expect(authMetadata.scopes_supported).toBeDefined();
        expect(Array.isArray(authMetadata.scopes_supported)).toBe(true);

        // Call methods that exercise private getSupportedClaims
        const oidcConfig = generator.generateOpenIDConnectConfiguration();
        expect(oidcConfig.claims_supported).toBeDefined();
        expect(Array.isArray(oidcConfig.claims_supported)).toBe(true);

        // Call methods that exercise private addProviderSpecificMetadata
        if (providerType !== 'generic') {
          expect(authMetadata.service_documentation).toBeDefined();
          expect(authMetadata.userinfo_endpoint).toBeDefined();
        }
      });
    });

    it('exercises different endpoint configurations', () => {
      const endpointsWithLogout: OAuthEndpoints = {
        authEndpoint: '/auth/test',
        callbackEndpoint: '/auth/test/callback',
        refreshEndpoint: '/auth/test/refresh',
        logoutEndpoint: '/auth/test/logout'
      };

      const endpointsWithoutLogout: OAuthEndpoints = {
        authEndpoint: '/auth/test',
        callbackEndpoint: '/auth/test/callback',
        refreshEndpoint: '/auth/test/refresh',
        logoutEndpoint: '' // Empty to simulate unavailable
      };

      // Test with logout endpoint
      mockProvider.getEndpoints.mockReturnValue(endpointsWithLogout);
      let generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);
      let metadata = generator.generateAuthorizationServerMetadata();
      expect(metadata.revocation_endpoint).toBeDefined();

      // Test without logout endpoint
      mockProvider.getEndpoints.mockReturnValue(endpointsWithoutLogout);
      generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);
      metadata = generator.generateAuthorizationServerMetadata();
      expect(metadata.revocation_endpoint).toBeUndefined();
    });

    it('covers all session management configurations', () => {
      // Test default configuration
      let generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl);
      let mcpMetadata = generator.generateMCPProtectedResourceMetadata();
      expect(mcpMetadata.session_management?.resumability_supported).toBe(false);
      expect(mcpMetadata.session_management?.session_timeout_seconds).toBeUndefined();

      // Test with resumability enabled
      const options1 = { enableResumability: true };
      generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl, options1);
      mcpMetadata = generator.generateMCPProtectedResourceMetadata();
      expect(mcpMetadata.session_management?.resumability_supported).toBe(true);

      // Test with session timeout
      const options2 = { sessionTimeoutSeconds: 1800 };
      generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl, options2);
      mcpMetadata = generator.generateMCPProtectedResourceMetadata();
      expect(mcpMetadata.session_management?.session_timeout_seconds).toBe(1800);

      // Test with custom tool discovery endpoint
      const options3 = { toolDiscoveryEndpoint: '/api/tools' };
      generator = new OAuthDiscoveryMetadata(mockProvider, baseUrl, options3);
      mcpMetadata = generator.generateMCPProtectedResourceMetadata();
      expect(mcpMetadata.tool_discovery_endpoint).toBe('/api/tools');
    });
  });
});