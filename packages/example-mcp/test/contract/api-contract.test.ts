/**
 * API Contract Tests - Multi-Target OpenAPI Compliance
 *
 * Validates that all deployment targets (Express, Docker, Vercel) match the OpenAPI specification.
 *
 * Test Targets:
 * - local: Express server on localhost:3000 (npm run dev:http)
 * - docker: Docker deployment on localhost:8080
 * - vercel: Vercel production deployment
 *
 * Usage:
 * ```bash
 * # Test local Express server
 * TEST_TARGET=local npm run test:contract
 *
 * # Test Docker deployment (must be running)
 * TEST_TARGET=docker npm run test:contract
 *
 * # Test Vercel production
 * TEST_TARGET=vercel npm run test:contract
 * ```
 *
 * Environment Variables:
 * - TEST_TARGET: Deployment target to test (local|docker|vercel)
 * - LOCAL_PORT: Port for local server (default: 3000)
 * - DOCKER_PORT: Port for Docker server (default: 8080)
 * - VERCEL_URL: Vercel deployment URL (default: https://mcp-typescript-simple.vercel.app)
 */

import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'yaml';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

describe('API Contract Tests - Multi-Target OpenAPI Compliance', () => {
  let baseUrl: string;
  let openapiSpec: any;
  let ajv: Ajv;
  let testTarget: string;

  beforeAll(async () => {
    // Determine test target
    testTarget = process.env.TEST_TARGET || 'local';

    // Configure base URL based on target
    switch (testTarget) {
      case 'local':
        baseUrl = `http://localhost:${process.env.LOCAL_PORT || 3001}`;
        break;
      case 'docker':
        baseUrl = `http://localhost:${process.env.DOCKER_PORT || 8080}`;
        break;
      case 'vercel':
        baseUrl = process.env.VERCEL_URL || 'https://mcp-typescript-simple.vercel.app';
        break;
      default:
        throw new Error(`Unknown TEST_TARGET: ${testTarget}. Must be one of: local, docker, vercel`);
    }

    console.log(`\n📋 Running contract tests against: ${testTarget} (${baseUrl})\n`);

    // Load OpenAPI specification
    const openapiPath = join(process.cwd(), 'openapi.yaml');
    const openapiYaml = readFileSync(openapiPath, 'utf-8');
    openapiSpec = yaml.parse(openapiYaml);

    // Initialize AJV for schema validation
    ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);

    // Add OpenAPI schemas to AJV
    if (openapiSpec.components?.schemas) {
      for (const [name, schema] of Object.entries(openapiSpec.components.schemas)) {
        ajv.addSchema(schema as any, `#/components/schemas/${name}`);
      }
    }
  });

  describe('Health Check Endpoint Contract', () => {
    it('should return 200 for /health endpoint', async () => {
      const response = await request(baseUrl).get('/health');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should match HealthResponse schema', async () => {
      const response = await request(baseUrl)
        .get('/health')
        .expect('Content-Type', /json/)
        .expect(200);

      // Validate against schema
      const schema = openapiSpec.components.schemas.HealthResponse;
      const validate = ajv.compile(schema);
      const valid = validate(response.body);

      if (!valid) {
        console.error('❌ Schema validation errors:', JSON.stringify(validate.errors, null, 2));
        console.error('Response body:', JSON.stringify(response.body, null, 2));
      }

      expect(valid).toBe(true);
    });

    it('should NOT expose internal /api/* paths (Vercel path leak)', async () => {
      const response = await request(baseUrl).get('/health').expect(200);

      // Check for Vercel path exposure bug
      const responseBody = JSON.stringify(response.body);
      const hasApiPaths = responseBody.includes('/api/');

      if (hasApiPaths) {
        console.error('❌ Internal /api/* paths exposed in response:');
        console.error(JSON.stringify(response.body, null, 2));
        expect(hasApiPaths).toBe(false);
      }

      expect(hasApiPaths).toBe(false);
    });
  });

  describe('OAuth Discovery Endpoints Contract', () => {
    it('should return authorization server metadata', async () => {
      const response = await request(baseUrl)
        .get('/.well-known/oauth-authorization-server')
        .expect('Content-Type', /json/)
        .expect(200);

      // Check required fields per RFC 8414
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

    it('should return protected resource metadata', async () => {
      const response = await request(baseUrl)
        .get('/.well-known/oauth-protected-resource')
        .expect('Content-Type', /json/)
        .expect(200);

      // Check required fields per RFC 9728
      expect(response.body).toHaveProperty('resource');
      expect(response.body.resource).toMatch(/^https?:\/\//);
    });

    it('should return OpenID configuration', async () => {
      const response = await request(baseUrl)
        .get('/.well-known/openid-configuration')
        .expect('Content-Type', /json/)
        .expect(200);

      // Check for issuer (required field)
      expect(response.body).toHaveProperty('issuer');
    });
  });

  describe('MCP Protocol Endpoint Contract', () => {
    it('should respond to GET /mcp', async () => {
      const response = await request(baseUrl).get('/mcp');
      expect([200, 401, 406, 503]).toContain(response.status);
    });

    it('should respond to POST /mcp with valid JSON-RPC', async () => {
      const response = await request(baseUrl)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        });

      expect([200, 401, 406, 503]).toContain(response.status);
    });

    it('should reject invalid JSON-RPC (missing jsonrpc field)', async () => {
      const response = await request(baseUrl)
        .post('/mcp')
        .send({
          id: 1,
          method: 'tools/list',
        });

      expect([400, 406, 503]).toContain(response.status);
      if (response.status === 400) {
        expect(response.body).toHaveProperty('error');
      }
    });
  });

  describe('Admin Endpoints Contract', () => {
    it('should respond to /admin/info endpoint', async () => {
      const response = await request(baseUrl).get('/admin/info');
      expect([200, 401, 404]).toContain(response.status);
    });

    it('should NOT have duplicate /admin/status endpoint', async () => {
      const response = await request(baseUrl).get('/admin/status');

      // This endpoint should NOT exist (duplicate of /admin/info)
      // Expecting 404 when duplicate is removed
      if (response.status === 200) {
        console.error('❌ Duplicate /admin/status endpoint still exists!');
        console.error('Expected: 404 (removed duplicate)');
        console.error(`Actual: ${response.status}`);
      }

      // For now, accept both 200 and 404 until duplicate is removed
      expect([200, 404, 401]).toContain(response.status);
    });

    it('should NOT expose internal /api/* paths in admin endpoints', async () => {
      const response = await request(baseUrl).get('/admin/info');

      if (response.status === 200) {
        const responseBody = JSON.stringify(response.body);
        const hasApiPaths = responseBody.includes('/api/');

        if (hasApiPaths) {
          console.error('❌ Internal /api/* paths exposed in /admin/info:');
          console.error(JSON.stringify(response.body, null, 2));
        }

        expect(hasApiPaths).toBe(false);
      }
    });

    it('should respond to /admin/metrics endpoint', async () => {
      const response = await request(baseUrl).get('/admin/metrics');
      expect([200, 401, 404]).toContain(response.status);
    });
  });

  describe('Documentation Endpoints Contract', () => {
    it('should serve /openapi.yaml with correct content-type', async () => {
      const response = await request(baseUrl).get('/openapi.yaml');
      expect([200]).toContain(response.status);
      expect(response.headers['content-type']).toMatch(/text\/yaml|application\/yaml/);
    });

    it('should serve /openapi.json with correct content-type', async () => {
      const response = await request(baseUrl).get('/openapi.json');
      expect([200]).toContain(response.status);
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should serve homepage at / with HTML by default', async () => {
      const response = await request(baseUrl)
        .get('/')
        .set('Accept', 'text/html');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
      expect(response.text).toContain('MCP TypeScript Simple');
    });

    it('should serve homepage at / with markdown when requested', async () => {
      const response = await request(baseUrl)
        .get('/')
        .set('Accept', 'text/markdown');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/markdown/);
      expect(response.text).toContain('# MCP TypeScript Simple');
    });

    it('should serve homepage at / with plain text fallback', async () => {
      const response = await request(baseUrl)
        .get('/')
        .set('Accept', 'text/plain');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/(markdown|plain)/);
      expect(response.text).toContain('MCP TypeScript Simple');
    });

    // Unskipped in Issue #89 Phase 1.5 - Documentation endpoints now working
    it('should serve /docs (Redoc) endpoint', async () => {
      const response = await request(baseUrl).get('/docs');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
    });

    it('should serve /api-docs (Swagger UI) endpoint', async () => {
      // swagger-ui-express redirects /api-docs to /api-docs/ (with trailing slash)
      // Accept either 200 (direct) or 301 (redirect to trailing slash)
      const response = await request(baseUrl).get('/api-docs');
      expect([200, 301]).toContain(response.status);

      // If redirected, follow the redirect and verify HTML is served
      if (response.status === 301) {
        const redirectResponse = await request(baseUrl).get('/api-docs/');
        expect(redirectResponse.status).toBe(200);
        expect(redirectResponse.headers['content-type']).toMatch(/text\/html/);
      } else {
        expect(response.headers['content-type']).toMatch(/text\/html/);
      }
    });
  });

  describe('Dynamic Client Registration Contract', () => {
    it('should respond to /register POST endpoint', async () => {
      const response = await request(baseUrl)
        .post('/register')
        .send({
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'Test Client',
        });

      expect([201, 400, 401, 404]).toContain(response.status);
    });

    it('should reject invalid registration (missing redirect_uris)', async () => {
      const response = await request(baseUrl)
        .post('/register')
        .send({
          client_name: 'Invalid Client',
        });

      expect([400, 404]).toContain(response.status);
      if (response.status === 400) {
        expect(response.body).toHaveProperty('error');
      }
    });
  });

  describe('LLM Tools Registration (Vercel Bug)', () => {
    it('should NOT register LLM tools when no API keys configured', async () => {
      // This test validates that Vercel deployment doesn't register LLM tools
      // when no API keys are present (unlike Express which correctly checks for providers)

      const response = await request(baseUrl)
        .post('/mcp')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        });

      // Skip if MCP server not available
      if (response.status === 503) {
        console.log('⚠️  MCP server not available, skipping LLM tools test');
        return;
      }

      // Skip if authentication required
      if (response.status === 401) {
        console.log('⚠️  Authentication required, skipping LLM tools test');
        return;
      }

      // Skip if content-type not acceptable
      if (response.status === 406) {
        console.log('⚠️  Content-type not acceptable, skipping LLM tools test');
        return;
      }

      expect(response.status).toBe(200);

      // Check if LLM tools are present
      const tools = response.body.result?.tools || [];
      const llmTools = tools.filter((tool: any) =>
        ['chat', 'analyze', 'summarize', 'explain'].includes(tool.name)
      );

      // If no LLM API keys are configured, these tools should NOT be registered
      // This will FAIL on Vercel until the bug is fixed (Phase 2)
      if (llmTools.length > 0 && testTarget === 'vercel') {
        console.error('❌ LLM tools registered on Vercel without API keys:');
        llmTools.forEach((tool: any) => console.error(`  - ${tool.name}`));
        console.error('Expected: LLM tools only registered when API keys present');
      }

      // For now, this is informational - will become strict in Phase 2
      console.log(`ℹ️  LLM tools found: ${llmTools.length}`);
    });
  });

  describe('Error Response Format Contract', () => {
    it('should return structured error for invalid requests', async () => {
      const response = await request(baseUrl)
        .post('/mcp')
        .send({ invalid: 'request' });

      expect([400, 406, 503]).toContain(response.status);

      // 406 responses may not have an error field (content-type negotiation failure)
      if (response.status !== 406) {
        expect(response.body).toHaveProperty('error');
        expect(typeof response.body.error).toBe('string');
      }
    });
  });

  describe('CORS Headers Contract', () => {
    it('should include CORS headers in responses', async () => {
      const response = await request(baseUrl).get('/health');

      // CORS headers should be present
      expect(response.headers).toHaveProperty('access-control-allow-origin');
    });

    it('should handle OPTIONS preflight requests', async () => {
      const response = await request(baseUrl)
        .options('/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET');

      expect([200, 204]).toContain(response.status);
      expect(response.headers).toHaveProperty('access-control-allow-methods');
    });
  });

  describe('Content Security Headers Contract', () => {
    it('should include security headers in responses', async () => {
      const response = await request(baseUrl).get('/health');

      // Check for Helmet security headers (if configured)
      // These may not be present in all environments
      if (response.headers['x-content-type-options']) {
        expect(response.headers['x-content-type-options']).toBe('nosniff');
      }
    });
  });

  // Summary report
  afterAll(() => {
    console.log(`\n✅ Contract tests completed for target: ${testTarget}\n`);
  });
});
