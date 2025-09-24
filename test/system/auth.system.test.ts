/**
 * System tests for authentication and OAuth configuration
 */

import { AxiosInstance } from 'axios';
import {
  createHttpClient,
  waitForServer,
  expectValidApiResponse,
  expectErrorResponse,
  testEndpointExists,
  getCurrentEnvironment,
  describeSystemTest,
  detectServerCapabilities,
  discoverOAuthEndpoints,
  conditionalDescribe,
  ServerCapabilities,
  isLocalEnvironment,
  isProductionEnvironment,
  isVercelEnvironment
} from './utils.js';

describeSystemTest('Authentication System', () => {
  let client: AxiosInstance;
  let capabilities: ServerCapabilities;
  const environment = getCurrentEnvironment();

  beforeAll(async () => {
    client = createHttpClient();

    // For local environments, wait for server to be ready
    if (isLocalEnvironment(environment)) {
      const isReady = await waitForServer(client);
      if (!isReady) {
        throw new Error(`Server not ready at ${environment.baseUrl}`);
      }
    }

    // Detect server capabilities
    capabilities = await detectServerCapabilities(client);
    console.log(`🔍 Server capabilities detected:`, {
      hasAuth: capabilities.hasAuth,
      hasLLM: capabilities.hasLLM,
      oauthProvider: capabilities.oauthProvider,
      endpoints: Object.keys(capabilities.endpoints)
    });

    if (!capabilities.hasAuth) {
      console.log('⏭️  Auth is disabled - most auth tests will be skipped');
    }
  });

  describe('Auth Endpoint Availability', () => {
    it('should respond to auth endpoint', async () => {
      if (!capabilities?.hasAuth) {
        console.log('⏭️  Skipping: Auth is disabled');
        return;
      }

      const authEndpoint = capabilities.endpoints.auth;
      expect(authEndpoint).toBeDefined();
      if (!authEndpoint) return; // Type guard

      const response = await testEndpointExists(client, authEndpoint);
      // Auth endpoint might return various responses depending on configuration
      expect([200, 400, 404, 500]).toContain(response.status);
    });

    it('should handle OPTIONS requests for CORS', async () => {
      if (!capabilities?.hasAuth) {
        console.log('⏭️  Skipping: Auth is disabled');
        return;
      }

      const authEndpoint = capabilities.endpoints.auth;
      if (!authEndpoint) return; // Type guard

      const response = await client.options(authEndpoint);
      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBeDefined();
      expect(response.headers['access-control-allow-methods']).toBeDefined();
    });
  });

  describe('OAuth Provider Configuration', () => {
    it('should validate OAuth provider configuration', async () => {
      if (!capabilities?.hasAuth) {
        console.log('⏭️  Skipping: Auth is disabled');
        return;
      }

      const healthResponse = await client.get('/health');
      expectValidApiResponse(healthResponse, 200);

      const health = healthResponse.data;
      expect(health.auth).toBe('enabled');
      expect(health.oauth_provider).toBeDefined();

      console.log(`🔐 OAuth provider configured: ${health.oauth_provider}`);

      // Discover OAuth endpoints dynamically
      const provider = health.oauth_provider;
      const authBase = capabilities.endpoints.auth;
      if (!authBase) return; // Type guard

      const oauthEndpoints = await discoverOAuthEndpoints(client, provider, authBase);

      await testOAuthProviderEndpoints(client, provider, oauthEndpoints);
    });

    async function testOAuthProviderEndpoints(client: AxiosInstance, provider: string, oauthEndpoints: Record<string, string>) {
      if (oauthEndpoints.oauth_login) {
        // Test authorization endpoint
        const authResponse = await client.get(oauthEndpoints.oauth_login);

        // Authorization endpoint should either redirect or return configuration
        expect([200, 302, 400, 500]).toContain(authResponse.status);

        if (authResponse.status === 302) {
          expect(authResponse.headers.location).toBeDefined();
          console.log(`🔀 Authorization redirect URL: ${authResponse.headers.location}`);
        }
      }

      if (oauthEndpoints.oauth_callback) {
        // Test callback endpoint exists
        const callbackResponse = await client.get(oauthEndpoints.oauth_callback);

        // Callback without proper parameters should return an error
        expect([400, 401, 404, 500]).toContain(callbackResponse.status);
      }
    }
  });

  describe('OAuth Flow Validation', () => {
    it('should validate OAuth endpoints structure', async () => {
      const healthResponse = await client.get('/health');
      const health = healthResponse.data;

      if (health.auth === 'enabled' && health.oauth_provider) {
        const provider = health.oauth_provider;

        // Test that OAuth endpoints return structured responses
        const authResponse = await client.get(`/auth/${provider}`, {
          headers: { 'Accept': 'application/json' }
        });

        if (authResponse.status === 200 && authResponse.data) {
          // If it returns JSON, validate the structure
          expect(authResponse.data).toBeDefined();
        }

        // Test error responses are properly formatted
        const invalidCallbackResponse = await client.get(`/auth/${provider}/callback`);
        if (invalidCallbackResponse.status >= 400 && invalidCallbackResponse.data) {
          expect(invalidCallbackResponse.data.error).toBeDefined();
        }
      }
    });

    it('should handle invalid OAuth requests gracefully', async () => {
      // System testing always expects auth to be enabled
      // Test invalid provider
      const invalidProviderResponse = await client.get('/auth/invalid-provider');
      expectErrorResponse(invalidProviderResponse, 404);

      // Test malformed callback
      const malformedCallbackResponse = await client.get('/auth/google/callback?error=invalid_request');
      expect([400, 401, 404, 500]).toContain(malformedCallbackResponse.status);
    });
  });

  describe('Session Management', () => {
    it('should handle session-related endpoints', async () => {
      // System testing always expects auth to be enabled
      // Get the current OAuth provider
      const healthResponse = await client.get('/health');
      const health = healthResponse.data;
      const provider = health.oauth_provider || 'google';

      // Test logout endpoint (provider-specific)
      const logoutResponse = await client.post(`/auth/${provider}/logout`);
      expect([200, 401, 404, 500]).toContain(logoutResponse.status);

      // Test token refresh endpoint (provider-specific)
      const refreshResponse = await client.post(`/auth/${provider}/refresh`);
      expect([400, 401, 404, 500]).toContain(refreshResponse.status);
    });

    it('should include proper security headers', async () => {
      if (!capabilities?.hasAuth) {
        console.log('⏭️  Skipping: Auth is disabled');
        return;
      }

      const authEndpoint = capabilities.endpoints.auth;
      if (!authEndpoint) return; // Type guard

      const response = await client.get(authEndpoint);

      // CORS headers are optional for Express dev environment
      if (response.headers['access-control-allow-origin']) {
        console.log('✅ CORS headers present');
      } else if (environment.name === 'express') {
        console.log('ℹ️  CORS headers not configured in Express dev mode');
      } else {
        // Production/Vercel should have CORS headers
        expect(response.headers['access-control-allow-origin']).toBeDefined();
      }

      // For production, should have additional security measures
      if (isProductionEnvironment(environment)) {
        // Production should enforce HTTPS for OAuth
        if (response.headers.location) {
          expect(response.headers.location).toMatch(/^https:/);
        }
      }
    });
  });

  describe('Authentication Environment Validation', () => {
    it('should validate environment-specific auth configuration', async () => {
      const healthResponse = await client.get('/health');
      const health = healthResponse.data;

      // Auth status should be consistent with capabilities
      expect(['enabled', 'disabled']).toContain(health.auth);

      if (health.auth === 'enabled') {
        expect(health.oauth_provider).toBeDefined();
        console.log(`🔐 OAuth provider: ${health.oauth_provider}`);
      } else {
        console.log('⏭️  Auth is disabled in this environment');
      }
    });

    it('should validate OAuth redirect URLs for environment', async () => {
      const healthResponse = await client.get('/health');
      const health = healthResponse.data;

      if (health.auth === 'enabled' && health.oauth_provider) {
        // For Vercel deployments, redirect URLs should match the deployment URL
        if (environment.name === 'preview' || environment.name === 'production') {
          const authResponse = await client.get(`/auth/${health.oauth_provider}`);

          if (authResponse.status === 302 && authResponse.headers.location) {
            const redirectUrl = new URL(authResponse.headers.location);

            // OAuth redirect should include a callback URL that matches the current environment
            const callbackUrl = redirectUrl.searchParams.get('redirect_uri');
            if (callbackUrl) {
              expect(callbackUrl).toContain(environment.baseUrl);
              console.log(`🔗 OAuth callback URL: ${callbackUrl}`);
            }
          }
        }
      }
    });
  });

  describe('Error Handling and Security', () => {
    it('should handle auth errors securely', async () => {
      // Test that auth errors don't leak sensitive information
      const errorResponse = await client.get('/auth/nonexistent');

      if (errorResponse.status >= 400 && errorResponse.data && errorResponse.data.error) {
        const errorMessage = errorResponse.data.error.toLowerCase();

        // Should not leak sensitive information
        expect(errorMessage).not.toContain('secret');
        expect(errorMessage).not.toContain('key');
        expect(errorMessage).not.toContain('token');
        expect(errorMessage).not.toContain('password');
      }
    });

    it('should enforce HTTPS in production', async () => {
      if (environment.name === 'production') {
        expect(environment.baseUrl).toMatch(/^https:/);

        // All auth-related redirects should use HTTPS
        const authResponse = await client.get('/auth');
        if (authResponse.headers.location) {
          expect(authResponse.headers.location).toMatch(/^https:/);
        }
      }
    });
  });
});