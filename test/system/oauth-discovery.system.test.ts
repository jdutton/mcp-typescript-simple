/**
 * System tests for OAuth Discovery functionality
 *
 * Tests the complete OAuth discovery flow including:
 * - Discovery endpoint availability
 * - Metadata format compliance
 * - Cross-platform consistency (local vs Vercel)
 */

import { AxiosInstance } from 'axios';
import {
  createHttpClient,
  waitForServer,
  getCurrentEnvironment,
  describeSystemTest,
  isLocalEnvironment,
  expectsCorsHeaders,
  isSTDIOEnvironment
} from './utils.js';

describeSystemTest('OAuth Discovery', () => {
  const environment = getCurrentEnvironment();

  // Skip HTTP tests entirely in STDIO mode
  if (isSTDIOEnvironment(environment)) {
    it('should skip HTTP tests in STDIO mode', () => {
      console.log('ℹ️  HTTP tests skipped for environment: STDIO transport mode (npm run dev:stdio)');
    });
    return;
  }

  let client: AxiosInstance;

  beforeAll(async () => {
    client = createHttpClient();

    if (isLocalEnvironment(environment)) {
      // For other local environments, wait for external server to be ready
      const isReady = await waitForServer(client);
      if (!isReady) {
        throw new Error(`Server not ready at ${environment.baseUrl}`);
      }
    }
  });

  afterAll(async () => {
    // Server cleanup handled at suite level
  });

  describe('Discovery Endpoint Availability', () => {
    const discoveryEndpoints = [
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/openid-configuration',
    ];

    it.each(discoveryEndpoints)('should respond to %s', async (endpoint) => {
      const response = await client.get(endpoint);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should return 404 for unknown discovery endpoints', async () => {
      const response = await client.get('/.well-known/non-existent');
      expect(response.status).toBe(404);
    });

    it('should not allow non-GET methods on discovery endpoints', async () => {
      const response = await client.post('/.well-known/oauth-authorization-server');
      expect([405, 404]).toContain(response.status); // Either method not allowed or not found
    });
  });

  describe('Authorization Server Metadata Compliance', () => {
    it('should return RFC 8414 compliant authorization server metadata', async () => {
      const response = await client.get('/.well-known/oauth-authorization-server');
      expect(response.status).toBe(200);

      const metadata = response.data;

      // Required fields per RFC 8414
      expect(metadata).toHaveProperty('issuer');
      expect(metadata.issuer).toMatch(/^https?:\/\//);

      // Either OAuth is configured or we get an error response
      if (metadata.error) {
        expect(metadata.error).toBe('OAuth not configured');
        expect(metadata.message).toContain('OAuth provider not available');
      } else {
        // OAuth is configured - check required fields
        expect(metadata).toHaveProperty('authorization_endpoint');
        expect(metadata).toHaveProperty('token_endpoint');
        expect(metadata).toHaveProperty('response_types_supported');
        expect(metadata).toHaveProperty('grant_types_supported');

        expect(metadata.authorization_endpoint).toMatch(/^https?:\/\//);
        expect(metadata.token_endpoint).toMatch(/^https?:\/\//);
        expect(metadata.response_types_supported).toContain('code');
        expect(metadata.grant_types_supported).toContain('authorization_code');
      }
    });

    it('should include proper token endpoint authentication methods', async () => {
      const response = await client.get('/.well-known/oauth-authorization-server');
      const metadata = response.data;

      if (!metadata.error) {
        expect(metadata.token_endpoint_auth_methods_supported).toContain('client_secret_post');
        expect(metadata.token_endpoint_auth_methods_supported).toContain('client_secret_basic');
      }
    });

    it('should include PKCE support', async () => {
      const response = await client.get('/.well-known/oauth-authorization-server');
      const metadata = response.data;

      if (!metadata.error) {
        expect(metadata.code_challenge_methods_supported).toContain('S256');
      }
    });
  });

  describe('Protected Resource Metadata Compliance', () => {
    it('should return RFC 9728 compliant protected resource metadata', async () => {
      const response = await client.get('/.well-known/oauth-protected-resource');
      expect(response.status).toBe(200);

      const metadata = response.data;

      // Required fields per RFC 9728
      expect(metadata).toHaveProperty('resource');
      expect(metadata.resource).toMatch(/^https?:\/\//);
      expect(metadata).toHaveProperty('authorization_servers');
      expect(Array.isArray(metadata.authorization_servers)).toBe(true);

      // Either OAuth is configured or we get minimal metadata
      if (!metadata.message) {
        // OAuth is configured
        expect(metadata.authorization_servers).toContain(metadata.resource);
        expect(metadata.bearer_methods_supported).toContain('header');
      } else {
        // OAuth not configured
        expect(metadata.message).toBe('OAuth provider not configured');
        expect(metadata.authorization_servers).toEqual([]);
      }
    });

    it('should include proper resource documentation', async () => {
      const response = await client.get('/.well-known/oauth-protected-resource');
      const metadata = response.data;

      expect(metadata.resource_documentation).toMatch(/\/docs$/);
    });
  });

  describe('MCP Protected Resource Metadata', () => {
    it('should return MCP-specific metadata with required fields', async () => {
      const response = await client.get('/.well-known/oauth-protected-resource/mcp');
      expect(response.status).toBe(200);

      const metadata = response.data;

      // MCP-specific required fields
      expect(metadata).toHaveProperty('mcp_version');
      expect(metadata.mcp_version).toBe('1.18.0');

      expect(metadata).toHaveProperty('transport_capabilities');
      expect(metadata.transport_capabilities).toContain('streamable_http');

      expect(metadata).toHaveProperty('tool_discovery_endpoint');
      expect(metadata.tool_discovery_endpoint).toMatch(/\/mcp$/);

      expect(metadata).toHaveProperty('supported_tool_types');
      expect(metadata.supported_tool_types).toContain('function');

      expect(metadata).toHaveProperty('session_management');
      expect(metadata.session_management).toHaveProperty('resumability_supported');
    });

    it('should include both STDIO and HTTP transport capabilities for local server', async () => {
      const response = await client.get('/.well-known/oauth-protected-resource/mcp');
      const metadata = response.data;

      // Local server should support both transports
      if (!metadata.message) {
        expect(metadata.transport_capabilities).toContain('stdio');
        expect(metadata.transport_capabilities).toContain('streamable_http');
      }
    });

    it('should provide appropriate tool types', async () => {
      const response = await client.get('/.well-known/oauth-protected-resource/mcp');
      const metadata = response.data;

      const expectedToolTypes = ['function', 'text_generation', 'analysis'];
      expectedToolTypes.forEach(toolType => {
        expect(metadata.supported_tool_types).toContain(toolType);
      });
    });
  });

  describe('OpenID Connect Discovery', () => {
    it('should return OpenID Connect Discovery compliant metadata', async () => {
      const response = await client.get('/.well-known/openid-configuration');
      expect(response.status).toBe(200);

      const metadata = response.data;

      // Required fields per OpenID Connect Discovery 1.0
      expect(metadata).toHaveProperty('issuer');
      expect(metadata).toHaveProperty('authorization_endpoint');
      expect(metadata).toHaveProperty('token_endpoint');
      expect(metadata).toHaveProperty('response_types_supported');
      expect(metadata).toHaveProperty('subject_types_supported');
      expect(metadata).toHaveProperty('id_token_signing_alg_values_supported');

      if (!metadata.message) {
        // OAuth is configured
        expect(metadata.subject_types_supported).toContain('public');
        expect(metadata.id_token_signing_alg_values_supported).toContain('RS256');
        expect(metadata.response_types_supported).toContain('code');
      }
    });

    it('should include proper claims support', async () => {
      const response = await client.get('/.well-known/openid-configuration');
      const metadata = response.data;

      if (!metadata.message && metadata.claims_supported) {
        const expectedClaims = ['sub', 'name', 'email'];
        expectedClaims.forEach(claim => {
          expect(metadata.claims_supported).toContain(claim);
        });
      }
    });
  });

  describe('Cross-endpoint Consistency', () => {
    it('should use consistent issuer across all discovery endpoints', async () => {
      const endpoints = [
        '/.well-known/oauth-authorization-server',
        '/.well-known/openid-configuration',
      ];

      const responses = await Promise.all(
        endpoints.map(endpoint => client.get(endpoint))
      );

      const issuers = responses
        .map((response: any) => response.data.issuer)
        .filter((issuer: any) => issuer && !issuer.includes('OAuth not configured'));

      if (issuers.length > 1) {
        // All issuers should be the same
        expect(new Set(issuers).size).toBe(1);
      }
    });

    it('should use consistent resource URL across protected resource endpoints', async () => {
      const endpoints = [
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-protected-resource/mcp',
      ];

      const responses = await Promise.all(
        endpoints.map(endpoint => client.get(endpoint))
      );

      const resources = responses.map((response: any) => response.data.resource);

      // All resource URLs should be the same
      expect(new Set(resources).size).toBe(1);
    });
  });

  describe('Error Handling and Graceful Degradation', () => {
    it('should handle OAuth not configured gracefully', async () => {
      // Test that endpoints return meaningful responses even when OAuth is not configured
      const response = await client.get('/.well-known/oauth-authorization-server');

      if (response.data.error === 'OAuth not configured') {
        expect(response.data.message).toContain('OAuth provider not available');
        expect(response.data.issuer).toMatch(/^https?:\/\//);
      }
    });

    it('should provide MCP metadata even without OAuth', async () => {
      const response = await client.get('/.well-known/oauth-protected-resource/mcp');

      // MCP metadata should always be available
      expect(response.data.mcp_version).toBe('1.18.0');
      expect(response.data.transport_capabilities).toContain('streamable_http');
    });
  });

  describe('Security Headers and Best Practices', () => {
    it('should include appropriate CORS headers', async () => {
      const response = await client.get('/.well-known/oauth-authorization-server');

      // Check for CORS headers that allow discovery from other origins
      if (expectsCorsHeaders(environment)) {
        expect(response.headers).toHaveProperty('access-control-allow-origin');
        console.log('✅ CORS headers present for cross-origin discovery');
      } else {
        console.log('ℹ️  CORS headers not required for same-origin discovery');
        // For same-origin, CORS headers are optional but may still be present
      }
    });

    it('should use HTTPS in production-like environments', async () => {
      const response = await client.get('/.well-known/oauth-authorization-server');
      const metadata = response.data;

      // In production, all URLs should use HTTPS
      if (process.env.NODE_ENV === 'production' || process.env.REQUIRE_HTTPS === 'true') {
        if (metadata.issuer) {
          expect(metadata.issuer).toMatch(/^https:\/\//);
        }
        if (metadata.authorization_endpoint) {
          expect(metadata.authorization_endpoint).toMatch(/^https:\/\//);
        }
      }
    });
  });
});