/**
 * Integration tests for OAuth 2.0 Dynamic Client Registration (DCR) Endpoints
 * Tests RFC 7591 and RFC 7592 compliance
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

describe('OAuth 2.0 Dynamic Client Registration (DCR) Endpoints', () => {
  let server: MCPStreamableHttpServer;
  let app: Express;

  beforeEach(async () => {
    // Mock successful OAuth provider creation
    mockOAuthProviderFactory.createFromEnvironment.mockResolvedValue(mockProvider as any);

    // Create server instance with OAuth enabled
    server = new MCPStreamableHttpServer({
      port: 3010,
      host: 'localhost',
      endpoint: '/mcp',
      requireAuth: true,
      sessionSecret: 'test-secret-dcr',
      enableResumability: true,
      enableJsonResponse: true,
    });

    // Initialize server (includes DCR endpoints)
    await server.initialize();
    app = server.getApp();
  });

  afterEach(async () => {
    await server.stop();
    jest.clearAllMocks();
  });

  describe('POST /register - Client Registration (RFC 7591)', () => {
    it('should register a new client with valid metadata', async () => {
      const response = await request(app)
        .post('/register')
        .send({
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'Test Client',
          client_uri: 'https://example.com',
          logo_uri: 'https://example.com/logo.png',
          scope: 'openid profile email',
          contacts: ['admin@example.com'],
          tos_uri: 'https://example.com/tos',
          policy_uri: 'https://example.com/policy',
        })
        .expect(201)
        .expect('Content-Type', /application\/json/);

      // Verify RFC 7591 Section 3.2.1 response format
      expect(response.body).toMatchObject({
        client_id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i), // UUID v4
        client_secret: expect.any(String),
        client_id_issued_at: expect.any(Number),
        client_secret_expires_at: expect.any(Number),
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
        client_uri: 'https://example.com',
        logo_uri: 'https://example.com/logo.png',
        scope: 'openid profile email',
        contacts: ['admin@example.com'],
        tos_uri: 'https://example.com/tos',
        policy_uri: 'https://example.com/policy',
      });

      // Verify client_secret is base64url encoded (43 chars for 32 bytes)
      expect(response.body.client_secret).toHaveLength(43);

      // Verify timestamps are reasonable
      const now = Math.floor(Date.now() / 1000);
      expect(response.body.client_id_issued_at).toBeGreaterThan(now - 5);
      expect(response.body.client_id_issued_at).toBeLessThanOrEqual(now);
      expect(response.body.client_secret_expires_at).toBeGreaterThan(response.body.client_id_issued_at);
    });

    it('should register client with minimal required fields', async () => {
      const response = await request(app)
        .post('/register')
        .send({
          redirect_uris: ['http://localhost:3000/callback'],
        })
        .expect(201)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        client_id: expect.any(String),
        client_secret: expect.any(String),
        redirect_uris: ['http://localhost:3000/callback'],
        token_endpoint_auth_method: 'client_secret_post', // Default
        grant_types: ['authorization_code', 'refresh_token'], // Defaults
        response_types: ['code'], // Default
      });
    });

    it('should register client with multiple redirect URIs', async () => {
      const response = await request(app)
        .post('/register')
        .send({
          redirect_uris: [
            'http://localhost:3000/callback',
            'http://localhost:4000/callback',
            'https://app.example.com/oauth/callback',
          ],
          client_name: 'Multi-URI Client',
        })
        .expect(201);

      expect(response.body.redirect_uris).toHaveLength(3);
      expect(response.body.redirect_uris).toEqual([
        'http://localhost:3000/callback',
        'http://localhost:4000/callback',
        'https://app.example.com/oauth/callback',
      ]);
    });

    it('should return 400 when redirect_uris is missing', async () => {
      const response = await request(app)
        .post('/register')
        .send({
          client_name: 'Invalid Client',
        })
        .expect(400)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        error: 'invalid_client_metadata',
        error_description: expect.stringContaining('redirect_uris'),
      });
    });

    it('should return 400 when redirect_uris is empty array', async () => {
      const response = await request(app)
        .post('/register')
        .send({
          redirect_uris: [],
          client_name: 'Invalid Client',
        })
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'invalid_client_metadata',
        error_description: expect.stringContaining('non-empty array'),
      });
    });

    it('should return 400 when redirect_uris is not an array', async () => {
      const response = await request(app)
        .post('/register')
        .send({
          redirect_uris: 'http://localhost:3000/callback', // String instead of array
          client_name: 'Invalid Client',
        })
        .expect(400);

      expect(response.body.error).toBe('invalid_client_metadata');
    });

    it('should return 400 when redirect URI format is invalid', async () => {
      const response = await request(app)
        .post('/register')
        .send({
          redirect_uris: ['not-a-valid-url'],
          client_name: 'Invalid URI Client',
        })
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'invalid_redirect_uri',
        error_description: expect.stringContaining('not-a-valid-url'),
      });
    });

    it('should return 400 when one of multiple redirect URIs is invalid', async () => {
      const response = await request(app)
        .post('/register')
        .send({
          redirect_uris: [
            'http://localhost:3000/callback',
            'invalid-uri',
            'https://example.com/callback',
          ],
          client_name: 'Partially Invalid Client',
        })
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'invalid_redirect_uri',
        error_description: expect.stringContaining('invalid-uri'),
      });
    });

    it('should preserve all optional client metadata fields', async () => {
      const metadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Full Metadata Client',
        client_uri: 'https://example.com',
        logo_uri: 'https://example.com/logo.png',
        scope: 'openid profile email custom:scope',
        contacts: ['admin@example.com', 'support@example.com'],
        tos_uri: 'https://example.com/tos',
        policy_uri: 'https://example.com/policy',
        jwks_uri: 'https://example.com/jwks',
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['authorization_code'],
        response_types: ['code'],
      };

      const response = await request(app)
        .post('/register')
        .send(metadata)
        .expect(201);

      // All fields should be preserved
      expect(response.body.client_name).toBe(metadata.client_name);
      expect(response.body.client_uri).toBe(metadata.client_uri);
      expect(response.body.logo_uri).toBe(metadata.logo_uri);
      expect(response.body.scope).toBe(metadata.scope);
      expect(response.body.contacts).toEqual(metadata.contacts);
      expect(response.body.tos_uri).toBe(metadata.tos_uri);
      expect(response.body.policy_uri).toBe(metadata.policy_uri);
      expect(response.body.jwks_uri).toBe(metadata.jwks_uri);
      expect(response.body.token_endpoint_auth_method).toBe(metadata.token_endpoint_auth_method);
      expect(response.body.grant_types).toEqual(metadata.grant_types);
      expect(response.body.response_types).toEqual(metadata.response_types);
    });
  });

  describe('GET /register/:client_id - Read Client Configuration (RFC 7592)', () => {
    let registeredClientId: string;

    beforeEach(async () => {
      // Register a client for retrieval tests
      const response = await request(app)
        .post('/register')
        .send({
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'Test Retrieval Client',
        });
      registeredClientId = response.body.client_id;
    });

    it('should retrieve registered client configuration', async () => {
      const response = await request(app)
        .get(`/register/${registeredClientId}`)
        .expect(200)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        client_id: registeredClientId,
        client_secret: expect.any(String),
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Retrieval Client',
      });
    });

    it('should return 404 for non-existent client', async () => {
      const nonExistentId = '12345678-1234-4567-8901-123456789abc';
      const response = await request(app)
        .get(`/register/${nonExistentId}`)
        .expect(404)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        error: 'not_found',
        error_description: expect.stringContaining('not found'),
      });
    });

    it('should include all optional metadata in retrieval', async () => {
      // Register client with full metadata
      const registerResponse = await request(app)
        .post('/register')
        .send({
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'Full Metadata Client',
          client_uri: 'https://example.com',
          logo_uri: 'https://example.com/logo.png',
          scope: 'openid profile',
          contacts: ['admin@example.com'],
        });

      const clientId = registerResponse.body.client_id;

      // Retrieve and verify all fields are present
      const response = await request(app)
        .get(`/register/${clientId}`)
        .expect(200);

      expect(response.body.client_uri).toBe('https://example.com');
      expect(response.body.logo_uri).toBe('https://example.com/logo.png');
      expect(response.body.scope).toBe('openid profile');
      expect(response.body.contacts).toEqual(['admin@example.com']);
    });
  });

  describe('DELETE /register/:client_id - Delete Client (RFC 7592)', () => {
    let registeredClientId: string;

    beforeEach(async () => {
      // Register a client for deletion tests
      const response = await request(app)
        .post('/register')
        .send({
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'Test Deletion Client',
        });
      registeredClientId = response.body.client_id;
    });

    it('should delete registered client', async () => {
      await request(app)
        .delete(`/register/${registeredClientId}`)
        .expect(204);

      // Verify client is actually deleted
      await request(app)
        .get(`/register/${registeredClientId}`)
        .expect(404);
    });

    it('should return 404 when deleting non-existent client', async () => {
      const nonExistentId = '12345678-1234-4567-8901-123456789abc';
      const response = await request(app)
        .delete(`/register/${nonExistentId}`)
        .expect(404)
        .expect('Content-Type', /application\/json/);

      expect(response.body).toMatchObject({
        error: 'not_found',
        error_description: expect.stringContaining('not found'),
      });
    });

    it('should return 404 when deleting already deleted client', async () => {
      // Delete once
      await request(app)
        .delete(`/register/${registeredClientId}`)
        .expect(204);

      // Try to delete again
      await request(app)
        .delete(`/register/${registeredClientId}`)
        .expect(404);
    });
  });

  describe('Discovery Metadata Integration', () => {
    it('should include registration_endpoint in authorization server metadata', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      expect(response.body).toMatchObject({
        registration_endpoint: expect.stringContaining('/register'),
      });

      // Verify it's a full URL
      expect(response.body.registration_endpoint).toMatch(/^https?:\/\//);
    });

    it('should use correct base URL for registration_endpoint with forwarded headers', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .set('X-Forwarded-Proto', 'https')
        .set('X-Forwarded-Host', 'my-app.vercel.app')
        .expect(200);

      expect(response.body.registration_endpoint).toBe('https://my-app.vercel.app/register');
    });
  });

  describe('Full Client Lifecycle Integration', () => {
    it('should support complete client lifecycle: register → retrieve → delete', async () => {
      // 1. Register
      const registerResponse = await request(app)
        .post('/register')
        .send({
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'Lifecycle Test Client',
        })
        .expect(201);

      const clientId = registerResponse.body.client_id;
      const clientSecret = registerResponse.body.client_secret;

      // Verify client was created
      expect(clientId).toBeDefined();
      expect(clientSecret).toBeDefined();

      // 2. Retrieve
      const getResponse = await request(app)
        .get(`/register/${clientId}`)
        .expect(200);

      expect(getResponse.body.client_id).toBe(clientId);
      expect(getResponse.body.client_secret).toBe(clientSecret);

      // 3. Delete
      await request(app)
        .delete(`/register/${clientId}`)
        .expect(204);

      // 4. Verify deletion
      await request(app)
        .get(`/register/${clientId}`)
        .expect(404);
    });

    it('should handle multiple concurrent client registrations', async () => {
      const registrations = await Promise.all([
        request(app).post('/register').send({
          redirect_uris: ['http://localhost:3001/callback'],
          client_name: 'Concurrent Client 1',
        }),
        request(app).post('/register').send({
          redirect_uris: ['http://localhost:3002/callback'],
          client_name: 'Concurrent Client 2',
        }),
        request(app).post('/register').send({
          redirect_uris: ['http://localhost:3003/callback'],
          client_name: 'Concurrent Client 3',
        }),
      ]);

      // All should succeed
      registrations.forEach(response => {
        expect(response.status).toBe(201);
        expect(response.body.client_id).toBeDefined();
      });

      // All client IDs should be unique
      const clientIds = registrations.map(r => r.body.client_id);
      const uniqueIds = new Set(clientIds);
      expect(uniqueIds.size).toBe(3);

      // All should be retrievable
      for (const response of registrations) {
        await request(app)
          .get(`/register/${response.body.client_id}`)
          .expect(200);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON in registration request', async () => {
      // Express body-parser returns 500 for malformed JSON (internal parsing error)
      const response = await request(app)
        .post('/register')
        .set('Content-Type', 'application/json')
        .send('{"redirect_uris": [invalid json}')
        .expect(500);

      // Express error handler provides error response
      expect(response.body.error).toBeDefined();
    });

    it('should handle empty request body', async () => {
      const response = await request(app)
        .post('/register')
        .send({})
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'invalid_client_metadata',
        error_description: expect.stringContaining('redirect_uris'),
      });
    });
  });
});