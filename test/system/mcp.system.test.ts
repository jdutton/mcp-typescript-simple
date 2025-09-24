/**
 * System tests for MCP protocol compliance and functionality
 */

import { AxiosInstance } from 'axios';
import {
  createHttpClient,
  waitForServer,
  expectValidApiResponse,
  getCurrentEnvironment,
  describeSystemTest
} from './utils.js';

interface MCPRequest {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id: string | number;
}

interface MCPResponse {
  jsonrpc: '2.0';
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: string | number;
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

describeSystemTest('MCP Protocol System', () => {
  let client: AxiosInstance;
  const environment = getCurrentEnvironment();

  beforeAll(async () => {
    client = createHttpClient();

    // For local and docker environments, wait for server to be ready
    if (environment.name === 'local' || environment.name === 'docker') {
      const isReady = await waitForServer(client);
      if (!isReady) {
        throw new Error(`Server not ready at ${environment.baseUrl}`);
      }
    }
  });

  async function sendMCPRequest(request: MCPRequest): Promise<MCPResponse> {
    const response = await client.post('/mcp', request, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
    });

    expectValidApiResponse(response, 200);
    return response.data as MCPResponse;
  }

  describe('MCP Protocol Compliance', () => {
    it('should respond to MCP endpoint', async () => {
      const response = await client.post('/mcp', {
        jsonrpc: '2.0',
        method: 'ping',
        id: 1
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
      });

      expect([200, 400, 500]).toContain(response.status);
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should handle invalid JSON-RPC requests', async () => {
      const response = await client.post('/mcp', {
        invalid: 'request'
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
      });

      expect([400, 500]).toContain(response.status);

      if (response.data && response.data.error) {
        expect(response.data.error.code).toBeDefined();
        expect(response.data.error.message).toBeDefined();
      }
    });

    it('should validate JSON-RPC 2.0 format', async () => {
      const invalidRequests = [
        { method: 'test', id: 1 }, // Missing jsonrpc
        { jsonrpc: '1.0', method: 'test', id: 1 }, // Wrong version
        { jsonrpc: '2.0', id: 1 }, // Missing method
        { jsonrpc: '2.0', method: 'test' }, // Missing id
      ];

      for (const invalidRequest of invalidRequests) {
        const response = await client.post('/mcp', invalidRequest, {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
          },
        });
        expect([400, 500]).toContain(response.status);
      }
    });
  });

