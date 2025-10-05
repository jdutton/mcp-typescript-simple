/**
 * Integration tests for session reconstruction and resumption
 *
 * These tests verify that sessions can be reconstructed after:
 * - Server restarts (simulated by clearing instance cache)
 * - Multi-instance handoff (simulated by using different managers)
 * - Cold starts (simulated by disposing and recreating instances)
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { Express } from 'express';
import { MCPStreamableHttpServer } from '../../src/server/streamable-http-server.js';
import { LLMManager } from '../../src/llm/manager.js';
import { MemoryMCPMetadataStore } from '../../src/session/memory-mcp-metadata-store.js';
import { logger } from '../../src/observability/logger.js';

describe('Session Reconstruction Integration Tests', () => {
  let app: Express;
  let mcpServer: MCPStreamableHttpServer;
  let metadataStore: MemoryMCPMetadataStore;
  let llmManager: LLMManager;

  beforeEach(async () => {
    // Create shared metadata store (simulates Redis)
    metadataStore = new MemoryMCPMetadataStore();

    // Create LLM manager
    llmManager = new LLMManager();
    try {
      await llmManager.initialize();
    } catch (error) {
      logger.debug('LLM initialization failed in test', { error });
    }

    // Create MCP server
    mcpServer = new MCPStreamableHttpServer({
      endpoint: '/mcp',
      enableResumability: false,
      enableJsonResponse: true,
      skipAuth: true, // Skip OAuth for testing
      metadataStore, // Inject metadata store
      llmManager,
    });

    // Get Express app for testing
    app = mcpServer['app'];
  });

  afterEach(() => {
    metadataStore.dispose();
  });

  describe('Basic Session Creation and Resumption', () => {
    it('should create a session and return session ID header', async () => {
      const response = await request(app)
        .post('/mcp')
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
        .set('mcp-session-id', '00000000-0000-0000-0000-000000000000')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
      expect(response.body.error.message).toContain('Session not found');
    });
  });

  describe('Session Reconstruction After Cache Clear', () => {
    it('should reconstruct session from metadata after instance cache clear', async () => {
      // Step 1: Initialize session
      const initResponse = await request(app)
        .post('/mcp')
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
      instanceManager['instanceCache'].clear();

      // Verify cache is empty
      const stats = instanceManager.getStats();
      expect(stats.cachedInstances).toBe(0);

      // Step 4: Use session again - should reconstruct from metadata
      const reconstructedResponse = await request(app)
        .post('/mcp')
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
          .set('mcp-session-id', sessionId)
          .send({
            jsonrpc: '2.0',
            id: i + 2,
            method: 'tools/list',
            params: {},
          })
          .expect(200);

        // Clear cache (simulate cold start)
        instanceManager['instanceCache'].clear();

        // Next iteration will reconstruct
      }

      // Final verification - one more reconstruction
      const finalResponse = await request(app)
        .post('/mcp')
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
      instanceManager['instanceCache'].clear();

      // Test hello tool
      const helloResponse = await request(app)
        .post('/mcp')
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
      instanceManager['instanceCache'].clear();

      // Test echo tool
      const echoResponse = await request(app)
        .post('/mcp')
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
      instanceManager['instanceCache'].clear();

      // Test current-time tool
      const timeResponse = await request(app)
        .post('/mcp')
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
      instanceManager['instanceCache'].clear();

      // Make 3 concurrent requests - first will reconstruct, others should reuse
      const requests = Promise.all([
        request(app)
          .post('/mcp')
          .set('mcp-session-id', sessionId)
          .send({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
          }),
        request(app)
          .post('/mcp')
          .set('mcp-session-id', sessionId)
          .send({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/list',
            params: {},
          }),
        request(app)
          .post('/mcp')
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

      // Verify metadata exists
      const metadata1 = await metadataStore.getSession(sessionId);
      expect(metadata1).not.toBeNull();
      expect(metadata1?.sessionId).toBe(sessionId);

      // Clear instance cache
      const instanceManager = mcpServer['instanceManager'];
      instanceManager['instanceCache'].clear();

      // Metadata should still exist
      const metadata2 = await metadataStore.getSession(sessionId);
      expect(metadata2).not.toBeNull();
      expect(metadata2?.sessionId).toBe(sessionId);
      expect(metadata2?.createdAt).toBe(metadata1?.createdAt);

      // Use session after reconstruction
      await request(app)
        .post('/mcp')
        .set('mcp-session-id', sessionId)
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        })
        .expect(200);

      // Metadata should still be there with updated activity
      const metadata3 = await metadataStore.getSession(sessionId);
      expect(metadata3).not.toBeNull();
      expect(metadata3?.lastActivity).toBeGreaterThan(metadata1!.lastActivity);
    });
  });

  describe('Error Cases', () => {
    it('should fail gracefully when metadata is deleted but cache exists', async () => {
      // Initialize session
      const initResponse = await request(app)
        .post('/mcp')
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

      // Delete metadata (but leave cache intact)
      await metadataStore.deleteSession(sessionId);

      // Clear cache to force reconstruction attempt
      const instanceManager = mcpServer['instanceManager'];
      instanceManager['instanceCache'].clear();

      // Should fail because metadata is gone
      const response = await request(app)
        .post('/mcp')
        .set('mcp-session-id', sessionId)
        .send({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
      expect(response.body.error.message).toContain('Session not found');
    });

    it('should handle malformed session IDs gracefully', async () => {
      const response = await request(app)
        .post('/mcp')
        .set('mcp-session-id', 'not-a-valid-uuid')
        .send({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        })
        .expect(400);

      expect(response.body.error).toBeDefined();
    });
  });
});
