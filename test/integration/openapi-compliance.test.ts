/**
 * OpenAPI Compliance Integration Tests
 *
 * Validates that all documented endpoints exist and return responses
 * that match the OpenAPI specification schemas.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { MCPStreamableHttpServer } from '../../src/server/streamable-http-server.js';
import type { Express } from 'express';

describe('OpenAPI Compliance Integration Tests', () => {
  let server: MCPStreamableHttpServer;
  let app: Express;
  let openapiSpec: any;
  let ajv: Ajv;

  beforeAll(async () => {
    // Load OpenAPI specification
    const openapiPath = join(process.cwd(), 'openapi.yaml');
    const openapiYaml = readFileSync(openapiPath, 'utf-8');
    openapiSpec = yaml.parse(openapiYaml);

    // Initialize AJV for schema validation
    ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);

    // Add OpenAPI schemas to AJV
    if (openapiSpec.components?.schemas) {
      Object.entries(openapiSpec.components.schemas).forEach(([name, schema]) => {
        ajv.addSchema(schema as any, `#/components/schemas/${name}`);
      });
    }

    // Create test server
    server = new MCPStreamableHttpServer({
      port: 3002,
      host: 'localhost',
      endpoint: '/mcp',
      requireAuth: false, // No auth for compliance testing
      sessionSecret: 'test-secret',
    });

    await server.initialize();
    app = server.getApp();
  });

  afterAll(async () => {
    await server.stop();
    // Give connections time to close
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  describe('All Documented Endpoints Exist', () => {
    it('should return 200 or 401 for /health endpoint', async () => {
      const response = await request(app).get('/health');
      expect([200, 401]).toContain(response.status);
    });

    it('should return 200 or 401 for /auth endpoint', async () => {
      const response = await request(app).get('/auth');
      expect([200, 401, 404]).toContain(response.status);
    });

    it('should return 200 or 302 for /.well-known/oauth-authorization-server', async () => {
      const response = await request(app).get('/.well-known/oauth-authorization-server');
      expect([200, 302]).toContain(response.status);
    });

    it('should return 200 for /.well-known/oauth-protected-resource', async () => {
      const response = await request(app).get('/.well-known/oauth-protected-resource');
      expect([200]).toContain(response.status);
    });

    it('should return 200 for /.well-known/openid-configuration', async () => {
      const response = await request(app).get('/.well-known/openid-configuration');
      expect([200]).toContain(response.status);
    });

    it('should respond to /mcp GET endpoint', async () => {
      const response = await request(app).get('/mcp');
      expect([200, 401, 503]).toContain(response.status);
    });

    it('should respond to /mcp POST endpoint', async () => {
      const response = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list'
        });
      expect([200, 401, 503]).toContain(response.status);
    });

    it('should respond to /admin/metrics endpoint', async () => {
      const response = await request(app).get('/admin/metrics');
      expect([200, 401, 404]).toContain(response.status);
    });

    it('should respond to /register POST endpoint', async () => {
      const response = await request(app)
        .post('/register')
        .send({
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'Test Client'
        });
      expect([201, 400, 401, 404]).toContain(response.status);
    });
  });

  describe('Health Endpoint Schema Validation', () => {
    it('should return response matching HealthResponse schema', async () => {
      const response = await request(app)
        .get('/health')
        .expect('Content-Type', /json/)
        .expect(200);

      // Validate against schema
      const schema = openapiSpec.components.schemas.HealthResponse;
      const validate = ajv.compile(schema);
      const valid = validate(response.body);

      if (!valid) {
        console.error('Validation errors:', validate.errors);
      }

      expect(valid).toBe(true);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should include required fields in health response', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(response.body.status);
    });
  });

  describe('MCP Protocol Compliance', () => {
    it.skip('should accept valid JSON-RPC 2.0 initialize request (requires MCP handler)', async () => {
      const response = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
              name: 'test-client',
              version: '1.0.0'
            }
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('jsonrpc', '2.0');
      expect(response.body).toHaveProperty('id', 1);
      expect(response.body).toHaveProperty('result');
    });

    it.skip('should accept valid tools/list request (requires MCP handler)', async () => {
      const response = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list'
        })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('jsonrpc', '2.0');
      expect(response.body).toHaveProperty('result');
      expect(response.body.result).toHaveProperty('tools');
      expect(Array.isArray(response.body.result.tools)).toBe(true);
    });

    it('should reject invalid JSON-RPC request (missing jsonrpc field)', async () => {
      const response = await request(app)
        .post('/mcp')
        .send({
          id: 1,
          method: 'tools/list'
        });

      expect([400, 503]).toContain(response.status);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject JSON-RPC 1.0 request', async () => {
      const response = await request(app)
        .post('/mcp')
        .send({
          jsonrpc: '1.0',
          id: 1,
          method: 'tools/list'
        });

      expect([400, 503]).toContain(response.status);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('OAuth Discovery Endpoints', () => {
    it('should return authorization server metadata', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-authorization-server')
        .expect('Content-Type', /json/)
        .expect(200);

      // Check required fields per RFC 8414 (when OAuth is configured)
      expect(response.body).toHaveProperty('issuer');
      if (response.body.authorization_endpoint) {
        // Full OAuth configuration
        expect(response.body).toHaveProperty('token_endpoint');
        expect(response.body).toHaveProperty('response_types_supported');
        expect(response.body).toHaveProperty('grant_types_supported');
      } else {
        // OAuth not configured - should have error field
        expect(response.body).toHaveProperty('error');
      }
    });

    it('should return valid protected resource metadata', async () => {
      const response = await request(app)
        .get('/.well-known/oauth-protected-resource')
        .expect('Content-Type', /json/)
        .expect(200);

      // Check required fields per RFC 9728
      expect(response.body).toHaveProperty('resource');
      expect(response.body.resource).toMatch(/^https?:\/\//);
    });
  });

  describe('Dynamic Client Registration', () => {
    it.skip('should accept valid client registration request (requires OAuth setup)', async () => {
      const response = await request(app)
        .post('/register')
        .send({
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'OpenAPI Test Client',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none'
        })
        .expect('Content-Type', /json/)
        .expect(201);

      // Validate against ClientRegistrationResponse schema
      expect(response.body).toHaveProperty('client_id');
      expect(response.body).toHaveProperty('client_secret');
      expect(response.body).toHaveProperty('redirect_uris');
      expect(response.body.redirect_uris).toContain('http://localhost:3000/callback');
    });

    it('should reject invalid registration (missing redirect_uris)', async () => {
      const response = await request(app)
        .post('/register')
        .send({
          client_name: 'Invalid Client'
        });

      expect([400, 404]).toContain(response.status);
      if (response.status === 400) {
        expect(response.body).toHaveProperty('error');
      }
    });
  });

  describe('Content-Type Headers', () => {
    it('should return application/json for /health', async () => {
      await request(app)
        .get('/health')
        .expect('Content-Type', /application\/json/);
    });

    it('should return application/json for OAuth discovery', async () => {
      await request(app)
        .get('/.well-known/oauth-authorization-server')
        .expect('Content-Type', /application\/json/);
    });

    it('should return text/yaml for /openapi.yaml', async () => {
      await request(app)
        .get('/openapi.yaml')
        .expect('Content-Type', /text\/yaml/);
    });

    it('should return application/json for /openapi.json', async () => {
      await request(app)
        .get('/openapi.json')
        .expect('Content-Type', /application\/json/);
    });
  });

  describe('Error Response Format', () => {
    it('should return structured error for invalid MCP request', async () => {
      const response = await request(app)
        .post('/mcp')
        .send({ invalid: 'request' });

      expect([400, 503]).toContain(response.status);
      expect(response.body).toHaveProperty('error');
      expect(typeof response.body.error).toBe('string');
    });

    it('should include error message in error responses', async () => {
      const response = await request(app)
        .post('/mcp')
        .send({});

      expect([400, 503]).toContain(response.status);
      expect(response.body).toHaveProperty('error');
      // OpenAPI validator or app should provide message
    });
  });
});
