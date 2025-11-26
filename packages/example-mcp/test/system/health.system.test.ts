/**
 * System tests for health endpoint and basic deployment validation
 */

import { AxiosInstance } from 'axios';
import {
  createHttpClient,
  waitForServer,
  validateHealthResponse,
  expectValidApiResponse,
  getCurrentEnvironment,
  describeSystemTest,
  isLocalEnvironment,
  isProductionEnvironment,
  isVercelEnvironment,
  expectsCorsHeaders,
  isSTDIOEnvironment
} from './utils.js';

describeSystemTest('Health Endpoint', () => {
  const environment = getCurrentEnvironment();

  // Skip HTTP tests entirely in STDIO mode
  if (isSTDIOEnvironment(environment)) {
    it('should skip HTTP health tests in STDIO mode', () => {
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

  describe('Basic Health Check', () => {
    it('should respond to health endpoint', async () => {
      const response = await client.get('/health');
      expectValidApiResponse(response, 200);
    });

    it('should return valid health status', async () => {
      const response = await client.get('/health');
      const health = validateHealthResponse(response);

      expect(health.status).toBe('healthy');
      expect(health.timestamp).toBeDefined();
      expect(new Date(health.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('should include basic system information', async () => {
      const response = await client.get('/health');
      const health = validateHealthResponse(response);

      expect(health.version).toBeDefined();
      expect(health.node_version).toBeDefined();
      expect(health.mode).toBeDefined();
    });
  });

  describe('Deployment Configuration', () => {
    it('should indicate correct deployment environment', async () => {
      const response = await client.get('/health');
      const health = validateHealthResponse(response);

      if (isLocalEnvironment(environment)) {
        // Local environments (Express, Vercel:local, Docker) should not report Vercel deployment
        expect(health.deployment).not.toBe('vercel');
        // Express should report "local", Vercel:local should report "development"
        expect(['local', 'development', 'docker']).toContain(health.deployment);
      } else if (isVercelEnvironment(environment)) {
        // Vercel environments should report Vercel deployment
        expect(health.deployment).toBe('vercel');
        expect(health.vercel_deployment_id).toBeDefined();
        expect(health.region).toBeDefined();
      }
    });

    it('should report transport mode', async () => {
      const response = await client.get('/health');
      const health = validateHealthResponse(response);

      // System testing always expects streamable_http mode
      expect(health.mode).toBe('streamable_http');
    });

    it('should report authentication status', async () => {
      const response = await client.get('/health');
      const health = validateHealthResponse(response);

      // Auth status should be either enabled or disabled
      expect(['enabled', 'disabled']).toContain(health.auth);

      // Express environment typically has auth disabled in dev mode
      if (environment.name === 'express') {
        console.log(`ℹ️ Express auth status: ${health.auth}`);
      }

      // Production environments should have auth enabled
      if (isProductionEnvironment(environment)) {
        expect(health.auth).toBe('enabled');
      }
    });
  });

  describe('Provider Configuration', () => {
    it('should report OAuth provider if configured', async () => {
      const response = await client.get('/health');
      const health = validateHealthResponse(response);

      if (health.auth === 'enabled') {
        expect(health.oauth_provider).toBeDefined();
        expect(health.oauth_provider).toMatch(/^(google|github|microsoft|generic)$/);
      }
    });

    it('should report available LLM providers', async () => {
      const response = await client.get('/health');
      const health = validateHealthResponse(response);

      expect(health.llm_providers).toBeDefined();
      expect(Array.isArray(health.llm_providers)).toBe(true);

      // Should have at least one LLM provider configured
      if (environment.name === 'production') {
        expect(health.llm_providers!.length).toBeGreaterThan(0);
      }

      // Validate provider names if any are present
      if (health.llm_providers && health.llm_providers.length > 0) {
        for (const provider of health.llm_providers) {
          expect(provider).toMatch(/^(claude|openai|gemini)$/);
        }
      }
    });
  });

  describe('Performance Metrics', () => {
    it('should include performance information', async () => {
      const response = await client.get('/health');
      const health = validateHealthResponse(response);

      expect(health.performance).toBeDefined();
      expect(health.performance!.uptime_seconds).toBeGreaterThanOrEqual(0);
      expect(health.performance!.memory_usage).toBeDefined();
    });

    it('should respond within acceptable time', async () => {
      const startTime = Date.now();
      const response = await client.get('/health');
      const responseTime = Date.now() - startTime;

      expectValidApiResponse(response, 200);

      // Health endpoint should be fast
      expect(responseTime).toBeLessThan(5000); // 5 seconds max

      // Production should be even faster
      if (environment.name === 'production') {
        expect(responseTime).toBeLessThan(2000); // 2 seconds max
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid health requests gracefully', async () => {
      const response = await client.post('/health', { invalid: 'data' });

      // Express returns 404, Vercel might return 405 or 501
      if (environment.name === 'express' || environment.name === 'express:ci') {
        expect([404, 405, 501]).toContain(response.status);
      } else {
        expect([200, 405, 501]).toContain(response.status);
      }
    });

    it('should include proper CORS headers', async () => {
      const response = await client.get('/health');

      expectValidApiResponse(response, 200);

      // Check for CORS headers - behavior depends on environment and request origin
      if (response.headers['access-control-allow-origin']) {
        console.log('✅ CORS headers present');
        console.log(`🔗 Access-Control-Allow-Origin: ${response.headers['access-control-allow-origin']}`);

        // Verify CORS headers are properly configured
        expect(response.headers['access-control-allow-origin']).toBeDefined();

        // For GET requests, methods and headers might not be present
        // These are typically sent in preflight (OPTIONS) responses
        console.log('📋 Available CORS headers:', Object.keys(response.headers).filter(h => h.startsWith('access-control')));

        // Check if it's a preflight response (OPTIONS) or regular response
        if (response.config?.method?.toUpperCase() === 'OPTIONS' ||
            response.headers['access-control-allow-methods'] ||
            response.headers['access-control-allow-headers']) {
          expect(response.headers['access-control-allow-methods']).toBeDefined();
          expect(response.headers['access-control-allow-headers']).toBeDefined();
        }
      } else {
        // CORS headers not present - check if they're expected for this environment
        if (expectsCorsHeaders(environment)) {
          console.log('❌ CORS headers expected but not present for cross-origin environment');
          expect(response.headers['access-control-allow-origin']).toBeDefined();
        } else {
          console.log('ℹ️  No CORS headers (same-origin request - expected behavior)');
        }
      }
    });

    it('should handle CORS preflight requests correctly', async () => {
      // Test CORS preflight with OPTIONS request
      const optionsResponse = await client.options('/health');

      // OPTIONS should return 200
      expect(optionsResponse.status).toBe(200);

      // Check if CORS headers are expected for this environment
      if (expectsCorsHeaders(environment)) {
        // CORS preflight headers should be present
        expect(optionsResponse.headers['access-control-allow-origin']).toBeDefined();
        expect(optionsResponse.headers['access-control-allow-methods']).toBeDefined();
        expect(optionsResponse.headers['access-control-allow-headers']).toBeDefined();

        console.log('✅ CORS preflight request handled correctly');
        console.log(`🔗 Allowed Origin: ${optionsResponse.headers['access-control-allow-origin']}`);
        console.log(`📋 Allowed Methods: ${optionsResponse.headers['access-control-allow-methods']}`);
        console.log(`📝 Allowed Headers: ${optionsResponse.headers['access-control-allow-headers']}`);
      } else {
        console.log('ℹ️  OPTIONS request handled correctly (CORS headers not needed for same-origin)');

        // For same-origin requests, CORS headers might not be present
        if (optionsResponse.headers['access-control-allow-origin']) {
          console.log('🔗 CORS headers present even for same-origin (server configured for cross-origin support)');
        }
      }
    });
  });
});