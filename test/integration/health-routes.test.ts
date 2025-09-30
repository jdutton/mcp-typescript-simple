/**
 * Integration tests for Health Routes
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
  getProviderName: () => 'Google OAuth',
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

describe('Health Routes Integration', () => {
  let server: MCPStreamableHttpServer;
  let app: Express;

  beforeEach(async () => {
    // Mock successful OAuth provider creation
    mockOAuthProviderFactory.createFromEnvironment.mockResolvedValue(mockProvider as any);

    // Create server instance
    server = new MCPStreamableHttpServer({
      port: 3021,
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

  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        status: 'healthy',
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
        deployment: 'local',
        mode: 'streamable_http',
      });
    });

    it('should include OAuth configuration status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('auth');
      expect(response.body).toHaveProperty('oauth_provider');
      expect(['enabled', 'disabled']).toContain(response.body.auth);
      expect(['google', 'github', 'microsoft', 'generic']).toContain(
        response.body.oauth_provider
      );
    });

    it('should include LLM providers status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('llm_providers');
      expect(response.body.llm_providers).toHaveProperty('claude');
      expect(response.body.llm_providers).toHaveProperty('openai');
      expect(response.body.llm_providers).toHaveProperty('gemini');
    });

    it('should include version information', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('node_version');
      expect(response.body).toHaveProperty('environment');

      expect(response.body.node_version).toMatch(/^v\d+\.\d+\.\d+$/);
      expect(['development', 'test', 'production']).toContain(
        response.body.environment
      );
    });

    it('should include session statistics', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('sessions');
      expect(response.body.sessions).toMatchObject({
        total: expect.any(Number),
        active: expect.any(Number),
        closed: expect.any(Number),
      });
    });

    it('should include performance metrics', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('performance');
      expect(response.body.performance).toMatchObject({
        uptime_seconds: expect.any(Number),
        memory_usage: expect.objectContaining({
          rss: expect.any(Number),
          heapTotal: expect.any(Number),
          heapUsed: expect.any(Number),
        }),
      });

      // Sanity checks
      expect(response.body.performance.uptime_seconds).toBeGreaterThan(0);
      expect(response.body.performance.memory_usage.rss).toBeGreaterThan(0);
    });

    it('should include feature flags', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('features');
      expect(response.body.features).toMatchObject({
        resumability: expect.any(Boolean),
        jsonResponse: expect.any(Boolean),
      });

      // Verify feature flags match server configuration
      expect(response.body.features.resumability).toBe(true);
      expect(response.body.features.jsonResponse).toBe(true);
    });

    it('should return consistent health check format', async () => {
      const response1 = await request(app).get('/health').expect(200);
      const response2 = await request(app).get('/health').expect(200);

      // Structure should be identical
      expect(Object.keys(response1.body).sort()).toEqual(
        Object.keys(response2.body).sort()
      );

      // Both should report healthy
      expect(response1.body.status).toBe('healthy');
      expect(response2.body.status).toBe('healthy');
    });
  });

  describe('GET /debug/github-oauth', () => {
    it('should require Authorization header', async () => {
      const response = await request(app)
        .get('/debug/github-oauth')
        .expect(400)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        error: 'Missing Authorization header',
        message: expect.stringContaining('Authorization: Bearer'),
      });
    });

    it('should handle invalid token format', async () => {
      const response = await request(app)
        .get('/debug/github-oauth')
        .set('Authorization', 'Bearer invalid-token-format')
        .expect(500) // GitHub API will return an error
        .expect('Content-Type', /application\/json/);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Debug test failed');
    });

    it('should return proper error structure when token is missing', async () => {
      const response = await request(app)
        .get('/debug/github-oauth')
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('message');
      expect(response.body.error).toBe('Missing Authorization header');
    });

    it('should handle Authorization header without Bearer prefix', async () => {
      const response = await request(app)
        .get('/debug/github-oauth')
        .set('Authorization', 'plain-token-without-bearer')
        .expect(500); // Will attempt to use the token and fail

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Debug test failed');
    });

    it('should sanitize token in error responses', async () => {
      // Even if there's an error, the token should not be fully exposed
      const testToken = 'ghp_' + 'x'.repeat(40);

      const response = await request(app)
        .get('/debug/github-oauth')
        .set('Authorization', `Bearer ${testToken}`)
        .expect(500);

      // Response should not contain full token
      const responseText = JSON.stringify(response.body);
      expect(responseText).not.toContain(testToken);
    });
  });

  describe('Health endpoints CORS', () => {
    it('should include CORS headers on health check', async () => {
      const response = await request(app)
        .get('/health')
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      expect(response.headers).toHaveProperty('access-control-allow-origin');
    });

    it('should handle preflight requests for health endpoint', async () => {
      const response = await request(app)
        .options('/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET')
        .expect(200);

      expect(response.headers).toHaveProperty('access-control-allow-origin');
      expect(response.headers).toHaveProperty('access-control-allow-methods');
    });
  });

  describe('Health endpoint without OAuth', () => {
    let serverNoAuth: MCPStreamableHttpServer;
    let appNoAuth: Express;

    beforeEach(async () => {
      // Mock OAuth provider not available
      mockOAuthProviderFactory.createFromEnvironment.mockResolvedValue(null);

      serverNoAuth = new MCPStreamableHttpServer({
        port: 3022,
        host: 'localhost',
        endpoint: '/mcp',
        requireAuth: false,
        sessionSecret: 'test-secret',
        enableResumability: false,
        enableJsonResponse: false,
      });

      await serverNoAuth.initialize();
      appNoAuth = serverNoAuth.getApp();
    });

    afterEach(async () => {
      await serverNoAuth.stop();
    });

    it('should report disabled auth when OAuth is not configured', async () => {
      const response = await request(appNoAuth)
        .get('/health')
        .expect(200);

      expect(response.body.auth).toBe('disabled');
    });

    it('should still report LLM providers when OAuth is disabled', async () => {
      const response = await request(appNoAuth)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('llm_providers');
      expect(response.body.llm_providers).toHaveProperty('claude');
      expect(response.body.llm_providers).toHaveProperty('openai');
      expect(response.body.llm_providers).toHaveProperty('gemini');
    });

    it('should report correct feature flags when disabled', async () => {
      const response = await request(appNoAuth)
        .get('/health')
        .expect(200);

      expect(response.body.features.resumability).toBe(false);
      expect(response.body.features.jsonResponse).toBe(false);
    });
  });
});