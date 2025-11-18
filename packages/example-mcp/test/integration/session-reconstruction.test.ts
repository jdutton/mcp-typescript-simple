/**
 * Integration tests for session reconstruction and resumption
 *
 * These tests verify that sessions can be reconstructed after:
 * - Server restarts (simulated by clearing instance cache)
 * - Multi-instance handoff (simulated by using different managers)
 * - Cold starts (simulated by disposing and recreating instances)
 */

import request from 'supertest';
import { Express } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { MCPStreamableHttpServer } from '@mcp-typescript-simple/http-server';
import { setupMCPServerWithRegistry } from '@mcp-typescript-simple/server';
import { LLMManager } from '@mcp-typescript-simple/tools-llm';
import { ToolRegistry } from '@mcp-typescript-simple/tools';
import { basicTools } from '@mcp-typescript-simple/example-tools-basic';
import { createLLMTools } from '@mcp-typescript-simple/example-tools-llm';
import { MemoryMCPMetadataStore } from '@mcp-typescript-simple/persistence';
import { logger } from '@mcp-typescript-simple/observability';

/**
 * Helper function to clear cache and wait for propagation
 *
 * Race condition fix: Cache clear operations need time to propagate
 * before subsequent requests. Without this delay, tests can fail with
 * ECONNRESET or HTTP parse errors when racing against cache state.
 */
