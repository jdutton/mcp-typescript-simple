import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'yaml';

describe('OpenAPI Specification Validation', () => {
  let openapiSpec: any;

  beforeAll(() => {
    const openapiPath = join(process.cwd(), 'openapi.yaml');
    const openapiYaml = readFileSync(openapiPath, 'utf-8');
    openapiSpec = yaml.parse(openapiYaml);
  });

  describe('OpenAPI 3.1 Format Validation', () => {
    it('should have valid OpenAPI 3.1 version', () => {
      expect(openapiSpec.openapi).toBe('3.1.0');
    });

    it('should have required info section', () => {
      expect(openapiSpec.info).toBeDefined();
      expect(openapiSpec.info.title).toBe('MCP TypeScript Simple API');
      expect(openapiSpec.info.version).toBeDefined();
      expect(openapiSpec.info.description).toBeDefined();
    });

    it('should have servers configured', () => {
      expect(openapiSpec.servers).toBeDefined();
      expect(Array.isArray(openapiSpec.servers)).toBe(true);
      expect(openapiSpec.servers.length).toBeGreaterThan(0);
    });

    it('should have paths defined', () => {
      expect(openapiSpec.paths).toBeDefined();
      expect(Object.keys(openapiSpec.paths).length).toBeGreaterThan(0);
    });

    it('should have components schemas', () => {
      expect(openapiSpec.components).toBeDefined();
      expect(openapiSpec.components.schemas).toBeDefined();
    });

    it('should have security schemes', () => {
      expect(openapiSpec.components.securitySchemes).toBeDefined();
      expect(openapiSpec.components.securitySchemes.BearerAuth).toBeDefined();
      expect(openapiSpec.components.securitySchemes.OAuth2).toBeDefined();
    });
  });

  describe('Critical Endpoints Documentation', () => {
    it('should document /health endpoint', () => {
      expect(openapiSpec.paths['/health']).toBeDefined();
      expect(openapiSpec.paths['/health'].get).toBeDefined();
    });

    it('should document /mcp endpoint', () => {
      expect(openapiSpec.paths['/mcp']).toBeDefined();
      expect(openapiSpec.paths['/mcp'].get).toBeDefined();
      expect(openapiSpec.paths['/mcp'].post).toBeDefined();
      expect(openapiSpec.paths['/mcp'].delete).toBeDefined();
    });

    it('should document OAuth endpoints', () => {
      expect(openapiSpec.paths['/auth']).toBeDefined();
      expect(openapiSpec.paths['/auth/login']).toBeDefined();
      expect(openapiSpec.paths['/auth/authorize']).toBeDefined();
      expect(openapiSpec.paths['/auth/{provider}/authorize']).toBeDefined();
      expect(openapiSpec.paths['/auth/{provider}/callback']).toBeDefined();
      expect(openapiSpec.paths['/auth/token']).toBeDefined();
      expect(openapiSpec.paths['/auth/{provider}/logout']).toBeDefined();
    });

    it('should document OAuth discovery endpoints', () => {
      expect(openapiSpec.paths['/.well-known/oauth-authorization-server']).toBeDefined();
      expect(openapiSpec.paths['/.well-known/oauth-protected-resource']).toBeDefined();
      expect(openapiSpec.paths['/.well-known/oauth-protected-resource/mcp']).toBeDefined();
      expect(openapiSpec.paths['/.well-known/openid-configuration']).toBeDefined();
    });

    it('should document Dynamic Client Registration endpoints', () => {
      expect(openapiSpec.paths['/register']).toBeDefined();
      expect(openapiSpec.paths['/register'].post).toBeDefined();
      expect(openapiSpec.paths['/register/{client_id}']).toBeDefined();
    });

    it('should document admin endpoints', () => {
      expect(openapiSpec.paths['/admin/sessions']).toBeDefined();
      expect(openapiSpec.paths['/admin/sessions/{sessionId}']).toBeDefined();
      expect(openapiSpec.paths['/admin/metrics']).toBeDefined();
    });
  });

  describe('Schema Validation', () => {
    it('should have HealthResponse schema', () => {
      expect(openapiSpec.components.schemas.HealthResponse).toBeDefined();
      expect(openapiSpec.components.schemas.HealthResponse.properties.status).toBeDefined();
      expect(openapiSpec.components.schemas.HealthResponse.properties.timestamp).toBeDefined();
    });

    it('should have JSON-RPC schemas', () => {
      expect(openapiSpec.components.schemas.JsonRpcRequest).toBeDefined();
      expect(openapiSpec.components.schemas.JsonRpcResponse).toBeDefined();
      expect(openapiSpec.components.schemas.JsonRpcError).toBeDefined();
    });

    it('should have OAuth schemas', () => {
      expect(openapiSpec.components.schemas.TokenRequest).toBeDefined();
      expect(openapiSpec.components.schemas.TokenResponse).toBeDefined();
      expect(openapiSpec.components.schemas.AuthServerMetadata).toBeDefined();
    });

    it('should have Dynamic Client Registration schemas', () => {
      expect(openapiSpec.components.schemas.ClientRegistrationRequest).toBeDefined();
      expect(openapiSpec.components.schemas.ClientRegistrationResponse).toBeDefined();
    });

    it('should have error schemas', () => {
      expect(openapiSpec.components.schemas.Error).toBeDefined();
      expect(openapiSpec.components.schemas.OAuthError).toBeDefined();
    });
  });

  describe('Response Examples', () => {
    it('should have examples for critical responses', () => {
      // Health endpoint
      const healthResponse = openapiSpec.paths['/health'].get.responses['200'];
      expect(healthResponse.content['application/json'].examples).toBeDefined();

      // MCP initialize
      const mcpResponse = openapiSpec.paths['/mcp'].post.responses['200'];
      expect(mcpResponse.content['application/json'].examples).toBeDefined();
    });

    it('should have error response examples', () => {
      // Check that error responses have proper structure
      const mcpPost = openapiSpec.paths['/mcp'].post;
      expect(mcpPost.responses['400']).toBeDefined();
      expect(mcpPost.responses['401']).toBeDefined();
      expect(mcpPost.responses['500']).toBeDefined();
    });
  });

  describe('Security Configuration', () => {
    it('should configure OAuth2 with authorization code flow', () => {
      const oauth2 = openapiSpec.components.securitySchemes.OAuth2;
      expect(oauth2.type).toBe('oauth2');
      expect(oauth2.flows.authorizationCode).toBeDefined();
      expect(oauth2.flows.authorizationCode.authorizationUrl).toBeDefined();
      expect(oauth2.flows.authorizationCode.tokenUrl).toBeDefined();
    });

    it('should configure Bearer token authentication', () => {
      const bearer = openapiSpec.components.securitySchemes.BearerAuth;
      expect(bearer.type).toBe('http');
      expect(bearer.scheme).toBe('bearer');
    });
  });

  describe('Tags Organization', () => {
    it('should have properly organized tags', () => {
      expect(openapiSpec.tags).toBeDefined();
      expect(Array.isArray(openapiSpec.tags)).toBe(true);

      const tagNames = openapiSpec.tags.map((tag: any) => tag.name);
      expect(tagNames).toContain('Health & Status');
      expect(tagNames).toContain('MCP Protocol');
      expect(tagNames).toContain('OAuth Authentication');
      expect(tagNames).toContain('OAuth Discovery');
      expect(tagNames).toContain('Dynamic Client Registration');
      expect(tagNames).toContain('Admin & Monitoring');
    });
  });

  describe('RFC Compliance References', () => {
    it('should reference OAuth 2.0 RFCs in descriptions', () => {
      const authServerMetadata = openapiSpec.paths['/.well-known/oauth-authorization-server'];
      expect(authServerMetadata.get.description).toContain('RFC 8414');

      const protectedResourceMetadata = openapiSpec.paths['/.well-known/oauth-protected-resource'];
      expect(protectedResourceMetadata.get.description).toContain('RFC 9728');
    });

    it('should reference DCR RFCs', () => {
      const registerEndpoint = openapiSpec.paths['/register'];
      expect(registerEndpoint.post.description).toContain('RFC 7591');

      const clientManagement = openapiSpec.paths['/register/{client_id}'];
      expect(clientManagement.get.description).toContain('RFC 7592');
    });
  });
});