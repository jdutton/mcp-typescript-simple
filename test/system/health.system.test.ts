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
  HealthCheckResponse
} from './utils.js';

describeSystemTest('Health Endpoint', () => {
  let client: AxiosInstance;
  const environment = getCurrentEnvironment();

  beforeAll(async () => {
    client = createHttpClient();

    // For local and docker environments, wait for server to be ready
    if (environment.name === 'local' || environment.name === 'docker') {
      const isReady = await waitForServer(client);
      if (!isReady) {
        throw new Error(`Server not ready at ${environment.baseUrl}`);
      }
    }
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

      if (environment.name === 'local' || environment.name === 'docker') {
        // Local/Docker environments should not report Vercel deployment
        expect(health.deployment).not.toBe('vercel');
      } else {
        // Preview/Production should report Vercel deployment
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

      // System testing always expects auth to be enabled (production-like)
      expect(health.auth).toBe('enabled');
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
        health.llm_providers.forEach(provider => {
          expect(provider).toMatch(/^(claude|openai|gemini)$/);
        });
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

      // Health endpoint should accept POST but likely return 405 or handle gracefully
      expect([200, 405, 501]).toContain(response.status);
    });

    it('should include proper CORS headers', async () => {
      const response = await client.get('/health');

      expectValidApiResponse(response, 200);
      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });
});