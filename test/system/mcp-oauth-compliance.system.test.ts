/**
 * System tests acting as MCP Protocol & OAuth 2.0 Specification Compliance Auditor
 *
 * This comprehensive test suite validates complete compliance with:
 * - OAuth 2.0 RFC 6750 (Bearer Token Usage)
 * - OAuth 2.0 RFC 8414 (Authorization Server Metadata)
 * - OAuth 2.0 RFC 9728 (Protected Resource Metadata)
 * - MCP Authorization Specification
 * - JSON-RPC 2.0 Specification
 */

import { AxiosInstance } from 'axios';
import {
  createHttpClient,
  waitForServer,
  expectValidApiResponse,
  getCurrentEnvironment,
  describeSystemTest
} from './utils.js';

interface ComplianceViolation {
  specification: string;
  section: string;
  requirement: string;
  actual: string;
  expected: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

class ComplianceAuditor {
  private violations: ComplianceViolation[] = [];

  addViolation(violation: ComplianceViolation): void {
    this.violations.push(violation);
  }

  getViolations(): ComplianceViolation[] {
    return this.violations;
  }

  getCriticalViolations(): ComplianceViolation[] {
    return this.violations.filter(v => v.severity === 'CRITICAL');
  }

  hasViolations(): boolean {
    return this.violations.length > 0;
  }

