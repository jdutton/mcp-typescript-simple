/**
 * System tests for MCP Session State Management (Issue #25)
 *
 * Tests the complete MCP protocol lifecycle including:
 * - Session initialization and persistence
 * - Tool listing and execution with session continuity
 * - DELETE endpoint for session cleanup
 * - Error handling for various scenarios
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { spawn, ChildProcess } from 'child_process';

interface MCPResponse<T = any> {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

interface SessionResponse {
  message: string;
  sessionId: string;
  requestId: string;
  timestamp: string;
}

interface ErrorResponse {
  error: string;
  message: string;
  requestId: string;
  timestamp: string;
  sessionId?: string;
}

class MCPTestClient {
  private baseUrl = 'http://localhost:3001'; // Use different port to avoid conflicts
  private defaultHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream'
  };

  async post<T = any>(path: string, body?: any, headers: Record<string, string> = {}): Promise<{
    status: number;
    headers: Record<string, string>;
    data: T;
  }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { ...this.defaultHeaders, ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const data = await response.json();
    return {
      status: response.status,
      headers: responseHeaders,
      data
    };
  }

  async delete<T = any>(path: string, headers: Record<string, string> = {}): Promise<{
    status: number;
    data: T;
  }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: { ...this.defaultHeaders, ...headers },
    });

    const data = await response.json();
    return {
      status: response.status,
      data
    };
  }

  async get<T = any>(path: string, headers: Record<string, string> = {}): Promise<{
    status: number;
    data: T;
  }> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { ...this.defaultHeaders, ...headers },
    });

    const data = await response.json();
    return {
      status: response.status,
      data
    };
  }
}

describe('MCP Session State Management System Tests', () => {
  let serverProcess: ChildProcess;
  let client: MCPTestClient;

  beforeAll(async () => {
    client = new MCPTestClient();

    // Start the server on port 3001
    serverProcess = spawn('npm', ['run', 'dev:http'], {
      env: {
        ...process.env,
        HTTP_PORT: '3001',
        MCP_MODE: 'streamable_http',
        MCP_DEV_SKIP_AUTH: 'true'
      },
      stdio: 'pipe'
    });

    // Wait for server to start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verify server is running
    try {
      await fetch('http://localhost:3001/mcp', {
        method: 'GET',
        headers: { 'Accept': 'text/event-stream' }
      });
    } catch (error) {
      throw new Error('Failed to start test server');
    }
  }, 15000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  });

  describe('Session Initialization', () => {
    it('should initialize MCP session successfully', async () => {
      const response = await client.post<MCPResponse>('/mcp', {
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
      });

      expect(response.status).toBe(200);
      expect(response.data.jsonrpc).toBe('2.0');
      expect(response.data.id).toBe(1);
      expect(response.data.result).toBeDefined();
      expect(response.data.result.protocolVersion).toBe('2024-11-05');
      expect(response.data.result.serverInfo.name).toBe('mcp-typescript-simple');
      expect(response.headers['mcp-session-id']).toBeDefined();
      expect(response.headers['mcp-session-id']).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    });

    it('should return proper server capabilities', async () => {
      const response = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' }
        }
      });

      expect(response.status).toBe(200);
      expect(response.data.result.capabilities).toBeDefined();
      expect(response.data.result.capabilities.tools).toBeDefined();
    });
  });

  describe('Session Persistence', () => {
    let sessionId: string;

    beforeEach(async () => {
      // Create a session for each test
      const response = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' }
        }
      });

      sessionId = response.headers['mcp-session-id']!;
      expect(sessionId).toBeDefined();
    });

    it('should maintain session across multiple requests', async () => {
      // First request: tools/list
      const toolsResponse = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      }, {
        'mcp-session-id': sessionId!
      });

      expect(toolsResponse.status).toBe(200);
      expect(toolsResponse.data.result).toBeDefined();
      expect(toolsResponse.data.result.tools).toBeDefined();
      expect(Array.isArray(toolsResponse.data.result.tools)).toBe(true);
      expect(toolsResponse.data.result.tools.length).toBeGreaterThan(0);

      // Verify we have the expected basic tools
      const toolNames = toolsResponse.data.result.tools.map((tool: any) => tool.name);
      expect(toolNames).toContain('hello');
      expect(toolNames).toContain('echo');
      expect(toolNames).toContain('current-time');

      // Second request: tool execution
      const executeResponse = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'hello',
          arguments: { name: 'Session Test' }
        }
      }, {
        'mcp-session-id': sessionId!
      });

      expect(executeResponse.status).toBe(200);
      expect(executeResponse.data.result).toBeDefined();
      expect(executeResponse.data.result.content).toBeDefined();
      expect(executeResponse.data.result.content[0].text).toContain('Hello, Session Test');
    });

    it('should fail tools/list without session', async () => {
      const response = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/list',
        params: {}
      });

      expect(response.status).toBe(400);
      expect(response.data.error).toBeDefined();
      expect(response.data.error?.message).toBe('Bad Request: Server not initialized');
    });

    it('should fail with invalid session ID', async () => {
      const response = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/list',
        params: {}
      }, {
        'mcp-session-id': 'invalid-session-id'
      });

      expect(response.status).toBe(400);
      expect(response.data.error).toBeDefined();
      expect(response.data.error?.message).toBe('Bad Request: Server not initialized');
    });
  });

  describe('Session Cleanup', () => {
    let sessionId: string;

    beforeEach(async () => {
      // Create a session for each test
      const response = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' }
        }
      });

      sessionId = response.headers['mcp-session-id']!;
    });

    it('should successfully cleanup existing session', async () => {
      // Verify session works before cleanup
      const beforeResponse = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      }, {
        'mcp-session-id': sessionId!
      });

      expect(beforeResponse.status).toBe(200);

      // Delete the session
      const deleteResponse = await client.delete<SessionResponse>('/mcp', {
        'mcp-session-id': sessionId!
      });

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.data.message).toBe('Session successfully terminated');
      expect(deleteResponse.data.sessionId).toBe(sessionId);
      expect(deleteResponse.data.requestId).toBeDefined();
      expect(deleteResponse.data.timestamp).toBeDefined();

      // Verify session no longer works after cleanup
      const afterResponse = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
        params: {}
      }, {
        'mcp-session-id': sessionId!
      });

      expect(afterResponse.status).toBe(400);
      expect(afterResponse.data.error?.message).toBe('Bad Request: Server not initialized');
    });

    it('should return 400 when deleting without session ID', async () => {
      const response = await client.delete<ErrorResponse>('/mcp');

      expect(response.status).toBe(400);
      expect(response.data.error).toBe('Bad Request');
      expect(response.data.message).toBe('DELETE requests require mcp-session-id header');
    });

    it('should return 404 when deleting non-existent session', async () => {
      const response = await client.delete<ErrorResponse>('/mcp', {
        'mcp-session-id': 'non-existent-session-123'
      });

      expect(response.status).toBe(404);
      expect(response.data.error).toBe('Session Not Found');
      expect(response.data.message).toBe('Session non-existent-session-123 not found or already terminated');
      expect(response.data.sessionId).toBe('non-existent-session-123');
    });
  });

  describe('Tool Functionality', () => {
    let sessionId: string;

    beforeEach(async () => {
      const response = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' }
        }
      });

      sessionId = response.headers['mcp-session-id']!;
    });

    it('should execute hello tool successfully', async () => {
      const response = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'hello',
          arguments: { name: 'System Test' }
        }
      }, {
        'mcp-session-id': sessionId!
      });

      expect(response.status).toBe(200);
      expect(response.data.result.content[0].text).toContain('Hello, System Test');
    });

    it('should execute echo tool successfully', async () => {
      const response = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'echo',
          arguments: { message: 'Test message' }
        }
      }, {
        'mcp-session-id': sessionId!
      });

      expect(response.status).toBe(200);
      expect(response.data.result.content[0].text).toBe('Echo: Test message');
    });

    it('should execute current-time tool successfully', async () => {
      const response = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'current-time',
          arguments: {}
        }
      }, {
        'mcp-session-id': sessionId!
      });

      expect(response.status).toBe(200);
      expect(response.data.result.content[0].text).toContain('Current time:');
      expect(response.data.result.content[0].text).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid JSON-RPC requests', async () => {
      const response = await client.post<MCPResponse>('/mcp', {
        invalid: 'request'
      });

      // Should return error for invalid JSON-RPC request
      expect(response.status).toBe(400);
    });

    it('should handle missing Accept headers properly', async () => {
      const response = await client.get<MCPResponse>('/mcp');

      expect(response.status).toBe(400);
      expect(response.data.error?.message).toBe('Bad Request: Server not initialized');
    });

    it('should handle GET with proper headers but no session', async () => {
      const response = await client.get<MCPResponse>('/mcp', {
        'Accept': 'text/event-stream'
      });

      expect(response.status).toBe(400);
      expect(response.data.error?.message).toBe('Bad Request: Server not initialized');
    });
  });

  describe('Full MCP Protocol Lifecycle', () => {
    it('should complete full initialize → list → call → cleanup cycle', async () => {
      // Step 1: Initialize session
      const initResponse = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: { roots: { listChanged: true } },
          clientInfo: { name: 'lifecycle-test', version: '1.0.0' }
        }
      });

      expect(initResponse.status).toBe(200);
      const sessionId = initResponse.headers['mcp-session-id'];
      expect(sessionId).toBeDefined();

      // Step 2: List available tools
      const listResponse = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      }, {
        'mcp-session-id': sessionId!
      });

      expect(listResponse.status).toBe(200);
      expect(listResponse.data.result.tools.length).toBeGreaterThan(0);

      // Step 3: Execute multiple tools
      const helloResponse = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'hello',
          arguments: { name: 'Lifecycle' }
        }
      }, {
        'mcp-session-id': sessionId!
      });

      expect(helloResponse.status).toBe(200);
      expect(helloResponse.data.result.content[0].text).toContain('Hello, Lifecycle');

      const echoResponse = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'echo',
          arguments: { message: 'Lifecycle test complete' }
        }
      }, {
        'mcp-session-id': sessionId!
      });

      expect(echoResponse.status).toBe(200);
      expect(echoResponse.data.result.content[0].text).toBe('Echo: Lifecycle test complete');

      // Step 4: Cleanup session
      const cleanupResponse = await client.delete<SessionResponse>('/mcp', {
        'mcp-session-id': sessionId!
      });

      expect(cleanupResponse.status).toBe(200);
      expect(cleanupResponse.data.message).toBe('Session successfully terminated');

      // Step 5: Verify session is cleaned up
      const postCleanupResponse = await client.post<MCPResponse>('/mcp', {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/list',
        params: {}
      }, {
        'mcp-session-id': sessionId!
      });

      expect(postCleanupResponse.status).toBe(400);
      expect(postCleanupResponse.data.error?.message).toBe('Bad Request: Server not initialized');
    });
  });
});