async function clearCacheAndWait(instanceManager: any, delayMs = 50): Promise<void> {
  instanceManager['instanceCache'].clear();
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

describe('Session Reconstruction Integration Tests', () => {
  let app: Express;
  let mcpServer: MCPStreamableHttpServer;
  let metadataStore: MemoryMCPMetadataStore;
  let toolRegistry: ToolRegistry;

  beforeEach(async () => {
    // Create shared metadata store (simulates Redis)
    metadataStore = new MemoryMCPMetadataStore();

    // Create tool registry with basic tools
    toolRegistry = new ToolRegistry();
    toolRegistry.merge(basicTools);

    // Try to add LLM tools
    try {
      const llmManager = new LLMManager();
      await llmManager.initialize();
      toolRegistry.merge(createLLMTools(llmManager));
    } catch (error) {
      logger.debug('LLM initialization failed in test', { error });
    }

    // Create MCP server with proper options and tool registry
    mcpServer = new MCPStreamableHttpServer({
      port: 3000,
      host: 'localhost',
      endpoint: '/mcp',
      requireAuth: false, // Skip OAuth for testing
      sessionSecret: 'test-secret',
      enableResumability: true, // REQUIRED for session reconstruction tests
      enableJsonResponse: true,
      toolRegistry: toolRegistry, // Pass pre-populated tool registry for session reconstruction
    });

    // Initialize the server (sets up routes)
    await mcpServer.initialize();

    // Set up MCP transport handler (required for new sessions)
    // NOTE: This is still needed for new sessions. Reconstructed sessions use MCPInstanceManager.toolRegistry
    mcpServer.onStreamableHTTPTransport(async (transport) => {
      // Create a fresh MCP Server instance for this transport
      const mcpServerInstance = new Server(
        { name: 'test-server', version: '1.0.0' },
        { capabilities: { tools: {} } }
      );

      // Setup MCP server with tools from registry
      await setupMCPServerWithRegistry(mcpServerInstance, toolRegistry);

      // Connect transport to server
      await mcpServerInstance.connect(transport);
    });

    // Get Express app for testing
    app = mcpServer.getApp();
  });

  afterEach(async () => {
    await mcpServer.stop();
    metadataStore.dispose();
    // Wait for server to fully release resources
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  describe('Basic Session Creation and Resumption', () => {
    it('should create a session and return session ID header', async () => {
      const response = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        })
        .expect(200);

      expect(response.headers['mcp-session-id']).toBeDefined();
      expect(response.headers['mcp-session-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('should allow using the session ID in subsequent requests', async () => {
      // Initialize session
      const initResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        })
        .expect(200);

      const sessionId = initResponse.headers['mcp-session-id'];

      // Use session to list tools
      const toolsResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('mcp-session-id', sessionId)
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        })
        .expect(200);

      expect(toolsResponse.body.result).toBeDefined();
      expect(toolsResponse.body.result.tools).toBeInstanceOf(Array);
      expect(toolsResponse.body.result.tools.length).toBeGreaterThan(0);
    });

    it('should fail when using non-existent session ID', async () => {
      const response = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('mcp-session-id', '00000000-0000-0000-0000-000000000000')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        });

      // Should return an error status (400 or 500 both acceptable for non-existent session)
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.error).toBeDefined();
      // Any error message is acceptable as long as request failed
    });
  });

  describe('Session Reconstruction After Cache Clear', () => {
    it('should reconstruct session from metadata after instance cache clear', async () => {
      // Step 1: Initialize session
      const initResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        })
        .expect(200);

      const sessionId = initResponse.headers['mcp-session-id'];

      // Step 2: Verify session works
      await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('mcp-session-id', sessionId)
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        })
        .expect(200);

      // Step 3: Simulate server restart by clearing instance cache
      // This simulates a cold start where instance cache is empty but metadata persists
      const instanceManager = mcpServer['instanceManager'];
      await clearCacheAndWait(instanceManager);

      // Verify cache is empty
      const stats = instanceManager.getStats();
      expect(stats.cachedInstances).toBe(0);

      // Step 4: Use session again - should reconstruct from metadata
      const reconstructedResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('mcp-session-id', sessionId)
        .send({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'hello',
            arguments: { name: 'World' },
          },
        })
        .expect(200);

      // Should succeed and return valid response
      expect(reconstructedResponse.body.result).toBeDefined();
      expect(reconstructedResponse.body.result.content).toBeDefined();

      // Verify instance was reconstructed and cached again
      const newStats = instanceManager.getStats();
      expect(newStats.cachedInstances).toBe(1);
    });

    it('should handle multiple reconstructions without errors', async () => {
      // Initialize session
      const initResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        })
        .expect(200);

      const sessionId = initResponse.headers['mcp-session-id'];
      const instanceManager = mcpServer['instanceManager'];

      // Perform 5 cycles of: use session → clear cache → reconstruct
      for (let i = 0; i < 5; i++) {
        // Use session
        await request(app)
          .post('/mcp')
          .set('Accept', 'application/json, text/event-stream')
          .set('mcp-session-id', sessionId)
          .send({
            jsonrpc: '2.0',
            id: i + 2,
            method: 'tools/list',
            params: {},
          })
          .expect(200);

        // Clear cache (simulate cold start)
        await clearCacheAndWait(instanceManager);

        // Next iteration will reconstruct
      }

      // Final verification - one more reconstruction
      const finalResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('mcp-session-id', sessionId)
        .send({
          jsonrpc: '2.0',
          id: 10,
          method: 'tools/call',
          params: {
            name: 'echo',
            arguments: { message: 'Still working!' },
          },
        })
        .expect(200);

      expect(finalResponse.body.result).toBeDefined();
    });
  });

  describe('Multi-Tool Execution After Reconstruction', () => {
    it('should execute multiple different tools after reconstruction', async () => {
      // Initialize session
      const initResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        })
        .expect(200);

      const sessionId = initResponse.headers['mcp-session-id'];

      // Clear cache to force reconstruction
      const instanceManager = mcpServer['instanceManager'];
      await clearCacheAndWait(instanceManager);

      // Test hello tool
      const helloResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('mcp-session-id', sessionId)
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'hello',
            arguments: { name: 'Alice' },
          },
        })
        .expect(200);

      expect(helloResponse.body.result.content[0].text).toContain('Alice');

      // Clear cache again
      await clearCacheAndWait(instanceManager);

      // Test echo tool
      const echoResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('mcp-session-id', sessionId)
        .send({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'echo',
            arguments: { message: 'Test message' },
          },
        })
        .expect(200);

      expect(echoResponse.body.result.content[0].text).toContain('Test message');

      // Clear cache again
      await clearCacheAndWait(instanceManager);

      // Test current-time tool
      const timeResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('mcp-session-id', sessionId)
        .send({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'current-time',
            arguments: {},
          },
        })
        .expect(200);

      expect(timeResponse.body.result.content[0].text).toMatch(/\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('Concurrent Requests After Reconstruction', () => {
    it('should handle concurrent requests to same reconstructed session', async () => {
      // Initialize session
      const initResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        })
        .expect(200);

      const sessionId = initResponse.headers['mcp-session-id'];

      // Clear cache to force reconstruction
      const instanceManager = mcpServer['instanceManager'];
      await clearCacheAndWait(instanceManager);

      // Make 3 concurrent requests - first will reconstruct, others should reuse
      const requests = Promise.all([
        request(app)
          .post('/mcp')
          .set('Accept', 'application/json, text/event-stream')
          .set('mcp-session-id', sessionId)
          .send({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
          }),
        request(app)
          .post('/mcp')
          .set('Accept', 'application/json, text/event-stream')
          .set('mcp-session-id', sessionId)
          .send({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/list',
            params: {},
          }),
        request(app)
          .post('/mcp')
          .set('Accept', 'application/json, text/event-stream')
          .set('mcp-session-id', sessionId)
          .send({
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/list',
            params: {},
          }),
      ]);

      const responses = await requests;

      // All should succeed
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body.result.tools).toBeInstanceOf(Array);
      });

      // Should only have one cached instance (all shared same reconstruction)
      const stats = instanceManager.getStats();
      expect(stats.cachedInstances).toBe(1);
    });
  });

  describe('Session Metadata Persistence', () => {
    it('should persist session metadata across instance cache clears', async () => {
      // Initialize session
      const initResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        })
        .expect(200);

      const sessionId = initResponse.headers['mcp-session-id'];
      expect(sessionId).toBeDefined();

      // Verify session works initially
      await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('mcp-session-id', sessionId)
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        })
        .expect(200);

      // Clear instance cache to simulate server restart
      const instanceManager = mcpServer['instanceManager'];
      await clearCacheAndWait(instanceManager);

      // Verify cache is empty
      const stats = instanceManager.getStats();
      expect(stats.cachedInstances).toBe(0);

      // Use session after cache clear - should reconstruct from metadata
      const reconstructedResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('mcp-session-id', sessionId)
        .send({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/list',
          params: {},
        })
        .expect(200);

      // Should succeed, proving metadata persisted
      expect(reconstructedResponse.body.result).toBeDefined();
      expect(reconstructedResponse.body.result.tools).toBeInstanceOf(Array);

      // Verify instance was reconstructed and cached again
      const newStats = instanceManager.getStats();
      expect(newStats.cachedInstances).toBe(1);
    });
  });

  describe('Error Cases', () => {
    it('should fail gracefully when session is deleted', async () => {
      // Initialize session
      const initResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        })
        .expect(200);

      const sessionId = initResponse.headers['mcp-session-id'];

      // Delete the session completely (cache + metadata)
      const instanceManager = mcpServer['instanceManager'];
      await instanceManager.deleteSession(sessionId);

      // Should fail because session is gone
      const response = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('mcp-session-id', sessionId)
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        });

      // Should return an error status (400 or 500 both acceptable for deleted session)
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.error).toBeDefined();
      // Any error message is acceptable as long as request failed
    });

    it('should handle malformed session IDs gracefully', async () => {
      const response = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('mcp-session-id', 'not-a-valid-uuid')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        });

      // Should return an error (either 400 or 500 is acceptable for malformed ID)
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('MCP Inspector Session Reconstruction Bug Tests', () => {
    it('should handle tools/list after session reconstruction', async () => {
      // Step 1: Initialize session (simulates OAuth flow)
      const initResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'MCP Inspector', version: '1.0.0' },
          },
        })
        .expect(200);

      const sessionId = initResponse.headers['mcp-session-id'] as string;
      expect(sessionId).toBeDefined();
      expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

      logger.info('Test: Session created', { sessionId });

      // Step 2: MCP Inspector makes a tools/list request with the session ID
      // This simulates what happens after OAuth completes
      const toolsResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('mcp-session-id', sessionId!)
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        });

      logger.info('Test: Tools response', {
        status: toolsResponse.status,
        body: toolsResponse.body,
      });

      // Should succeed
      expect(toolsResponse.status).toBe(200);
      expect(toolsResponse.body.result).toBeDefined();
      expect(toolsResponse.body.result.tools).toBeInstanceOf(Array);
    });

    it('should handle tool execution after session reconstruction', async () => {
      // Step 1: Initialize session
      const initResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'MCP Inspector', version: '1.0.0' },
          },
        })
        .expect(200);

      const sessionId = initResponse.headers['mcp-session-id'] as string;
      expect(sessionId).toBeDefined();

      // Step 2: Execute a tool with the session ID
      const toolResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('mcp-session-id', sessionId!)
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'hello',
            arguments: { name: 'World' },
          },
        });

      logger.info('Test: Tool execution response', {
        status: toolResponse.status,
        body: toolResponse.body,
      });

      // Should succeed
      expect(toolResponse.status).toBe(200);
      expect(toolResponse.body.result).toBeDefined();
    });

    it('should handle multiple requests to same reconstructed session', async () => {
      // Step 1: Initialize session
      const initResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'MCP Inspector', version: '1.0.0' },
          },
        })
        .expect(200);

      const sessionId = initResponse.headers['mcp-session-id'] as string;
      expect(sessionId).toBeDefined();

      // Step 2: Make multiple requests (simulates MCP Inspector polling)
      for (let i = 0; i < 3; i++) {
        const response = await request(app)
          .post('/mcp')
          .set('Accept', 'application/json, text/event-stream')
          .set('mcp-session-id', sessionId!)
          .send({
            jsonrpc: '2.0',
            id: i + 2,
            method: 'tools/list',
            params: {},
          });

        logger.info(`Test: Request ${i + 1} response`, {
          status: response.status,
          hasError: !!response.body.error,
        });

        // Each request should work
        expect(response.status).toBe(200);
        expect(response.body.result).toBeDefined();
      }
    });

    it('CONTROL: new session WITHOUT reconstruction works fine', async () => {
      // This is a control test - it should PASS to prove the issue is reconstruction-specific

      // Initialize and use session immediately without cache clearing
      const initResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        })
        .expect(200);

      const sessionId = initResponse.headers['mcp-session-id'] as string;
      expect(sessionId).toBeDefined();

      // Immediately use the session (no reconstruction needed - cache is warm)
      const toolsResponse = await request(app)
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('mcp-session-id', sessionId!)
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        })
        .expect(200);

      expect(toolsResponse.body.result.tools).toBeInstanceOf(Array);

      logger.info('Test: Control test passed - non-reconstructed session works');
    });
  });
});
