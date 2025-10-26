/**
 * Integration tests for Admin Routes
 */

import { vi } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import { MCPStreamableHttpServer } from '@mcp-typescript-simple/http-server';

// Hoist mocks so they're available in vi.mock() factories
const mocks = vi.hoisted(() => ({
  mockProvider: {
    getProviderType: () => 'google' as const,
    getEndpoints: () => ({
      authEndpoint: '/auth/google',
      callbackEndpoint: '/auth/google/callback',
      refreshEndpoint: '/auth/google/refresh',
      logoutEndpoint: '/auth/google/logout',
    }),
    handleAuthorizationRequest: vi.fn(),
    handleAuthorizationCallback: vi.fn(),
    handleTokenRefresh: vi.fn(),
    handleLogout: vi.fn(),
    verifyAccessToken: vi.fn(),
    dispose: vi.fn(),
  },
  createFromEnvironment: vi.fn(),
  createAllFromEnvironment: vi.fn(),
}));

// Mock the OAuth provider factory to return a test provider
vi.mock('@mcp-typescript-simple/auth', () => ({
  OAuthProviderFactory: {
    createFromEnvironment: mocks.createFromEnvironment,
    createAllFromEnvironment: mocks.createAllFromEnvironment,
  },
}));

describe('Admin Routes Integration', () => {
  let server: MCPStreamableHttpServer;
  let app: Express;

  beforeEach(async () => {
    // Enable dev mode to skip authentication for admin routes
    process.env.MCP_DEV_SKIP_AUTH = 'true';

    // Mock successful OAuth provider creation
    mocks.createFromEnvironment.mockResolvedValue(mocks.mockProvider as any);

    // Mock multi-provider creation (returns a Map with the google provider)
    const providersMap = new Map();
    providersMap.set('google', mocks.mockProvider);
    mocks.createAllFromEnvironment.mockResolvedValue(providersMap as any);

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
    delete process.env.MCP_DEV_SKIP_AUTH;
    vi.clearAllMocks();
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
          totalSessions: expect.any(Number),
          activeSessions: expect.any(Number),
        }),
      });

      // Initially should have no sessions
      expect(response.body.sessions).toHaveLength(0);
      expect(response.body.stats.totalSessions).toBe(0);
      expect(response.body.stats.activeSessions).toBe(0);
    });

    it('should return session data with proper format', async () => {
      const response = await request(app)
        .get('/admin/sessions')
        .expect(200);

      expect(response.body.sessions).toBeInstanceOf(Array);
      expect(response.body.stats).toHaveProperty('totalSessions');
      expect(response.body.stats).toHaveProperty('activeSessions');
      expect(response.body.stats).toHaveProperty('expiredSessions');
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
        platform: expect.any(String),
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
          version: expect.any(String),
          node_version: expect.stringMatching(/^v\d+\.\d+\.\d+$/),
          environment: expect.stringMatching(/^(development|test|production)$/),
        }),
        configuration: expect.objectContaining({
          oauth_providers: expect.any(Array),
          llm_providers: expect.any(Array),
          transport_mode: 'streamable_http',
        }),
        sessions: expect.objectContaining({
          totalSessions: expect.any(Number),
          activeSessions: expect.any(Number),
          expiredSessions: expect.any(Number),
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

      expect(response.body.configuration.llm_providers).toBeInstanceOf(Array);
      // llm_providers is an array of configured provider names
      // The test environment may or may not have API keys configured
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