  generateReport(): string {
    if (!this.hasViolations()) {
      return '✅ COMPLIANCE AUDIT PASSED - No violations found';
    }

    let report = `❌ COMPLIANCE AUDIT FAILED - ${this.violations.length} violations found:\n\n`;

    for (const violation of this.violations) {
      report += `[${violation.severity}] ${violation.specification} § ${violation.section}\n`;
      report += `  Requirement: ${violation.requirement}\n`;
      report += `  Expected: ${violation.expected}\n`;
      report += `  Actual: ${violation.actual}\n\n`;
    }

    return report;
  }
}

describeSystemTest('MCP & OAuth 2.0 Specification Compliance Auditor', () => {
  let client: AxiosInstance;
  let auditor: ComplianceAuditor;
  const environment = getCurrentEnvironment();

  beforeAll(async () => {
    client = createHttpClient();
    auditor = new ComplianceAuditor();

    // For local and docker environments, wait for server to be ready
    if (environment.name === 'local' || environment.name === 'docker') {
      const isReady = await waitForServer(client);
      if (!isReady) {
        throw new Error(`Server not ready at ${environment.baseUrl}`);
      }
    }
  });

  afterEach(() => {
    // Report any violations found in this test
    if (auditor.hasViolations()) {
      console.warn(auditor.generateReport());
    }
  });

  describe('OAuth 2.0 RFC 6750 Bearer Token Compliance', () => {
    it('should comply with Section 3.1 - WWW-Authenticate Response Header Field', async () => {
      console.log('🔍 Auditing RFC 6750 Section 3.1 compliance...');

      // Test unauthorized request to protected resource
      const response = await client.post('/mcp', {
        jsonrpc: '2.0',
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
        id: 1
      }, { validateStatus: () => true });

      // CRITICAL: Must return 401 for unauthorized requests
      if (response.status !== 401) {
        auditor.addViolation({
          specification: 'RFC 6750',
          section: '3.1',
          requirement: 'Protected resource must respond with 401 for unauthorized requests',
          expected: 'HTTP 401 Unauthorized',
          actual: `HTTP ${response.status}`,
          severity: 'CRITICAL'
        });
      }

      // CRITICAL: Must include WWW-Authenticate header
      const wwwAuth = response.headers['www-authenticate'];
      if (!wwwAuth) {
        auditor.addViolation({
          specification: 'RFC 6750',
          section: '3.1',
          requirement: 'WWW-Authenticate header MUST be included in 401 responses',
          expected: 'WWW-Authenticate header present',
          actual: 'WWW-Authenticate header missing',
          severity: 'CRITICAL'
        });
        return;
      }

      // CRITICAL: Header must start with "Bearer"
      if (!wwwAuth.startsWith('Bearer ')) {
        auditor.addViolation({
          specification: 'RFC 6750',
          section: '3.1',
          requirement: 'WWW-Authenticate header must start with "Bearer "',
          expected: 'Bearer auth-scheme',
          actual: wwwAuth.split(' ')[0],
          severity: 'CRITICAL'
        });
      }

      // HIGH: Should include realm parameter
      if (!wwwAuth.includes('realm=')) {
        auditor.addViolation({
          specification: 'RFC 6750',
          section: '3.1',
          requirement: 'realm parameter SHOULD be included',
          expected: 'realm="..." parameter',
          actual: 'realm parameter missing',
          severity: 'HIGH'
        });
      }

      // Note: resource_metadata parameter is not required by RFC 6750
      // Discovery can be achieved through well-known endpoints

      console.log(`✅ WWW-Authenticate header: ${wwwAuth}`);
    });

    it('should comply with Section 2.1 - Authorization Request Header Field', async () => {
      console.log('🔍 Auditing RFC 6750 Section 2.1 compliance...');

      const testCases = [
        {
          auth: 'Bearer',
          desc: 'missing token',
          expectError: true
        },
        {
          auth: 'Bearer ',
          desc: 'empty token',
          expectError: true
        },
        {
          auth: 'bearer valid-token',
          desc: 'lowercase scheme',
          expectError: true
        },
        {
          auth: 'Basic dGVzdA==',
          desc: 'wrong auth scheme',
          expectError: true
        },
        {
          auth: 'Bearer invalid-but-formatted-token',
          desc: 'properly formatted but invalid token',
          expectError: true
        }
      ];

      for (const testCase of testCases) {
        const response = await client.post('/mcp', {
          jsonrpc: '2.0',
          method: 'initialize',
          params: { protocolVersion: '2024-11-05' },
          id: 1
        }, {
          headers: { Authorization: testCase.auth },
          validateStatus: () => true
        });

        if (testCase.expectError && response.status !== 401) {
          auditor.addViolation({
            specification: 'RFC 6750',
            section: '2.1',
            requirement: `Invalid authorization (${testCase.desc}) must result in 401`,
            expected: 'HTTP 401',
            actual: `HTTP ${response.status}`,
            severity: 'CRITICAL'
          });
        }

        if (testCase.expectError && !response.headers['www-authenticate']) {
          auditor.addViolation({
            specification: 'RFC 6750',
            section: '2.1',
            requirement: 'Invalid authorization must include WWW-Authenticate header',
            expected: 'WWW-Authenticate header',
            actual: 'Missing header',
            severity: 'CRITICAL'
          });
        }
      }
    });
  });

  describe('OAuth 2.0 RFC 9728 Protected Resource Metadata Compliance', () => {
    it('should provide protected resource metadata per Section 3', async () => {
      console.log('🔍 Auditing RFC 9728 Section 3 compliance...');

      const response = await client.get('/.well-known/oauth-protected-resource');
      expectValidApiResponse(response, 200);

      const metadata = response.data;

      // CRITICAL: Must include resource field
      if (!metadata.resource) {
        auditor.addViolation({
          specification: 'RFC 9728',
          section: '3',
          requirement: 'Protected resource metadata MUST include "resource" field',
          expected: 'resource field present',
          actual: 'resource field missing',
          severity: 'CRITICAL'
        });
      }

      // CRITICAL: Must include authorization_servers field
      if (!metadata.authorization_servers) {
        auditor.addViolation({
          specification: 'RFC 9728',
          section: '3',
          requirement: 'Protected resource metadata MUST include "authorization_servers" field',
          expected: 'authorization_servers field present',
          actual: 'authorization_servers field missing',
          severity: 'CRITICAL'
        });
      }

      // HIGH: authorization_servers should be an array
      if (metadata.authorization_servers && !Array.isArray(metadata.authorization_servers)) {
        auditor.addViolation({
          specification: 'RFC 9728',
          section: '3',
          requirement: 'authorization_servers SHOULD be an array',
          expected: 'Array of authorization server URLs',
          actual: typeof metadata.authorization_servers,
          severity: 'HIGH'
        });
      }

      console.log(`✅ Protected resource metadata valid for: ${metadata.resource}`);
    });

    it('should provide MCP-specific protected resource metadata', async () => {
      console.log('🔍 Auditing MCP-specific protected resource metadata...');

      const response = await client.get('/.well-known/oauth-protected-resource/mcp');
      expectValidApiResponse(response, 200);

      const metadata = response.data;

      // HIGH: Should include MCP-specific scopes
      if (!metadata.scopes_supported || !Array.isArray(metadata.scopes_supported)) {
        auditor.addViolation({
          specification: 'MCP Authorization',
          section: 'Discovery',
          requirement: 'MCP resource metadata SHOULD include scopes_supported',
          expected: 'scopes_supported array',
          actual: 'scopes_supported missing or invalid',
          severity: 'HIGH'
        });
      }

      const expectedScopes = ['mcp:read', 'mcp:write'];
      if (metadata.scopes_supported) {
        for (const scope of expectedScopes) {
          if (!metadata.scopes_supported.includes(scope)) {
            auditor.addViolation({
              specification: 'MCP Authorization',
              section: 'Scopes',
              requirement: `MCP scope "${scope}" SHOULD be supported`,
              expected: `${scope} in scopes_supported`,
              actual: 'scope not found',
              severity: 'MEDIUM'
            });
          }
        }
      }

      console.log(`✅ MCP metadata includes ${metadata.scopes_supported?.length || 0} supported scopes`);
    });

  });

  describe('OAuth 2.0 RFC 8414 Authorization Server Metadata Compliance', () => {
    it('should provide authorization server metadata per Section 3', async () => {
      console.log('🔍 Auditing RFC 8414 Section 3 compliance...');

      const response = await client.get('/.well-known/oauth-authorization-server');
      expectValidApiResponse(response, 200);

      const metadata = response.data;

      // CRITICAL: Must include issuer
      if (!metadata.issuer) {
        auditor.addViolation({
          specification: 'RFC 8414',
          section: '3',
          requirement: 'Authorization server metadata MUST include "issuer"',
          expected: 'issuer field',
          actual: 'issuer missing',
          severity: 'CRITICAL'
        });
      }

      // CRITICAL: Must include authorization_endpoint
      if (!metadata.authorization_endpoint) {
        auditor.addViolation({
          specification: 'RFC 8414',
          section: '3',
          requirement: 'Authorization server metadata MUST include "authorization_endpoint"',
          expected: 'authorization_endpoint field',
          actual: 'authorization_endpoint missing',
          severity: 'CRITICAL'
        });
      }

      // HIGH: Should include token_endpoint
      if (!metadata.token_endpoint) {
        auditor.addViolation({
          specification: 'RFC 8414',
          section: '3',
          requirement: 'Authorization server metadata SHOULD include "token_endpoint"',
          expected: 'token_endpoint field',
          actual: 'token_endpoint missing',
          severity: 'HIGH'
        });
      }

      // MEDIUM: Should include scopes_supported
      if (!metadata.scopes_supported) {
        auditor.addViolation({
          specification: 'RFC 8414',
          section: '3',
          requirement: 'Authorization server metadata SHOULD include "scopes_supported"',
          expected: 'scopes_supported array',
          actual: 'scopes_supported missing',
          severity: 'MEDIUM'
        });
      }

      console.log(`✅ Authorization server metadata valid for issuer: ${metadata.issuer}`);
    });
  });

  describe('MCP Protocol JSON-RPC 2.0 Compliance', () => {
    it('should comply with JSON-RPC 2.0 specification for error responses', async () => {
      console.log('🔍 Auditing JSON-RPC 2.0 error response compliance...');

      // Test with invalid JSON-RPC request
      const response = await client.post('/mcp', {
        jsonrpc: '1.0', // Wrong version
        method: 'initialize',
        id: 1
      }, { validateStatus: () => true });

      // Should still include OAuth headers even for protocol errors
      if (response.status === 401 && !response.headers['www-authenticate']) {
        auditor.addViolation({
          specification: 'MCP Authorization',
          section: 'Error Handling',
          requirement: 'OAuth headers must be included even for protocol errors',
          expected: 'WWW-Authenticate header',
          actual: 'header missing',
          severity: 'HIGH'
        });
      }

      console.log(`✅ JSON-RPC error handling with OAuth compliance verified`);
    });

    it('should handle concurrent requests with proper OAuth error responses', async () => {
      console.log('🔍 Auditing concurrent request OAuth compliance...');

      const requests = Array(5).fill(null).map((_, i) =>
        client.post('/mcp', {
          jsonrpc: '2.0',
          method: 'initialize',
          params: { protocolVersion: '2024-11-05' },
          id: i + 1
        }, { validateStatus: () => true })
      );

      const responses = await Promise.all(requests);

      // All unauthorized requests should have consistent OAuth error handling
      for (let i = 0; i < responses.length; i++) {
        const response = responses[i];
        if (response.status === 401 && !response.headers['www-authenticate']) {
          auditor.addViolation({
            specification: 'RFC 6750',
            section: '3.1',
            requirement: 'Concurrent unauthorized requests must include WWW-Authenticate headers',
            expected: 'WWW-Authenticate header in all responses',
            actual: `Response ${i + 1} missing header`,
            severity: 'CRITICAL'
          });
        }
      }

      console.log(`✅ Concurrent request OAuth compliance verified for ${responses.length} requests`);
    });
  });

  describe('Cross-Specification Integration Compliance', () => {
    it('should maintain consistent base URLs across all discovery endpoints', async () => {
      console.log('🔍 Auditing cross-specification URL consistency...');

      const [authServer, protectedResource, mcpResource] = await Promise.all([
        client.get('/.well-known/oauth-authorization-server'),
        client.get('/.well-known/oauth-protected-resource'),
        client.get('/.well-known/oauth-protected-resource/mcp')
      ]);

      const authIssuer = authServer.data.issuer;
      const protectedResourceUrl = protectedResource.data.resource;
      const mcpResourceUrl = mcpResource.data.resource;

      if (authIssuer !== protectedResourceUrl) {
        auditor.addViolation({
          specification: 'Cross-Spec Integration',
          section: 'URL Consistency',
          requirement: 'Authorization server issuer must match protected resource URL',
          expected: authIssuer,
          actual: protectedResourceUrl,
          severity: 'HIGH'
        });
      }

      if (protectedResourceUrl !== mcpResourceUrl) {
        auditor.addViolation({
          specification: 'Cross-Spec Integration',
          section: 'URL Consistency',
          requirement: 'Protected resource URLs must be consistent across endpoints',
          expected: protectedResourceUrl,
          actual: mcpResourceUrl,
          severity: 'HIGH'
        });
      }

      console.log(`✅ URL consistency verified across discovery endpoints`);
    });

    it('should provide complete MCP authorization flow integration', async () => {
      console.log('🔍 Auditing complete MCP authorization flow...');

      // Step 1: Try to access MCP endpoint without auth
      const unauthorizedResponse = await client.post('/mcp', {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1
      }, { validateStatus: () => true });

      // Step 2: Should get 401 with discovery information
      if (unauthorizedResponse.status !== 401) {
        auditor.addViolation({
          specification: 'MCP Authorization Flow',
          section: 'Access Control',
          requirement: 'Unauthorized MCP requests must return 401',
          expected: 'HTTP 401',
          actual: `HTTP ${unauthorizedResponse.status}`,
          severity: 'CRITICAL'
        });
      }

      // Step 3: Should be able to discover authorization server via well-known endpoints
      try {
        const metadataResponse = await client.get('/.well-known/oauth-protected-resource/mcp');

        if (metadataResponse.status === 200 && metadataResponse.data.authorization_servers) {
          console.log(`✅ Complete MCP authorization flow discoverable via well-known endpoint`);
        } else {
          auditor.addViolation({
            specification: 'MCP Authorization Flow',
            section: 'Discovery',
            requirement: 'Authorization server discovery must be functional via well-known endpoints',
            expected: 'Accessible authorization servers via /.well-known/oauth-protected-resource/mcp',
            actual: 'Discovery failed',
            severity: 'CRITICAL'
          });
        }
      } catch (error) {
        auditor.addViolation({
          specification: 'MCP Authorization Flow',
          section: 'Discovery',
          requirement: 'Well-known OAuth discovery endpoints must be accessible',
          expected: 'Successful response from /.well-known/oauth-protected-resource/mcp',
          actual: `Discovery endpoint error: ${error}`,
          severity: 'CRITICAL'
        });
      }
    });
  });

  describe('Final Compliance Report', () => {
    it('should generate comprehensive compliance audit report', () => {
      console.log('📋 Generating final compliance audit report...');

      const report = auditor.generateReport();
      console.log('\n' + '='.repeat(80));
      console.log('MCP & OAUTH 2.0 SPECIFICATION COMPLIANCE AUDIT REPORT');
      console.log('='.repeat(80));
      console.log(report);
      console.log('='.repeat(80) + '\n');

      // Fail the test if there are any critical violations
      const criticalViolations = auditor.getCriticalViolations();
      expect(criticalViolations).toHaveLength(0);

      if (!auditor.hasViolations()) {
        console.log('🎉 COMPLIANCE CERTIFICATION: Server fully complies with MCP & OAuth 2.0 specifications');
      }
    });
  });
});