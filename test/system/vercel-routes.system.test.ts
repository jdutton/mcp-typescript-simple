/**
 * Vercel Route Coverage System Tests
 *
 * Comprehensive testing of all Vercel serverless function routes to ensure:
 * - All routes defined in vercel.json are accessible
 * - Proper HTTP methods are supported
 * - CORS headers are correctly set
 * - Error handling is consistent
 * - Response formats match specifications
 *
 * Usage:
 * 1. Start the server: npm run dev:http (or npm run dev:oauth)
 * 2. Run tests: TEST_ENV=express npm run test:system -- test/system/vercel-routes.system.test.ts
 */

import axios, { AxiosInstance } from 'axios';
import {
  createHttpClient,
  waitForServer,
  describeSystemTest,
  isSTDIOEnvironment,
  getCurrentEnvironment
} from './utils.js';

describeSystemTest('Vercel Route Coverage System Tests', () => {
  const environment = getCurrentEnvironment();

  // Skip HTTP tests entirely in STDIO mode
  if (isSTDIOEnvironment(environment)) {
    it('should skip HTTP route tests in STDIO mode', () => {
      console.log('ℹ️  HTTP route tests skipped for environment: STDIO transport mode');
    });
    return;
  }

  let client: AxiosInstance;

  beforeAll(async () => {
    client = createHttpClient();
    const isReady = await waitForServer(client);
    if (!isReady) {
      throw new Error(`Server not ready at ${environment.baseUrl}`);
    }
  });

  const BASE_URL = environment.baseUrl;

  describe('Health Endpoint (/health)', () => {
    it('should respond with 200 and health status', async () => {
      const response = await axios.get(`${BASE_URL}/health`);

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('status', 'healthy');
      expect(response.data).toHaveProperty('timestamp');
      expect(response.data).toHaveProperty('deployment');
      expect(response.data).toHaveProperty('mode');
    });

    it('should include CORS headers', async () => {
      const response = await axios.get(`${BASE_URL}/health`);

      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-methods']).toContain('GET');
    });

    it('should handle OPTIONS preflight request', async () => {
      const response = await axios.options(`${BASE_URL}/health`);

      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe('*');
    });
  });

  describe('MCP Endpoint (/mcp)', () => {
    it('should respond to GET requests', async () => {
      const response = await axios.get(`${BASE_URL}/mcp`);

      expect(response.status).toBe(200);
    });

    it('should respond to POST requests for tool execution', async () => {
      const response = await axios.post(`${BASE_URL}/mcp`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {}
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('jsonrpc', '2.0');
    });

    it('should include CORS headers', async () => {
      const response = await axios.get(`${BASE_URL}/mcp`);

      expect(response.headers['access-control-allow-origin']).toBe('*');
    });

    it('should handle OPTIONS preflight request', async () => {
      const response = await axios.options(`${BASE_URL}/mcp`);

      expect(response.status).toBe(200);
    });
  });

  describe('Admin Endpoints (/admin/*)', () => {
    describe('/admin/sessions', () => {
      it('should return session list (empty for serverless)', async () => {
        const response = await axios.get(`${BASE_URL}/admin/sessions`);

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('sessions');
        expect(response.data).toHaveProperty('stats');
        expect(response.data).toHaveProperty('deployment');
        expect(response.data.deployment.platform).toBe('vercel');
      });

      it('should include CORS headers', async () => {
        const response = await axios.get(`${BASE_URL}/admin/sessions`);

        expect(response.headers['access-control-allow-origin']).toBe('*');
        expect(response.headers['access-control-allow-methods']).toContain('GET');
      });
    });

    describe('/admin/info', () => {
      it('should return deployment information', async () => {
        const response = await axios.get(`${BASE_URL}/admin/info`);

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('platform', 'vercel');
        expect(response.data).toHaveProperty('mode', 'serverless');
        expect(response.data).toHaveProperty('version');
        expect(response.data).toHaveProperty('node_version');
        expect(response.data).toHaveProperty('oauth_provider');
        expect(response.data).toHaveProperty('oauth_configured');
        expect(response.data).toHaveProperty('llm_providers');
      });
    });

    describe('/admin/status', () => {
      it('should return status information (alias for /info)', async () => {
        const response = await axios.get(`${BASE_URL}/admin/status`);

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('platform', 'vercel');
        expect(response.data).toHaveProperty('mode', 'serverless');
      });
    });

    describe('/admin/metrics', () => {
      it('should return metrics data', async () => {
        const response = await axios.get(`${BASE_URL}/admin/metrics`);

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('timestamp');
        expect(response.data).toHaveProperty('platform', 'vercel-serverless');
        expect(response.data).toHaveProperty('performance');
        expect(response.data).toHaveProperty('deployment');
        expect(response.data).toHaveProperty('configuration');
        expect(response.data).toHaveProperty('endpoints');

        // Validate performance metrics
        expect(response.data.performance).toHaveProperty('uptime_seconds');
        expect(response.data.performance).toHaveProperty('memory_usage');
        expect(response.data.performance).toHaveProperty('cpu_usage');

        // Validate deployment info
        expect(response.data.deployment).toHaveProperty('region');
        expect(response.data.deployment).toHaveProperty('version');
        expect(response.data.deployment).toHaveProperty('node_version');
      });
    });

    describe('/admin/sessions/:sessionId (DELETE)', () => {
      it('should return not available message for serverless', async () => {
        try {
          const response = await axios.delete(`${BASE_URL}/admin/sessions/test-session-id`);

          expect(response.status).toBe(200);
          expect(response.data).toHaveProperty('success', false);
          expect(response.data).toHaveProperty('message');
          expect(response.data.message).toContain('not available in serverless');
        } catch (error) {
          // 404 is also acceptable since session doesn't exist
          if (axios.isAxiosError(error) && error.response?.status === 404) {
            expect(error.response.status).toBe(404);
          } else {
            throw error;
          }
        }
      });
    });

    describe('Invalid admin endpoint', () => {
      it('should return 404 for unknown admin endpoint', async () => {
        try {
          await axios.get(`${BASE_URL}/admin/invalid-endpoint`);
          fail('Should have thrown 404 error');
        } catch (error) {
          if (axios.isAxiosError(error)) {
            expect(error.response?.status).toBe(404);
            expect(error.response?.data).toHaveProperty('error', 'Not found');
            expect(error.response?.data).toHaveProperty('available_endpoints');
          } else {
            throw error;
          }
        }
      });
    });

    describe('OPTIONS preflight', () => {
      it('should handle OPTIONS request', async () => {
        const response = await axios.options(`${BASE_URL}/admin/sessions`);

        expect(response.status).toBe(200);
        expect(response.headers['access-control-allow-origin']).toBe('*');
        expect(response.headers['access-control-allow-methods']).toContain('GET');
        expect(response.headers['access-control-allow-methods']).toContain('DELETE');
      });
    });
  });

  describe('Register Endpoint (/register)', () => {
    describe('POST /register - Dynamic Client Registration', () => {
      it('should register new OAuth client with valid request', async () => {
        const clientRegistration = {
          client_name: 'Test MCP Client',
          redirect_uris: ['http://localhost:3000/callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'client_secret_post',
          scope: 'openid email profile'
        };

        const response = await axios.post(`${BASE_URL}/register`, clientRegistration);

        expect(response.status).toBe(201);
        expect(response.data).toHaveProperty('client_id');
        expect(response.data).toHaveProperty('client_secret');
        expect(response.data).toHaveProperty('client_id_issued_at');
        expect(response.data).toHaveProperty('client_name', 'Test MCP Client');
        expect(response.data).toHaveProperty('redirect_uris');
        expect(response.data.redirect_uris).toEqual(['http://localhost:3000/callback']);
      });

      it('should reject registration without redirect_uris', async () => {
        try {
          await axios.post(`${BASE_URL}/register`, {
            client_name: 'Invalid Client'
          });
          fail('Should have thrown 400 error');
        } catch (error) {
          if (axios.isAxiosError(error)) {
            expect(error.response?.status).toBe(400);
            expect(error.response?.data).toHaveProperty('error', 'invalid_client_metadata');
            expect(error.response?.data.error_description).toContain('redirect_uris');
          } else {
            throw error;
          }
        }
      });

      it('should reject registration with invalid redirect_uris format', async () => {
        try {
          await axios.post(`${BASE_URL}/register`, {
            client_name: 'Invalid Client',
            redirect_uris: ['not-a-valid-url']
          });
          fail('Should have thrown 400 error');
        } catch (error) {
          if (axios.isAxiosError(error)) {
            expect(error.response?.status).toBe(400);
            expect(error.response?.data).toHaveProperty('error', 'invalid_client_metadata');
          } else {
            throw error;
          }
        }
      });

      it('should include anti-caching headers (RFC 9700)', async () => {
        const clientRegistration = {
          client_name: 'Test Client',
          redirect_uris: ['http://localhost:3000/callback']
        };

        const response = await axios.post(`${BASE_URL}/register`, clientRegistration);

        expect(response.status).toBe(201);
        expect(response.headers['cache-control']).toBeDefined();
        expect(response.headers['cache-control']).toContain('no-store');
      });
    });

    describe('GET /register?client_id=:id - Retrieve Client Config', () => {
      it('should retrieve registered client without secret', async () => {
        // First register a client
        const registration = await axios.post(`${BASE_URL}/register`, {
          client_name: 'Retrievable Client',
          redirect_uris: ['http://localhost:3000/callback']
        });

        const clientId = registration.data.client_id;

        // Then retrieve it
        const response = await axios.get(`${BASE_URL}/register`, {
          params: { client_id: clientId }
        });

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('client_id', clientId);
        expect(response.data).not.toHaveProperty('client_secret'); // Secret should be omitted
        expect(response.data).toHaveProperty('client_name', 'Retrievable Client');
      });

      it('should return 404 for non-existent client', async () => {
        try {
          await axios.get(`${BASE_URL}/register`, {
            params: { client_id: 'non-existent-client' }
          });
          fail('Should have thrown 404 error');
        } catch (error) {
          if (axios.isAxiosError(error)) {
            expect(error.response?.status).toBe(404);
            expect(error.response?.data).toHaveProperty('error', 'invalid_client');
          } else {
            throw error;
          }
        }
      });

      it('should return 400 without client_id parameter', async () => {
        try {
          await axios.get(`${BASE_URL}/register`);
          fail('Should have thrown 400 error');
        } catch (error) {
          if (axios.isAxiosError(error)) {
            expect(error.response?.status).toBe(400);
            expect(error.response?.data).toHaveProperty('error', 'invalid_request');
          } else {
            throw error;
          }
        }
      });
    });

    describe('DELETE /register?client_id=:id - Delete Client', () => {
      it('should delete registered client', async () => {
        // First register a client
        const registration = await axios.post(`${BASE_URL}/register`, {
          client_name: 'Deletable Client',
          redirect_uris: ['http://localhost:3000/callback']
        });

        const clientId = registration.data.client_id;

        // Then delete it
        const response = await axios.delete(`${BASE_URL}/register`, {
          params: { client_id: clientId }
        });

        expect(response.status).toBe(204);
        expect(response.data).toBe(''); // No content

        // Verify it's deleted by trying to retrieve
        try {
          await axios.get(`${BASE_URL}/register`, {
            params: { client_id: clientId }
          });
          fail('Should have thrown 404 error');
        } catch (error) {
          if (axios.isAxiosError(error)) {
            expect(error.response?.status).toBe(404);
          } else {
            throw error;
          }
        }
      });

      it('should return 404 when deleting non-existent client', async () => {
        try {
          await axios.delete(`${BASE_URL}/register`, {
            params: { client_id: 'non-existent-client' }
          });
          fail('Should have thrown 404 error');
        } catch (error) {
          if (axios.isAxiosError(error)) {
            expect(error.response?.status).toBe(404);
            expect(error.response?.data).toHaveProperty('error', 'invalid_client');
          } else {
            throw error;
          }
        }
      });

      it('should return 400 without client_id parameter', async () => {
        try {
          await axios.delete(`${BASE_URL}/register`);
          fail('Should have thrown 400 error');
        } catch (error) {
          if (axios.isAxiosError(error)) {
            expect(error.response?.status).toBe(400);
            expect(error.response?.data).toHaveProperty('error', 'invalid_request');
          } else {
            throw error;
          }
        }
      });
    });

    describe('OPTIONS preflight', () => {
      it('should handle OPTIONS request', async () => {
        const response = await axios.options(`${BASE_URL}/register`);

        expect(response.status).toBe(200);
        expect(response.headers['access-control-allow-origin']).toBe('*');
        expect(response.headers['access-control-allow-methods']).toContain('POST');
        expect(response.headers['access-control-allow-methods']).toContain('GET');
        expect(response.headers['access-control-allow-methods']).toContain('DELETE');
      });
    });

    describe('Method not allowed', () => {
      it('should return 405 for unsupported HTTP method', async () => {
        try {
          await axios.patch(`${BASE_URL}/register`, {});
          fail('Should have thrown 405 error');
        } catch (error) {
          if (axios.isAxiosError(error)) {
            expect(error.response?.status).toBe(405);
            expect(error.response?.data).toHaveProperty('error', 'method_not_allowed');
          } else {
            throw error;
          }
        }
      });
    });

    describe('CORS headers', () => {
      it('should include CORS headers on all responses', async () => {
        const registration = await axios.post(`${BASE_URL}/register`, {
          client_name: 'CORS Test Client',
          redirect_uris: ['http://localhost:3000/callback']
        });

        expect(registration.headers['access-control-allow-origin']).toBe('*');
        expect(registration.headers['access-control-allow-methods']).toContain('POST');
        expect(registration.headers['access-control-allow-headers']).toContain('Content-Type');
      });
    });
  });

  describe('Well-Known Endpoints (/.well-known/*)', () => {
    it('should respond to /.well-known/oauth-authorization-server', async () => {
      const response = await axios.get(`${BASE_URL}/.well-known/oauth-authorization-server`);

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('issuer');
      expect(response.data).toHaveProperty('authorization_endpoint');
      expect(response.data).toHaveProperty('token_endpoint');
      expect(response.data).toHaveProperty('registration_endpoint');
    });

    it('should respond to /.well-known/mcp-oauth-discovery', async () => {
      const response = await axios.get(`${BASE_URL}/.well-known/mcp-oauth-discovery`);

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('resource');
      expect(response.data).toHaveProperty('authorization_servers');
      expect(response.data).toHaveProperty('mcp_version');
    });

    it('should include CORS headers', async () => {
      const response = await axios.get(`${BASE_URL}/.well-known/oauth-authorization-server`);

      expect(response.headers['access-control-allow-origin']).toBe('*');
    });
  });

  describe('Route Rewrites from vercel.json', () => {
    it('should rewrite /health to /api/health', async () => {
      const response = await axios.get(`${BASE_URL}/health`);
      expect(response.status).toBe(200);
    });

    it('should rewrite /mcp to /api/mcp', async () => {
      const response = await axios.get(`${BASE_URL}/mcp`);
      expect(response.status).toBe(200);
    });

    it('should rewrite /register to /api/register', async () => {
      // Test with a GET request to avoid registration side effects
      try {
        await axios.get(`${BASE_URL}/register`);
      } catch (error) {
        // 400 is expected without client_id, which proves routing works
        if (axios.isAxiosError(error)) {
          expect(error.response?.status).toBe(400);
        } else {
          throw error;
        }
      }
    });

    it('should rewrite /admin/* to /api/admin', async () => {
      const response = await axios.get(`${BASE_URL}/admin/info`);
      expect(response.status).toBe(200);
    });

    it('should rewrite /auth/* to /api/auth', async () => {
      // Auth endpoint requires specific OAuth flow, so just verify routing
      const response = await axios.get(`${BASE_URL}/auth/login`);
      // Any response (including error) proves routing works
      expect([200, 302, 400, 401]).toContain(response.status);
    });

    it('should rewrite /.well-known/* to /api/well-known', async () => {
      const response = await axios.get(`${BASE_URL}/.well-known/oauth-authorization-server`);
      expect(response.status).toBe(200);
    });
  });

  describe('Error Handling Consistency', () => {
    it('should return JSON error responses', async () => {
      try {
        await axios.get(`${BASE_URL}/admin/non-existent-endpoint`);
        fail('Should have thrown error');
      } catch (error) {
        if (axios.isAxiosError(error)) {
          expect(error.response?.headers['content-type']).toContain('application/json');
          expect(error.response?.data).toHaveProperty('error');
          expect(error.response?.data).toHaveProperty('message');
        } else {
          throw error;
        }
      }
    });

    it('should include proper error codes', async () => {
      try {
        await axios.get(`${BASE_URL}/admin/invalid`);
        fail('Should have thrown error');
      } catch (error) {
        if (axios.isAxiosError(error)) {
          expect(error.response?.status).toBe(404);
          expect(error.response?.data.error).toBe('Not found');
        } else {
          throw error;
        }
      }
    });
  });

  describe('CORS Consistency Across All Endpoints', () => {
    const endpoints = [
      '/health',
      '/mcp',
      '/admin/sessions',
      '/admin/info',
      '/admin/metrics',
      '/.well-known/oauth-authorization-server'
    ];

    endpoints.forEach(endpoint => {
      it(`should include CORS headers on ${endpoint}`, async () => {
        const response = await axios.get(`${BASE_URL}${endpoint}`);

        expect(response.headers['access-control-allow-origin']).toBe('*');
        expect(response.headers['access-control-allow-methods']).toBeDefined();
        expect(response.headers['access-control-allow-headers']).toBeDefined();
      });

      it(`should handle OPTIONS preflight on ${endpoint}`, async () => {
        const response = await axios.options(`${BASE_URL}${endpoint}`);

        expect(response.status).toBe(200);
        expect(response.headers['access-control-allow-origin']).toBe('*');
      });
    });
  });
});
