/**
 * Integration tests for Admin Routes
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import { Express } from 'express';
import { MCPStreamableHttpServer } from '../../src/server/streamable-http-server.js';
import { OAuthProviderFactory } from '../../src/auth/factory.js';

// Mock the OAuth provider factory to return a test provider
jest.mock('../../src/auth/factory.js');

const mockOAuthProviderFactory = OAuthProviderFactory as jest.Mocked<typeof OAuthProviderFactory>;

const mockProvider = {
  getProviderType: () => 'google' as const,
  getEndpoints: () => ({
    authEndpoint: '/auth/google',
    callbackEndpoint: '/auth/google/callback',
    refreshEndpoint: '/auth/google/refresh',
    logoutEndpoint: '/auth/google/logout',
  }),
  handleAuthorizationRequest: jest.fn(),
  handleAuthorizationCallback: jest.fn(),
  handleTokenRefresh: jest.fn(),
  handleLogout: jest.fn(),
  verifyAccessToken: jest.fn(),
  dispose: jest.fn(),
};

describe('Admin Routes Integration', () => {
  let server: MCPStreamableHttpServer;
  let app: Express;

  beforeEach(async () => {
    // Mock successful OAuth provider creation
    mockOAuthProviderFactory.createFromEnvironment.mockResolvedValue(mockProvider as any);

    // Create server instance
    server = new MCPStreamableHttpServer({
      port: 3020,
      host: 'localhost',
      endpoint: '/mcp',
      requireAuth: true,
      sessionSecret: 'test-secret',
      enableResumability: true,
      enableJsonResponse: true,
    });

    // Initialize OAuth routes
    await server.initialize();
    app = server.getApp();
  });

  afterEach(async () => {
    await server.stop();
    jest.clearAllMocks();
  });

  describe('GET /admin/sessions', () => {
    it('should return list of active sessions', async () => {
      const response = await request(app)
        .get('/admin/sessions')
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        sessions: expect.any(Array),
        stats: expect.objectContaining({
          total: expect.any(Number),
          active: expect.any(Number),
        }),
      });

      // Initially should have no sessions
      expect(response.body.sessions).toHaveLength(0);
      expect(response.body.stats.total).toBe(0);
      expect(response.body.stats.active).toBe(0);
    });

    it('should return session data with proper format', async () => {
      const response = await request(app)
        .get('/admin/sessions')
        .expect(200);

      expect(response.body.sessions).toBeInstanceOf(Array);
      expect(response.body.stats).toHaveProperty('total');
      expect(response.body.stats).toHaveProperty('active');
      expect(response.body.stats).toHaveProperty('closed');
    });
  });

  describe('DELETE /admin/sessions/:sessionId', () => {
    it('should return 404 when session ID is missing', async () => {
      await request(app)
        .delete('/admin/sessions/')
        .expect(404); // Express returns 404 for missing route parameter

      // The route doesn't match without a session ID, so it returns 404
    });

    it('should return 404 when session does not exist', async () => {
      const nonExistentSessionId = 'non-existent-session-id';

      const response = await request(app)
        .delete(`/admin/sessions/${nonExistentSessionId}`)
        .expect(404)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        error: 'Session not found',
      });
    });

    it('should handle session ID validation', async () => {
      // Test with a UUID-format session ID that doesn't exist
      const fakeSessionId = '550e8400-e29b-41d4-a716-446655440000';

      const response = await request(app)
        .delete(`/admin/sessions/${fakeSessionId}`)
        .expect(404);

      expect(response.body.error).toBe('Session not found');
    });
  });

  describe('GET /admin/metrics', () => {
    it('should return comprehensive metrics', async () => {
      const response = await request(app)
        .get('/admin/metrics')
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        platform: 'express-standalone',
        performance: expect.objectContaining({
          uptime_seconds: expect.any(Number),
          memory_usage: expect.objectContaining({
            rss: expect.any(Number),
            heapTotal: expect.any(Number),
            heapUsed: expect.any(Number),
            external: expect.any(Number),
          }),
          cpu_usage: expect.objectContaining({
            user: expect.any(Number),
            system: expect.any(Number),
          }),
        }),
        deployment: expect.objectContaining({
          mode: 'standalone',
          version: expect.any(String),
          node_version: expect.stringMatching(/^v\d+\.\d+\.\d+$/),
          environment: expect.stringMatching(/^(development|test|production)$/),
        }),
        configuration: expect.objectContaining({
          oauth_providers: expect.any(Array),
          oauth_configured: expect.any(Boolean),
          llm_providers: expect.any(Object),
          transport_mode: 'streamable_http',
        }),
        sessions: expect.objectContaining({
          total: expect.any(Number),
          active: expect.any(Number),
          closed: expect.any(Number),
        }),
        endpoints: expect.objectContaining({
          health: '/health',
          mcp: '/mcp',
          auth: '/auth',
          admin: '/admin',
        }),
      });
    });

    it('should include OAuth configuration status', async () => {
      const response = await request(app)
        .get('/admin/metrics')
        .expect(200);

      expect(response.body.configuration).toHaveProperty('oauth_providers');
      expect(response.body.configuration).toHaveProperty('oauth_configured');
      expect(Array.isArray(response.body.configuration.oauth_providers)).toBe(true);
      // Each configured provider should be one of the supported types
      response.body.configuration.oauth_providers.forEach((provider: string) => {
        expect(['google', 'github', 'microsoft', 'generic']).toContain(provider);
      });
    });

    it('should include LLM providers status', async () => {
      const response = await request(app)
        .get('/admin/metrics')
        .expect(200);

      expect(response.body.configuration.llm_providers).toHaveProperty('claude');
      expect(response.body.configuration.llm_providers).toHaveProperty('openai');
      expect(response.body.configuration.llm_providers).toHaveProperty('gemini');
    });

    it('should report accurate performance metrics', async () => {
      const response = await request(app)
        .get('/admin/metrics')
        .expect(200);

      // Uptime should be positive
      expect(response.body.performance.uptime_seconds).toBeGreaterThan(0);

      // Memory usage should be positive
      expect(response.body.performance.memory_usage.rss).toBeGreaterThan(0);
      expect(response.body.performance.memory_usage.heapUsed).toBeGreaterThan(0);

      // CPU usage should be non-negative
      expect(response.body.performance.cpu_usage.user).toBeGreaterThanOrEqual(0);
      expect(response.body.performance.cpu_usage.system).toBeGreaterThanOrEqual(0);
    });

    it('should return consistent metrics format on multiple calls', async () => {
      const response1 = await request(app).get('/admin/metrics').expect(200);
      const response2 = await request(app).get('/admin/metrics').expect(200);

      // Structure should be identical
      expect(Object.keys(response1.body).sort()).toEqual(
        Object.keys(response2.body).sort()
      );

      // Uptime should increase
      expect(response2.body.performance.uptime_seconds).toBeGreaterThanOrEqual(
        response1.body.performance.uptime_seconds
      );
    });
  });

  describe('Admin endpoints security', () => {
    it('should not require authentication for metrics endpoint', async () => {
      // Admin endpoints are public in current implementation
      await request(app)
        .get('/admin/metrics')
        .expect(200);
    });

    it('should not require authentication for sessions endpoint', async () => {
      // Admin endpoints are public in current implementation
      await request(app)
        .get('/admin/sessions')
        .expect(200);
    });
  });
});