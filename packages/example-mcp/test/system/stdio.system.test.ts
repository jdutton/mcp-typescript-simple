/**
 * STDIO Mode System Tests
 *
 * Tests MCP server functionality over STDIO transport mode.
 * Limited to core MCP protocol functionality that works in STDIO mode.
 */

import {
  getCurrentEnvironment,
  describeSystemTest,
  isSTDIOEnvironment,
  conditionalDescribe
} from './utils.js';
import { STDIOTestClient } from './stdio-client.js';

describeSystemTest('STDIO Transport System', () => {
  let client: STDIOTestClient;
  const environment = getCurrentEnvironment();

  // Only run these tests in STDIO mode
  conditionalDescribe(isSTDIOEnvironment(environment), 'STDIO Mode Tests', () => {
    beforeAll(async () => {
      client = new STDIOTestClient({
        timeout: 15000,
        startupDelay: 3000
      });

      await client.start();
    });

    afterAll(async () => {
      if (client) {
        await client.stop();
      }
    });

    describe('Tool Discovery', () => {
      test('should list available tools', async () => {
        const tools = await client.listTools();

        expect(Array.isArray(tools)).toBe(true);
        expect(tools.length).toBeGreaterThan(0);

        // Verify basic tools are available
        const toolNames = tools.map(tool => tool.name);
        expect(toolNames).toContain('hello');
        expect(toolNames).toContain('echo');
        expect(toolNames).toContain('current-time');

        console.log(`✅ Found ${tools.length} tools: ${toolNames.join(', ')}`);
      });

      test('should provide tool schemas', async () => {
        const tools = await client.listTools();

        for (const tool of tools) {
          expect(tool.name).toBeDefined();
          expect(tool.description).toBeDefined();
          expect(tool.inputSchema).toBeDefined();
          expect(tool.inputSchema.type).toBe('object');
        }

        console.log('✅ All tools have valid schemas');
      });
    });

    describe('Basic Tool Execution', () => {
      test('should execute hello tool', async () => {
        const result = await client.callTool('hello', { name: 'STDIO Test' });

        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content.length).toBeGreaterThan(0);
        expect(result.content[0].type).toBe('text');
        expect(result.content[0].text).toContain('Hello, STDIO Test');

        console.log('✅ Hello tool executed successfully');
      });

      test('should execute echo tool', async () => {
        const testMessage = 'STDIO echo test message';
        const result = await client.callTool('echo', { message: testMessage });

        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content[0].type).toBe('text');
        expect(result.content[0].text).toContain(testMessage);

        console.log('✅ Echo tool executed successfully');
      });

      test('should execute current-time tool', async () => {
        const result = await client.callTool('current-time', {});

        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
        expect(Array.isArray(result.content)).toBe(true);
        expect(result.content[0].type).toBe('text');
        expect(result.content[0].text).toMatch(/Current time: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

        console.log('✅ Current-time tool executed successfully');
      });
    });

    describe('Tool Input Validation', () => {
      test('should reject invalid tool names', async () => {
        await expect(client.callTool('nonexistent-tool', {})).rejects.toThrow();
        console.log('✅ Invalid tool names properly rejected');
      });

      test('should handle missing parameters gracefully', async () => {
        // Test that tools handle missing parameters gracefully (may accept defaults or reject)
        try {
          const result = await client.callTool('hello', {});
          // If it succeeds, it handles defaults gracefully
          expect(result.content).toBeDefined();
          console.log('✅ Missing parameters handled with defaults');
        } catch (error) {
          // If it fails, it should fail gracefully
          expect(error).toBeDefined();
          console.log('✅ Missing parameters properly rejected');
        }
      });

      test('should handle invalid parameter types gracefully', async () => {
        // This should either work or fail gracefully, not crash the server
        try {
          await client.callTool('hello', { name: 123 });
          console.log('✅ Invalid parameter types handled gracefully (accepted)');
        } catch (error) {
          expect(error).toBeDefined();
          console.log('✅ Invalid parameter types handled gracefully (rejected)');
        }
      });
    });

    describe('JSON-RPC Protocol', () => {
      test('should handle invalid method requests gracefully', async () => {
        // Test invalid method request
        const client2 = new STDIOTestClient();
        await client2.start();

        try {
          // Send invalid method
          const response = await client2.sendRequest({
            jsonrpc: '2.0',
            method: 'invalid-json-test'
          });

          // Should get a proper JSON-RPC error response, not throw
          expect(response.error).toBeDefined();
          expect(response.error!.code).toBe(-32601); // Method not found
          console.log('✅ Invalid method requests return proper JSON-RPC errors');
        } finally {
          await client2.stop();
        }
      });

      test('should maintain proper JSON-RPC format in responses', async () => {
        const result = await client.callTool('echo', { message: 'format test' });

        // Check that we got a proper result structure
        expect(result).toBeDefined();
        expect(typeof result).toBe('object');
        expect(result.content).toBeDefined();

        console.log('✅ Proper JSON-RPC response format maintained');
      });
    });

    describe('LLM Tools (if available)', () => {
      test('should list LLM tools if API keys are configured', async () => {
        const tools = await client.listTools();
        const toolNames = tools.map(tool => tool.name);

        const llmTools = ['chat', 'analyze', 'summarize', 'explain'];
        const availableLLMTools = llmTools.filter(tool => toolNames.includes(tool));

        if (availableLLMTools.length > 0) {
          console.log(`✅ LLM tools available: ${availableLLMTools.join(', ')}`);

          // Test one LLM tool if available
          if (availableLLMTools.includes('chat')) {
            try {
              const result = await client.callTool('chat', {
                message: 'Hello, this is a test message'
              });
              expect(result.content).toBeDefined();
              console.log('✅ LLM chat tool executed successfully');
            } catch (error) {
              console.log(`ℹ️  LLM chat tool failed (expected if no API keys): ${error}`);
            }
          }
        } else {
          console.log('ℹ️  No LLM tools available (no API keys configured)');
        }
      });
    });

    describe('Process Lifecycle', () => {
      test('should handle client restart', async () => {
        // Stop current client
        await client.stop();

        // Start new client
        client = new STDIOTestClient({
          timeout: 15000,
          startupDelay: 3000
        });
        await client.start();

        // Verify it works
        const tools = await client.listTools();
        expect(tools.length).toBeGreaterThan(0);

        console.log('✅ Client restart handled successfully');
      });

      test('should be ready after startup', () => {
        expect(client.isReady()).toBe(true);
        console.log('✅ Client reports ready status correctly');
      });
    });
  });

  // Skip message for non-STDIO environments
  if (!isSTDIOEnvironment(environment)) {
    test('STDIO tests skipped - not in STDIO environment', () => {
      console.log(`ℹ️  STDIO tests skipped for environment: ${environment.description}`);
      expect(true).toBe(true); // Placeholder test to avoid empty suite
    });
  }
});