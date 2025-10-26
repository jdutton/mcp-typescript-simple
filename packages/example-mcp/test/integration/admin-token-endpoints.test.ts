/**
 * Integration tests for Admin Token Management Endpoints
 */

import { vi } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import { MCPStreamableHttpServer } from '@mcp-typescript-simple/http-server';
import { preserveEnv } from '@mcp-typescript-simple/testing/env-helper';

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

describe('Admin Token Management Endpoints Integration', () => {
  let server: MCPStreamableHttpServer;
  let app: Express;
  let restoreEnv: () => void;

  beforeEach(async () => {
    restoreEnv = preserveEnv();

    // Enable dev mode for testing (no auth required for admin endpoints)
    process.env.MCP_DEV_SKIP_AUTH = 'true';

    // Set encryption key for token storage
    process.env.TOKEN_ENCRYPTION_KEY = 'Wp3suOcV+cleewUEOGUkE7JNgsnzwmiBMNqF7q9sQSI=';

    // Mock successful OAuth provider creation
    mocks.createFromEnvironment.mockResolvedValue(mocks.mockProvider as any);

    // Mock multi-provider creation (returns a Map with the google provider)
    const providersMap = new Map();
    providersMap.set('google', mocks.mockProvider);
    mocks.createAllFromEnvironment.mockResolvedValue(providersMap as any);

    // Create server instance
    server = new MCPStreamableHttpServer({
      port: 3022,
      host: 'localhost',
      endpoint: '/mcp',
      requireAuth: true,
      sessionSecret: 'test-secret',
      enableResumability: true,
      enableJsonResponse: true,
    });

    // Initialize server
    await server.initialize();
    app = server.getApp();

    // DEBUG: Check what token store type was created and try to call it
    // @ts-expect-error - accessing private property for debugging
    const tokenStore = server.tokenStore;
    console.log('[TEST] Token store type created:', {
      constructorName: tokenStore?.constructor?.name,
      hasCreateToken: typeof tokenStore?.createToken === 'function',
      isInMemoryTestTokenStore: tokenStore?.constructor?.name === 'InMemoryTestTokenStore',
    });

    // Try to create a token directly to see the exact error
    try {
      // @ts-expect-error - accessing private property for debugging
      const testToken = await server.tokenStore.createToken({
        description: 'Debug Test',
        expires_in: 3600,
        max_uses: 1,
      });
      console.log('[TEST] Direct createToken succeeded:', { tokenId: testToken.id });
    } catch (error) {
      console.error('[TEST] Direct createToken failed:', {
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });
    }
  });

  afterEach(async () => {
    await server.stop();
    vi.clearAllMocks();
    restoreEnv();
  });

  describe('POST /admin/tokens', () => {
    it('should create a new initial access token', async () => {
      const response = await request(app)
        .post('/admin/tokens')
        .send({
          description: 'Test Token',
          expires_in: 3600,
          max_uses: 10,
        });

      // DEBUG: Log the response
      if (response.status !== 201) {
        console.log('ERROR RESPONSE:', {
          status: response.status,
          body: response.body,
          text: response.text,
        });
      }

      expect(response.status).toBe(201);
      expect(response.headers['content-type']).toMatch(/application\/json/);

      expect(response.body).toMatchObject({
        id: expect.any(String),
        token: expect.any(String),
        description: 'Test Token',
        created_at: expect.any(Number),
        expires_at: expect.any(Number),
        max_uses: 10,
      });

      // Token should only be returned on creation
      expect(response.body.token).toBeDefined();
      expect(response.body.token.length).toBeGreaterThan(20);
    });

    it('should create token with default expiration and max_uses', async () => {
      const response = await request(app)
        .post('/admin/tokens')
        .send({
          description: 'Default Token',
        })
        .expect(201);

      expect(response.body).toMatchObject({
        id: expect.any(String),
        token: expect.any(String),
        description: 'Default Token',
        max_uses: null, // 0 serialized as null for unlimited
      });

      // Default expiration should be 30 days
      const now = Math.floor(Date.now() / 1000);
      const expectedExpiry = now + 2592000; // 30 days
      expect(response.body.expires_at).toBeGreaterThanOrEqual(expectedExpiry - 2);
      expect(response.body.expires_at).toBeLessThanOrEqual(expectedExpiry + 2);
    });

    it('should return 400 for missing description', async () => {
      const response = await request(app)
        .post('/admin/tokens')
        .send({})
        .expect(400)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        error: 'invalid_request',
        error_description: expect.stringContaining('description'),
      });
    });

    it('should return 400 for invalid description type', async () => {
      const response = await request(app)
        .post('/admin/tokens')
        .send({
          description: 123,
        })
        .expect(400);

      expect(response.body.error).toBe('invalid_request');
    });
  });

  describe('GET /admin/tokens', () => {
    beforeEach(async () => {
      // Create some test tokens
      await request(app).post('/admin/tokens').send({ description: 'Token 1' });
      await request(app).post('/admin/tokens').send({ description: 'Token 2' });
    });

    it('should list all tokens', async () => {
      const response = await request(app)
        .get('/admin/tokens')
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        tokens: expect.any(Array),
        count: expect.any(Number),
      });

      expect(response.body.tokens.length).toBeGreaterThanOrEqual(2);
      expect(response.body.count).toBeGreaterThanOrEqual(2);

      // Token values should not be included in list
      expect(response.body.tokens[0]).not.toHaveProperty('token');
    });

    it('should exclude revoked tokens by default', async () => {
      // Create and revoke a token
      const createResponse = await request(app)
        .post('/admin/tokens')
        .send({ description: 'To be revoked' });

      const tokenId = createResponse.body.id;
      await request(app).delete(`/admin/tokens/${tokenId}`);

      const listResponse = await request(app).get('/admin/tokens').expect(200);

      // Should not include the revoked token
      const revokedToken = listResponse.body.tokens.find((t: any) => t.id === tokenId);
      expect(revokedToken).toBeUndefined();
    });

    it('should include revoked tokens when requested', async () => {
      // Create and revoke a token
      const createResponse = await request(app)
        .post('/admin/tokens')
        .send({ description: 'To be revoked' });

      const tokenId = createResponse.body.id;
      await request(app).delete(`/admin/tokens/${tokenId}`);

      const listResponse = await request(app)
        .get('/admin/tokens?include_revoked=true')
        .expect(200);

      // Should include the revoked token
      const revokedToken = listResponse.body.tokens.find((t: any) => t.id === tokenId);
      expect(revokedToken).toBeDefined();
      expect(revokedToken.revoked).toBe(true);
    });
  });

  describe('GET /admin/tokens/:id', () => {
    it('should retrieve token details', async () => {
      // Create a token
      const createResponse = await request(app)
        .post('/admin/tokens')
        .send({ description: 'Test Token' });

      const tokenId = createResponse.body.id;

      const getResponse = await request(app)
        .get(`/admin/tokens/${tokenId}`)
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(getResponse.body).toMatchObject({
        id: tokenId,
        description: 'Test Token',
        created_at: expect.any(Number),
        expires_at: expect.any(Number),
        usage_count: 0,
        revoked: false,
      });

      // Token value should not be included
      expect(getResponse.body).not.toHaveProperty('token');
    });

    it('should return 404 for non-existent token', async () => {
      const response = await request(app)
        .get('/admin/tokens/non-existent-id')
        .expect(404)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        error: 'not_found',
        error_description: 'Token not found',
      });
    });

    it('should return list when no ID provided', async () => {
      // GET /admin/tokens/ without ID should list all tokens (same as GET /admin/tokens)
      const response = await request(app)
        .get('/admin/tokens/')
        .expect(200);

      expect(response.body.tokens).toBeDefined();
      expect(response.body.count).toBeDefined();
    });
  });

  describe('DELETE /admin/tokens/:id', () => {
    it('should revoke a token', async () => {
      // Create a token
      const createResponse = await request(app)
        .post('/admin/tokens')
        .send({ description: 'Test Token' });

      const tokenId = createResponse.body.id;

      const deleteResponse = await request(app)
        .delete(`/admin/tokens/${tokenId}`)
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(deleteResponse.body).toMatchObject({
        success: true,
        action: 'revoked',
      });

      // Verify token is revoked
      const getResponse = await request(app).get(`/admin/tokens/${tokenId}`);
      expect(getResponse.body.revoked).toBe(true);
    });

    it('should permanently delete a token when permanent=true', async () => {
      // Create a token
      const createResponse = await request(app)
        .post('/admin/tokens')
        .send({ description: 'Test Token' });

      const tokenId = createResponse.body.id;

      const deleteResponse = await request(app)
        .delete(`/admin/tokens/${tokenId}?permanent=true`)
        .expect(200);

      expect(deleteResponse.body).toMatchObject({
        success: true,
        action: 'deleted',
      });

      // Verify token is deleted (not just revoked)
      await request(app).get(`/admin/tokens/${tokenId}`).expect(404);
    });

    it('should return 404 for non-existent token', async () => {
      const response = await request(app)
        .delete('/admin/tokens/non-existent-id')
        .expect(404);

      expect(response.body.error).toBe('not_found');
    });

    it('should return 404 when no token ID provided', async () => {
      // DELETE /admin/tokens/ without ID should return 404 (route not found)
      await request(app).delete('/admin/tokens/').expect(404);

      // Express returns 404 for missing route parameter
    });
  });

  describe('POST /admin/tokens/cleanup', () => {
    it('should cleanup expired and revoked tokens', async () => {
      // Create an expired token
      await request(app)
        .post('/admin/tokens')
        .send({ description: 'Expired Token', expires_in: -1 });

      // Create and revoke a token
      const revokedResponse = await request(app)
        .post('/admin/tokens')
        .send({ description: 'Revoked Token' });
      await request(app).delete(`/admin/tokens/${revokedResponse.body.id}`);

      // Create an active token
      await request(app)
        .post('/admin/tokens')
        .send({ description: 'Active Token' });

      const cleanupResponse = await request(app)
        .post('/admin/tokens/cleanup')
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(cleanupResponse.body).toMatchObject({
        success: true,
        cleaned_count: expect.any(Number),
      });

      // Should have cleaned up at least 2 tokens (expired + revoked)
      expect(cleanupResponse.body.cleaned_count).toBeGreaterThanOrEqual(2);
    });

    it('should not remove active tokens', async () => {
      // Create active tokens
      await request(app).post('/admin/tokens').send({ description: 'Active 1' });
      await request(app).post('/admin/tokens').send({ description: 'Active 2' });

      const cleanupResponse = await request(app).post('/admin/tokens/cleanup').expect(200);

      expect(cleanupResponse.body.cleaned_count).toBe(0);

      // Verify tokens still exist
      const listResponse = await request(app).get('/admin/tokens');
      expect(listResponse.body.count).toBeGreaterThanOrEqual(2);
    });
  });

  describe('POST /admin/register', () => {
    it('should register a client with initial access token', async () => {
      // Create an initial access token
      const tokenResponse = await request(app)
        .post('/admin/tokens')
        .send({ description: 'DCR Token' });

      const accessToken = tokenResponse.body.token;

      const registerResponse = await request(app)
        .post('/admin/register')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          client_name: 'Test Client',
          redirect_uris: ['http://localhost:3000/callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        })
        .expect(201)
        .expect('Content-Type', /application\/json/);

      expect(registerResponse.body).toMatchObject({
        client_id: expect.any(String),
        client_secret: expect.any(String),
        client_name: 'Test Client',
        redirect_uris: ['http://localhost:3000/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
      });

      // Should have extended expiration (1 year)
      expect(registerResponse.body.client_secret_expires_at).toBeDefined();
    });

    it('should return 401 for missing Authorization header', async () => {
      const response = await request(app)
        .post('/admin/register')
        .send({
          client_name: 'Test Client',
          redirect_uris: ['http://localhost:3000/callback'],
        })
        .expect(401);

      expect(response.body.error).toBe('invalid_token');
    });

    it('should return 401 for invalid token', async () => {
      const response = await request(app)
        .post('/admin/register')
        .set('Authorization', 'Bearer invalid-token')
        .send({
          client_name: 'Test Client',
          redirect_uris: ['http://localhost:3000/callback'],
        })
        .expect(401);

      expect(response.body.error).toBe('invalid_token');
    });

    it('should return 400 for missing redirect_uris', async () => {
      // Create an initial access token
      const tokenResponse = await request(app)
        .post('/admin/tokens')
        .send({ description: 'DCR Token' });

      const accessToken = tokenResponse.body.token;

      const response = await request(app)
        .post('/admin/register')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          client_name: 'Test Client',
        })
        .expect(400);

      expect(response.body.error).toBe('invalid_client_metadata');
    });

    it('should return 400 for invalid redirect URI', async () => {
      // Create an initial access token
      const tokenResponse = await request(app)
        .post('/admin/tokens')
        .send({ description: 'DCR Token' });

      const accessToken = tokenResponse.body.token;

      const response = await request(app)
        .post('/admin/register')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          client_name: 'Test Client',
          redirect_uris: ['not-a-valid-uri'],
        })
        .expect(400);

      expect(response.body.error).toBe('invalid_redirect_uri');
    });

    it('should increment token usage count', async () => {
      // Create an initial access token
      const tokenResponse = await request(app)
        .post('/admin/tokens')
        .send({ description: 'DCR Token' });

      const accessToken = tokenResponse.body.token;
      const tokenId = tokenResponse.body.id;

      // Use the token to register a client
      await request(app)
        .post('/admin/register')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          client_name: 'Test Client',
          redirect_uris: ['http://localhost:3000/callback'],
        })
        .expect(201);

      // Check token usage count
      const getResponse = await request(app).get(`/admin/tokens/${tokenId}`);
      expect(getResponse.body.usage_count).toBe(1);
      expect(getResponse.body.last_used_at).toBeDefined();
    });

    it('should reject token after max_uses exceeded', async () => {
      // Create an initial access token with max_uses=1
      const tokenResponse = await request(app)
        .post('/admin/tokens')
        .send({ description: 'DCR Token', max_uses: 1 });

      const accessToken = tokenResponse.body.token;

      // Use the token once
      await request(app)
        .post('/admin/register')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          client_name: 'Test Client 1',
          redirect_uris: ['http://localhost:3000/callback'],
        })
        .expect(201);

      // Try to use it again - should fail
      const response = await request(app)
        .post('/admin/register')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          client_name: 'Test Client 2',
          redirect_uris: ['http://localhost:3000/callback'],
        })
        .expect(401);

      expect(response.body.error).toBe('invalid_token');
    });
  });
});