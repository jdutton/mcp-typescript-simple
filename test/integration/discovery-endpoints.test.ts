/**
 * Integration tests for OAuth Discovery Endpoints
 */

import request from 'supertest';
import { Express } from 'express';
import { MCPStreamableHttpServer } from '../../src/server/streamable-http-server.js';

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
vi.mock('../../src/auth/factory.js', () => ({
  OAuthProviderFactory: {
    createFromEnvironment: mocks.createFromEnvironment,
    createAllFromEnvironment: mocks.createAllFromEnvironment,
  },
}));

describe('OAuth Discovery Endpoints Integration', () => {
  let server: MCPStreamableHttpServer;
  let app: Express;

  beforeEach(async () => {
    // Mock successful OAuth provider creation
    mocks.createFromEnvironment.mockResolvedValue(mocks.mockProvider as any);

    // Mock multi-provider creation (returns a Map with the google provider)
    const providersMap = new Map();
    providersMap.set('google', mocks.mockProvider);
    mocks.createAllFromEnvironment.mockResolvedValue(providersMap as any);

    // Create server instance
    server = new MCPStreamableHttpServer({
      port: 3001,
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
    vi.clearAllMocks();
  });

  describe('/.well-known/oauth-authorization-server', () => {
    it('should return valid authorization server metadata when OAuth is configured', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        issuer: expect.stringMatching(/^https?:\/\//),
        authorization_endpoint: expect.stringContaining('/authorize'), // Generic endpoint for MCP Inspector compatibility
        token_endpoint: expect.stringContaining('/token'), // Generic endpoint for MCP Inspector compatibility
        token_endpoint_auth_methods_supported: expect.arrayContaining(['client_secret_post']),
        response_types_supported: expect.arrayContaining(['code']),
        grant_types_supported: expect.arrayContaining(['authorization_code', 'refresh_token']),
        scopes_supported: expect.arrayContaining(['openid', 'profile', 'email']),
        code_challenge_methods_supported: expect.arrayContaining(['S256']),
      });

      // Note: service_documentation is not included in generic multi-provider metadata
      // It's only available in provider-specific metadata
      expect(response.body.registration_endpoint).toContain('/register'); // Generic DCR registration endpoint
    });

    it('should return error metadata when OAuth is not configured', async () => {
      // Mock OAuth provider not available - clear providers map
      mocks.createAllFromEnvironment.mockResolvedValue(new Map());

      const serverNoAuth = new MCPStreamableHttpServer({
        port: 3002,
        host: 'localhost',
        endpoint: '/mcp',
        requireAuth: false,
        sessionSecret: 'test-secret',
      });

      await serverNoAuth.initialize();
      const appNoAuth = serverNoAuth.getApp();

      const response = await request(appNoAuth)
        .get('/.well-known/oauth-authorization-server')
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        error: 'OAuth not configured',
        message: expect.stringContaining('OAuth provider not available'),
        issuer: expect.stringMatching(/^https?:\/\//),
        configuration_endpoint: expect.stringContaining('/.well-known/oauth-authorization-server'),
      });

      await serverNoAuth.stop();
    });
  });

  describe('/.well-known/oauth-protected-resource', () => {
    it('should return valid protected resource metadata when OAuth is configured', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        resource: expect.stringMatching(/^https?:\/\//),
        authorization_servers: expect.arrayContaining([expect.stringMatching(/^https?:\/\//)]),
        resource_documentation: expect.stringContaining('/docs'),
        bearer_methods_supported: expect.arrayContaining(['header', 'body']),
        authorization_data_types_supported: expect.arrayContaining([
          'application/json',
          'application/x-www-form-urlencoded'
        ]),
      });
    });

    it('should return minimal metadata when OAuth is not configured', async () => {
      // Mock OAuth provider not available - clear providers map
      mocks.createAllFromEnvironment.mockResolvedValue(new Map());

      const serverNoAuth = new MCPStreamableHttpServer({
        port: 3003,
        host: 'localhost',
        endpoint: '/mcp',
        requireAuth: false,
        sessionSecret: 'test-secret',
      });

      await serverNoAuth.initialize();
      const appNoAuth = serverNoAuth.getApp();

      const response = await request(appNoAuth)
        .get('/.well-known/oauth-protected-resource')
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        resource: expect.stringMatching(/^https?:\/\//),
        authorization_servers: [],
        bearer_methods_supported: ['header'],
        message: 'OAuth provider not configured',
      });

      await serverNoAuth.stop();
    });
  });

  describe('/.well-known/oauth-protected-resource/mcp', () => {
    it('should return MCP-specific metadata when OAuth is configured', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource/mcp')
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        resource: expect.stringMatching(/^https?:\/\//),
        authorization_servers: expect.arrayContaining([expect.stringMatching(/^https?:\/\//)]),
        mcp_version: '1.18.0',
        transport_capabilities: expect.arrayContaining(['stdio', 'streamable_http']),
        tool_discovery_endpoint: expect.stringContaining('/mcp'),
        supported_tool_types: expect.arrayContaining(['function', 'text_generation', 'analysis']),
        session_management: {
          resumability_supported: true, // We enabled resumability in the test server
        },
      });
    });

    it('should return MCP metadata even when OAuth is not configured', async () => {
      // Mock OAuth provider not available - clear providers map
      mocks.createAllFromEnvironment.mockResolvedValue(new Map());

      const serverNoAuth = new MCPStreamableHttpServer({
        port: 3004,
        host: 'localhost',
        endpoint: '/mcp',
        requireAuth: false,
        sessionSecret: 'test-secret',
        enableResumability: false,
      });

      await serverNoAuth.initialize();
      const appNoAuth = serverNoAuth.getApp();

      const response = await request(appNoAuth)
        .get('/.well-known/oauth-protected-resource/mcp')
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        resource: expect.stringMatching(/^https?:\/\//),
        authorization_servers: [],
        mcp_version: '1.18.0',
        transport_capabilities: expect.arrayContaining(['stdio', 'streamable_http']),
        session_management: {
          resumability_supported: false,
        },
        message: 'OAuth provider not configured',
      });

      await serverNoAuth.stop();
    });
  });

  describe('/.well-known/openid-configuration', () => {
    it('should return OpenID Connect configuration when OAuth is configured', async () => {
      const response = await request(app)
        .get('/.well-known/openid-configuration')
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        issuer: expect.stringMatching(/^https?:\/\//),
        authorization_endpoint: expect.stringContaining('/authorize'), // Generic endpoint
        token_endpoint: expect.stringContaining('/token'), // Generic endpoint
        subject_types_supported: expect.arrayContaining(['public']),
        id_token_signing_alg_values_supported: expect.arrayContaining(['RS256']),
        claims_supported: expect.arrayContaining(['sub', 'email', 'name']),
        ui_locales_supported: expect.arrayContaining(['en-US']),
      });

      expect(response.body.jwks_uri).toBe('https://www.googleapis.com/oauth2/v3/certs');
    });

    it('should return minimal OpenID Connect configuration when OAuth is not configured', async () => {
      // Mock OAuth provider not available - clear providers map
      mocks.createAllFromEnvironment.mockResolvedValue(new Map());

      const serverNoAuth = new MCPStreamableHttpServer({
        port: 3005,
        host: 'localhost',
        endpoint: '/mcp',
        requireAuth: false,
        sessionSecret: 'test-secret',
      });

      await serverNoAuth.initialize();
      const appNoAuth = serverNoAuth.getApp();

      const response = await request(appNoAuth)
        .get('/.well-known/openid-configuration')
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        issuer: expect.stringMatching(/^https?:\/\//),
        authorization_endpoint: expect.stringContaining('/auth/login'),
        token_endpoint: expect.stringContaining('/auth/token'),
        response_types_supported: expect.arrayContaining(['code']),
        subject_types_supported: expect.arrayContaining(['public']),
        message: 'OAuth provider not configured',
      });

      await serverNoAuth.stop();
    });
  });

  describe('Base URL detection', () => {
    it('should handle forwarded headers correctly', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .set('X-Forwarded-Proto', 'https')
        .set('X-Forwarded-Host', 'my-app.vercel.app')
        .expect(200);

      expect(response.body.issuer).toBe('https://my-app.vercel.app');
      expect(response.body.authorization_endpoint).toContain('https://my-app.vercel.app');
    });

    it('should fall back to host header when forwarded headers are not present', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .set('Host', 'localhost:3001')
        .expect(200);

      expect(response.body.issuer).toMatch(/^http:\/\/localhost:3001/);
    });
  });


  describe('Unknown discovery endpoints', () => {
    it('should return 404 for unknown discovery paths', async () => {
      const response = await request(app)
        .get('/.well-known/unknown-endpoint')
        .expect(404)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        error: expect.stringContaining('not found'),
        message: expect.stringContaining('unknown-endpoint'),
      });
    });
  });
});