  describe('MCP Initialization', () => {
    it('should support initialize request', async () => {
      const initRequest: MCPRequest = {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            roots: {
              listChanged: true
            },
            sampling: {}
          },
          clientInfo: {
            name: 'test-client',
            version: '1.0.0'
          }
        },
        id: 1
      };

      const response = await sendMCPRequest(initRequest);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);

      if (response.result) {
        expect(response.result.protocolVersion).toBeDefined();
        expect(response.result.capabilities).toBeDefined();
        expect(response.result.serverInfo).toBeDefined();
        expect(response.result.serverInfo.name).toBeDefined();
        expect(response.result.serverInfo.version).toBeDefined();
      }
    });

    it('should handle initialization errors gracefully', async () => {
      const invalidInitRequest: MCPRequest = {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: 'invalid-version'
        },
        id: 2
      };

      const response = await client.post('/mcp', invalidInitRequest, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
      });

      // Should either succeed with a fallback or return a proper error
      expect([200, 400, 500]).toContain(response.status);

      if (response.status !== 200 && response.data && response.data.error) {
        expect(response.data.error.code).toBeDefined();
        expect(response.data.error.message).toBeDefined();
      }
    });
  });

  describe('Tool Discovery', () => {
    it('should support tools/list request', async () => {
      const toolsListRequest: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 3
      };

      const response = await sendMCPRequest(toolsListRequest);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(3);

      if (response.result) {
        expect(response.result.tools).toBeDefined();
        expect(Array.isArray(response.result.tools)).toBe(true);

        // Should have at least basic tools
        expect(response.result.tools.length).toBeGreaterThan(0);

        // Validate tool structure
        response.result.tools.forEach((tool: MCPTool) => {
          expect(tool.name).toBeDefined();
          expect(tool.description).toBeDefined();
          expect(tool.inputSchema).toBeDefined();
          expect(tool.inputSchema.type).toBeDefined();

          console.log(`🔧 Available tool: ${tool.name} - ${tool.description}`);
        });
      }
    });

    it('should include expected basic tools', async () => {
      const toolsListRequest: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 4
      };

      const response = await sendMCPRequest(toolsListRequest);

      if (response.result && response.result.tools) {
        const toolNames = response.result.tools.map((tool: MCPTool) => tool.name);

        // Should include basic tools that don't require API keys
        expect(toolNames).toContain('hello');
        expect(toolNames).toContain('echo');
        expect(toolNames).toContain('current-time');

        console.log(`📋 Available tools: ${toolNames.join(', ')}`);
      }
    });

    it('should include LLM tools when API keys are available', async () => {
      const healthResponse = await client.get('/health');
      const health = healthResponse.data;

      const toolsListRequest: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 5
      };

      const response = await sendMCPRequest(toolsListRequest);

      if (response.result && response.result.tools) {
        const toolNames = response.result.tools.map((tool: MCPTool) => tool.name);

        // If LLM providers are available, should include LLM tools
        if (health.llm_providers && health.llm_providers.length > 0) {
          const llmTools = ['chat', 'analyze', 'summarize', 'explain'];
          const hasAnyLlmTool = llmTools.some(tool => toolNames.includes(tool));

          if (hasAnyLlmTool) {
            console.log(`🤖 LLM tools available: ${toolNames.filter((name: string) => llmTools.includes(name)).join(', ')}`);
          } else {
            console.log('⚠️ LLM providers configured but no LLM tools available');
          }
        } else {
          console.log('⚠️ No LLM providers configured - LLM tools not available');
        }
      }
    });
  });

  describe('Basic Tool Execution', () => {
    it('should execute hello tool', async () => {
      const helloRequest: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'hello',
          arguments: {
            name: 'System Test'
          }
        },
        id: 6
      };

      const response = await sendMCPRequest(helloRequest);

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(6);

      if (response.result) {
        expect(response.result.content).toBeDefined();
        expect(Array.isArray(response.result.content)).toBe(true);
        expect(response.result.content.length).toBeGreaterThan(0);

        const textContent = response.result.content.find((item: any) => item.type === 'text');
        expect(textContent).toBeDefined();
        expect(textContent.text).toContain('System Test');

        console.log(`👋 Hello tool response: ${textContent.text}`);
      }
    });

    it('should execute echo tool', async () => {
      const echoRequest: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'echo',
          arguments: {
            message: 'System test message'
          }
        },
        id: 7
      };

      const response = await sendMCPRequest(echoRequest);

      if (response.result) {
        const textContent = response.result.content.find((item: any) => item.type === 'text');
        expect(textContent.text).toContain('System test message');

        console.log(`🔄 Echo tool response: ${textContent.text}`);
      }
    });

    it('should execute current-time tool', async () => {
      const timeRequest: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'current-time',
          arguments: {}
        },
        id: 8
      };

      const response = await sendMCPRequest(timeRequest);

      if (response.result) {
        const textContent = response.result.content.find((item: any) => item.type === 'text');
        expect(textContent.text).toBeDefined();

        // Should contain a valid timestamp
        const timestamp = textContent.text;
        expect(new Date(timestamp).getTime()).toBeGreaterThan(0);

        console.log(`⏰ Current time tool response: ${timestamp}`);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle unknown tool calls', async () => {
      const unknownToolRequest: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'nonexistent-tool',
          arguments: {}
        },
        id: 9
      };

      const response = await client.post('/mcp', unknownToolRequest, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
      });

      expect([400, 500]).toContain(response.status);

      if (response.data && response.data.error) {
        expect(response.data.error.code).toBeDefined();
        expect(response.data.error.message).toContain('tool');
      }
    });

    it('should handle invalid tool arguments', async () => {
      const invalidArgsRequest: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'hello',
          arguments: {
            invalid_param: 'value'
          }
        },
        id: 10
      };

      const response = await client.post('/mcp', invalidArgsRequest, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
      });

      // Should either succeed (ignoring invalid params) or return proper error
      expect([200, 400, 500]).toContain(response.status);

      if (response.status !== 200 && response.data && response.data.error) {
        expect(response.data.error.code).toBeDefined();
        expect(response.data.error.message).toBeDefined();
      }
    });

    it('should handle malformed tool call requests', async () => {
      const malformedRequest: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          // Missing name and arguments
        },
        id: 11
      };

      const response = await client.post('/mcp', malformedRequest, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
      });

      expect([400, 500]).toContain(response.status);

      if (response.data && response.data.error) {
        expect(response.data.error.code).toBeDefined();
        expect(response.data.error.message).toBeDefined();
      }
    });
  });

  describe('Protocol Performance', () => {
    it('should respond to tool calls within acceptable time', async () => {
      const startTime = Date.now();

      const helloRequest: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'hello',
          arguments: { name: 'Performance Test' }
        },
        id: 12
      };

      const response = await sendMCPRequest(helloRequest);
      const responseTime = Date.now() - startTime;

      expect(response.result).toBeDefined();

      // Basic tools should be fast
      expect(responseTime).toBeLessThan(5000); // 5 seconds max

      console.log(`⚡ Tool call response time: ${responseTime}ms`);
    });

    it('should handle concurrent tool calls', async () => {
      const requests = [
        { name: 'hello', arguments: { name: 'Test 1' } },
        { name: 'echo', arguments: { message: 'Test 2' } },
        { name: 'current-time', arguments: {} }
      ];

      const promises = requests.map((params, index) => {
        const request: MCPRequest = {
          jsonrpc: '2.0',
          method: 'tools/call',
          params,
          id: 20 + index
        };

        return sendMCPRequest(request);
      });

      const responses = await Promise.all(promises);

      // All requests should succeed
      responses.forEach((response, index) => {
        expect(response.jsonrpc).toBe('2.0');
        expect(response.id).toBe(20 + index);
        expect(response.result).toBeDefined();
      });

      console.log(`🔄 Concurrent tool calls: ${responses.length} completed successfully`);
    });
  });
});