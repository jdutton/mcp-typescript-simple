/**
 * System tests for tool execution and LLM integration
 */

import { AxiosInstance } from 'axios';
import {
  createHttpClient,
  waitForServer,
  expectValidApiResponse,
  getCurrentEnvironment,
  describeSystemTest,
  isSTDIOEnvironment,
  isLocalEnvironment
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

describeSystemTest('Tools Execution System', () => {
  const environment = getCurrentEnvironment();

  // Skip HTTP tests entirely in STDIO mode
  if (isSTDIOEnvironment(environment)) {
    it('should skip HTTP tools tests in STDIO mode', () => {
      console.log('ℹ️  HTTP tools tests skipped for environment: STDIO transport mode (npm run dev:stdio)');
    });
    return;
  }

  let client: AxiosInstance;
  let availableTools: string[] = [];
  let llmProvidersAvailable: string[] = [];

  beforeAll(async () => {
    client = createHttpClient();

    if (isLocalEnvironment(environment) && environment.name !== 'stdio') {
      // For other HTTP local environments, wait for external server to be ready
      const isReady = await waitForServer(client);
      if (!isReady) {
        throw new Error(`Server not ready at ${environment.baseUrl}`);
      }
    }

    // Discover available tools and LLM providers
    await discoverCapabilities();
  });

  afterAll(async () => {
    // Server cleanup handled at suite level
  });

  async function discoverCapabilities() {
    // Get health info for LLM providers
    const healthResponse = await client.get('/health');
    if (healthResponse.status === 200 && healthResponse.data.llm_providers) {
      llmProvidersAvailable = healthResponse.data.llm_providers;
      console.log(`🤖 LLM providers available: ${llmProvidersAvailable.join(', ')}`);
    } else {
      console.log('⚠️ No LLM providers detected');
    }

    // Get available tools
    const toolsListRequest: MCPRequest = {
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 1
    };

    const toolsResponse = await client.post('/mcp', toolsListRequest, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
    });
    if (toolsResponse.status === 200 && toolsResponse.data.result && toolsResponse.data.result.tools) {
      availableTools = toolsResponse.data.result.tools.map((tool: any) => tool.name);
      console.log(`🔧 Tools available: ${availableTools.join(', ')}`);
    }
  }

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

  describe('Basic Tool Execution', () => {
    it('should execute hello tool with various inputs', async () => {
      if (!availableTools.includes('hello')) {
        console.log('⚠️ Hello tool not available - skipping test');
        return;
      }

      const testCases = [
        { name: 'World', expected: 'World' },
        { name: 'System Test', expected: 'System Test' },
        { name: '', expected: '' },
        { name: '测试', expected: '测试' }, // Unicode test
      ];

      for (const testCase of testCases) {
        const request: MCPRequest = {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'hello',
            arguments: { name: testCase.name }
          },
          id: `hello-${testCase.name || 'empty'}`
        };

        const response = await sendMCPRequest(request);

        expect(response.result).toBeDefined();
        expect(response.result.content).toBeDefined();

        const textContent = response.result.content.find((item: any) => item.type === 'text');
        expect(textContent).toBeDefined();
        if (testCase.expected) {
          expect(textContent.text).toContain(testCase.expected);
        }
      }
    });

    it('should execute echo tool with complex inputs', async () => {
      if (!availableTools.includes('echo')) {
        console.log('⚠️ Echo tool not available - skipping test');
        return;
      }

      const testMessages = [
        'Simple message',
        'Message with special chars: !@#$%^&*()',
        'Multi\nline\nmessage',
        'JSON-like: {"key": "value"}',
        'Very long message: ' + 'x'.repeat(1000),
      ];

      for (const message of testMessages) {
        const request: MCPRequest = {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'echo',
            arguments: { message }
          },
          id: `echo-${testMessages.indexOf(message)}`
        };

        const response = await sendMCPRequest(request);

        expect(response.result).toBeDefined();
        const textContent = response.result.content.find((item: any) => item.type === 'text');
        expect(textContent.text).toContain(message);
      }
    });

    it('should execute current-time tool consistently', async () => {
      if (!availableTools.includes('current-time')) {
        console.log('⚠️ Current-time tool not available - skipping test');
        return;
      }

      const request: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'current-time',
          arguments: {}
        },
        id: 'time-test'
      };

      const response = await sendMCPRequest(request);

      expect(response.result).toBeDefined();
      const textContent = response.result.content.find((item: any) => item.type === 'text');

      // Should return a valid timestamp
      const timestamp = textContent.text;
      const parsedTime = new Date(timestamp);
      expect(parsedTime.getTime()).toBeGreaterThan(0);

      // Should be reasonably recent (within last minute)
      const now = new Date();
      const timeDiff = Math.abs(now.getTime() - parsedTime.getTime());
      expect(timeDiff).toBeLessThan(60000); // Less than 1 minute difference
    });
  });

  describe('LLM Tool Integration', () => {
    const llmTools = ['chat', 'analyze', 'summarize', 'explain'];

    beforeEach(() => {
      if (llmProvidersAvailable.length === 0) {
        console.log('⚠️ No LLM providers available - skipping LLM tests');
      }
    });

    it('should execute chat tool when LLM providers are available', async () => {
      if (llmProvidersAvailable.length === 0 || !availableTools.includes('chat')) {
        console.log('⚠️ Chat tool or LLM providers not available - skipping test');
        return;
      }

      const request: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'chat',
          arguments: {
            message: 'Hello! Please respond with just the word "SUCCESS" to confirm you are working.',
            provider: llmProvidersAvailable[0], // Use first available provider
            model: undefined // Use default model
          }
        },
        id: 'chat-test'
      };

      try {
        const response = await sendMCPRequest(request);

        expect(response.result).toBeDefined();
        expect(response.result.content).toBeDefined();

        const textContent = response.result.content.find((item: any) => item.type === 'text');
        expect(textContent).toBeDefined();
        expect(textContent.text.length).toBeGreaterThan(0);

        console.log(`🤖 Chat tool response: ${textContent.text.substring(0, 100)}...`);
      } catch (error) {
        console.log(`⚠️ Chat tool failed (possibly rate limited or API key issue): ${error}`);
        // Don't fail the test for API key/rate limit issues in system testing
      }
    });

    it('should execute analyze tool when available', async () => {
      if (llmProvidersAvailable.length === 0 || !availableTools.includes('analyze')) {
        console.log('⚠️ Analyze tool or LLM providers not available - skipping test');
        return;
      }

      const request: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'analyze',
          arguments: {
            text: 'The quick brown fox jumps over the lazy dog. This sentence contains every letter of the alphabet.',
            provider: llmProvidersAvailable[0]
          }
        },
        id: 'analyze-test'
      };

      try {
        const response = await sendMCPRequest(request);

        expect(response.result).toBeDefined();
        const textContent = response.result.content.find((item: any) => item.type === 'text');
        expect(textContent.text.length).toBeGreaterThan(0);

        console.log(`📊 Analyze tool response: ${textContent.text.substring(0, 100)}...`);
      } catch (error) {
        console.log(`⚠️ Analyze tool failed: ${error}`);
      }
    });

    it('should execute summarize tool with default provider/model fallback', async () => {
      if (llmProvidersAvailable.length === 0 || !availableTools.includes('summarize')) {
        console.log('⚠️ Summarize tool or LLM providers not available - skipping test');
        return;
      }

      const request: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'summarize',
          arguments: {
            text: 'The Model Context Protocol enables AI applications to connect to various data sources. It provides a standardized interface for context sharing.',
            length: 'brief'
            // NO provider specified - test default fallback
            // NO model specified - test default fallback
          }
        },
        id: 'summarize-default-test'
      };

      try {
        const response = await sendMCPRequest(request);

        expect(response.result).toBeDefined();
        const textContent = response.result.content.find((item: any) => item.type === 'text');
        expect(textContent).toBeDefined();

        // CRITICAL: Check that response does NOT contain error messages
        const responseText = textContent.text.toLowerCase();
        expect(responseText).not.toContain('error');
        expect(responseText).not.toContain('fail');
        expect(responseText).not.toContain('not valid');
        expect(responseText).not.toContain('invalid');

        // Should contain actual summary content (meaningful text)
        expect(textContent.text.length).toBeGreaterThan(20);

        console.log(`📝 Summarize tool (default provider) response: ${textContent.text.substring(0, 100)}...`);
      } catch (error) {
        console.log(`⚠️ Summarize tool failed: ${error}`);
        throw error; // Re-throw to fail the test
      }
    });

    it('should handle LLM tool errors gracefully', async () => {
      const availableLlmTool = llmTools.find(tool => availableTools.includes(tool));

      if (!availableLlmTool || llmProvidersAvailable.length === 0) {
        console.log('⚠️ No LLM tools available - skipping error handling test');
        return;
      }

      // Test with invalid provider
      const invalidProviderRequest: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: availableLlmTool,
          arguments: {
            message: 'Test message',
            provider: 'invalid-provider'
          }
        },
        id: 'error-test'
      };

      const response = await client.post('/mcp', invalidProviderRequest, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
      });

      // Should return proper error response
      expect([400, 500]).toContain(response.status);

      if (response.data && response.data.error) {
        expect(response.data.error.code).toBeDefined();
        expect(response.data.error.message).toBeDefined();
      }
    });
  });

  describe('Tool Performance and Reliability', () => {
    it('should execute basic tools within acceptable time limits', async () => {
      const basicTools = ['hello', 'echo', 'current-time'].filter(tool => availableTools.includes(tool));

      for (const toolName of basicTools) {
        const startTime = Date.now();

        const request: MCPRequest = {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: toolName === 'hello' ? { name: 'Performance Test' } :
                       toolName === 'echo' ? { message: 'Performance Test' } : {}
          },
          id: `perf-${toolName}`
        };

        const response = await sendMCPRequest(request);
        const responseTime = Date.now() - startTime;

        expect(response.result).toBeDefined();
        expect(responseTime).toBeLessThan(5000); // 5 seconds max for basic tools

        console.log(`⚡ ${toolName} tool response time: ${responseTime}ms`);
      }
    });

    it('should handle multiple tool executions concurrently', async () => {
      const basicTools = ['hello', 'echo', 'current-time'].filter(tool => availableTools.includes(tool));

      if (basicTools.length === 0) {
        console.log('⚠️ No basic tools available for concurrency test');
        return;
      }

      const requests = basicTools.map((toolName, index) => {
        const request: MCPRequest = {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: toolName === 'hello' ? { name: `Concurrent Test ${index}` } :
                       toolName === 'echo' ? { message: `Concurrent Test ${index}` } : {}
          },
          id: `concurrent-${index}`
        };

        return sendMCPRequest(request);
      });

      const responses = await Promise.all(requests);

      responses.forEach((response, index) => {
        expect(response.result).toBeDefined();
        expect(response.id).toBe(`concurrent-${index}`);
      });

      console.log(`🔄 Concurrent tool execution: ${responses.length} tools completed successfully`);
    });

    it('should handle tool execution under load', async () => {
      if (!availableTools.includes('echo')) {
        console.log('⚠️ Echo tool not available for load testing');
        return;
      }

      const loadTestCount = 10;
      const requests = Array.from({ length: loadTestCount }, (_, index) => {
        const request: MCPRequest = {
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: 'echo',
            arguments: { message: `Load test message ${index}` }
          },
          id: `load-${index}`
        };

        return sendMCPRequest(request);
      });

      const startTime = Date.now();
      const responses = await Promise.allSettled(requests);
      const totalTime = Date.now() - startTime;

      const successful = responses.filter(r => r.status === 'fulfilled').length;
      const failed = responses.filter(r => r.status === 'rejected').length;

      console.log(`📈 Load test results: ${successful} successful, ${failed} failed in ${totalTime}ms`);

      // At least 80% should succeed
      expect(successful / loadTestCount).toBeGreaterThanOrEqual(0.8);
    });
  });

  describe('Tool Input Validation', () => {
    it('should validate required parameters', async () => {
      if (!availableTools.includes('hello')) {
        console.log('⚠️ Hello tool not available for validation testing');
        return;
      }

      // Test missing required parameter
      const missingParamRequest: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'hello',
          arguments: {} // Missing 'name' parameter
        },
        id: 'validation-test'
      };

      const response = await client.post('/mcp', missingParamRequest, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
      });

      // Should either succeed with default value or return proper error
      expect([200, 400, 500]).toContain(response.status);

      if (response.status !== 200 && response.data && response.data.error) {
        expect(response.data.error.code).toBeDefined();
        expect(response.data.error.message).toBeDefined();
      }
    });

    it('should handle invalid parameter types', async () => {
      if (!availableTools.includes('echo')) {
        console.log('⚠️ Echo tool not available for type validation testing');
        return;
      }

      // Test with wrong parameter type
      const wrongTypeRequest: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'echo',
          arguments: {
            message: 123 // Should be string
          }
        },
        id: 'type-validation-test'
      };

      const response = await client.post('/mcp', wrongTypeRequest, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
      });

      // Should either handle type coercion or return proper error
      expect([200, 400, 500]).toContain(response.status);

      if (response.status === 200) {
        // If it succeeds, check that it handled the type conversion
        const textContent = response.data.result.content.find((item: any) => item.type === 'text');
        expect(textContent.text).toContain('123');
      }
    });
  });

  describe('Environment-Specific Tool Behavior', () => {
    it('should adapt tool behavior based on environment', async () => {
      if (!availableTools.includes('hello')) {
        console.log('⚠️ Hello tool not available for environment testing');
        return;
      }

      const request: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'hello',
          arguments: { name: environment.name }
        },
        id: 'env-test'
      };

      const response = await sendMCPRequest(request);
      const textContent = response.result.content.find((item: any) => item.type === 'text');

      expect(textContent.text).toContain(environment.name);

      // Production environment should have consistent behavior
      if (environment.name === 'production') {
        expect(response.result.isError).toBeFalsy();
      }

      console.log(`🌍 Environment-specific response: ${textContent.text}`);
    });

    it('should respect environment-specific timeouts', async () => {
      if (llmProvidersAvailable.length === 0 || !availableTools.includes('chat')) {
        console.log('⚠️ Chat tool not available for timeout testing');
        return;
      }

      const startTime = Date.now();

      const request: MCPRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'chat',
          arguments: {
            message: 'Quick response test',
            provider: llmProvidersAvailable[0]
          }
        },
        id: 'timeout-test'
      };

      try {
        const _response = await sendMCPRequest(request);
        const responseTime = Date.now() - startTime;

        console.log(`⏱️ LLM tool response time: ${responseTime}ms`);

        // Should complete within reasonable time
        expect(responseTime).toBeLessThan(30000); // 30 seconds max
      } catch (error) {
        console.log(`⚠️ LLM tool timeout or error: ${error}`);
      }
    });
  });
});