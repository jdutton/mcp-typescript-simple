/**
 * System tests for CORS headers (MCP Inspector Regression)
 *
 * Tests that Access-Control-Expose-Headers includes mcp-session-id
 * so JavaScript clients (like MCP Inspector) can read it from responses.
 *
 * Regression test for: MCP Inspector unable to read session IDs after OAuth refactoring
 * Root cause: Missing Access-Control-Expose-Headers header
 * Fix: Added header to both Express server and Vercel serverless endpoint
 */

interface MCPResponse<T = any> {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

class MCPTestClient {
  private baseUrl = 'http://localhost:3001';
  private defaultHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream'
  };

  async post<T = any>(path: string, body?: any): Promise<{
    status: number;
    headers: Headers;
    data: T;
  }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.defaultHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();
    return {
      status: response.status,
      headers: response.headers,
      data
    };
  }

  async get<T = any>(path: string): Promise<{
    status: number;
    headers: Headers;
    data: T;
  }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.defaultHeaders,
    });

    const data = await response.json();
    return {
      status: response.status,
      headers: response.headers,
      data
    };
  }
}

// Skip this test suite in STDIO mode - CORS headers only apply to HTTP transport
const testEnv = process.env.TEST_ENV || 'express';
const describeIfExpress = testEnv === 'express' ? describe : describe.skip;

describeIfExpress('MCP CORS Headers', () => {
  let client: MCPTestClient;

  beforeAll(() => {
    client = new MCPTestClient();
  });

  describe('Access-Control-Expose-Headers', () => {
    it('should include mcp-session-id in exposed headers on MCP endpoint', async () => {
      // Initialize a session
      const initializeRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            roots: { listChanged: true },
            sampling: {}
          },
          clientInfo: {
            name: 'test-client',
            version: '1.0.0'
          }
        }
      };

      const response = await client.post<MCPResponse>('/mcp', initializeRequest);

      // Verify the response includes Access-Control-Expose-Headers
      expect(response.status).toBe(200);
      expect(response.headers.has('access-control-expose-headers')).toBe(true);

      // Verify mcp-session-id is in the exposed headers list
      const exposedHeaders = response.headers.get('access-control-expose-headers');
      expect(exposedHeaders).toBeTruthy();
      expect(exposedHeaders?.toLowerCase()).toContain('mcp-session-id');
      expect(exposedHeaders?.toLowerCase()).toContain('mcp-protocol-version');
    });

    it('should include mcp-session-id in exposed headers on health endpoint', async () => {
      const response = await client.get('/health');

      // Verify the response includes Access-Control-Expose-Headers
      expect(response.status).toBe(200);
      expect(response.headers.has('access-control-expose-headers')).toBe(true);

      // Verify mcp-session-id is in the exposed headers list
      const exposedHeaders = response.headers.get('access-control-expose-headers');
      expect(exposedHeaders).toBeTruthy();
      expect(exposedHeaders?.toLowerCase()).toContain('mcp-session-id');
    });

    it('should allow JavaScript to read mcp-session-id header', async () => {
      // This test simulates what MCP Inspector does:
      // 1. Make a request to initialize a session
      // 2. Read the mcp-session-id header from the response
      // 3. Use that session ID in subsequent requests

      const initializeRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            roots: { listChanged: true },
            sampling: {}
          },
          clientInfo: {
            name: 'mcp-inspector-test',
            version: '1.0.0'
          }
        }
      };

      const response = await client.post<MCPResponse>('/mcp', initializeRequest);

      // Verify we can read the session ID from headers
      // In a browser, this would fail without Access-Control-Expose-Headers
      const sessionId = response.headers.get('mcp-session-id');
      expect(sessionId).toBeTruthy();
      expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

      // Verify the session ID can be used in subsequent requests
      const notificationRequest = {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
        params: {}
      };

      const notificationResponse = await client.post('/mcp', notificationRequest);
      expect(notificationResponse.status).toBe(202); // Accepted for notifications
    });
  });

  describe('CORS Preflight (OPTIONS)', () => {
    it('should include mcp-session-id in allowed and exposed headers', async () => {
      const response = await fetch('http://localhost:3001/mcp', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:6274',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type, mcp-session-id'
        }
      });

      expect(response.status).toBe(204); // No content for OPTIONS

      // Verify Access-Control-Allow-Headers includes mcp-session-id
      const allowedHeaders = response.headers.get('access-control-allow-headers');
      expect(allowedHeaders?.toLowerCase()).toContain('mcp-session-id');

      // Verify Access-Control-Expose-Headers includes mcp-session-id
      const exposedHeaders = response.headers.get('access-control-expose-headers');
      expect(exposedHeaders?.toLowerCase()).toContain('mcp-session-id');
    });
  });
});
