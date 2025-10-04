/**
 * Test to reproduce the MCP Inspector session reconstruction bug
 *
 * Bug: When MCP Inspector makes requests after OAuth authentication,
 * the session is reconstructed but requests fail with "Server not initialized"
 *
 * This test simulates the exact flow:
 * 1. Initialize session (OAuth flow creates it)
 * 2. Make a second request with the session ID
 * 3. The second request should reconstruct the session and work
 *
 * Expected: Should work ✅
 * Actual: Fails with "Server not initialized" ❌
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import request from 'supertest';
import { Express } from 'express';
import { MCPStreamableHttpServer } from '../../src/server/streamable-http-server.js';
import { LLMManager } from '../../src/llm/manager.js';
import { MemoryMCPMetadataStore } from '../../src/session/memory-mcp-metadata-store.js';
import { logger } from '../../src/observability/logger.js';

describe('MCP Inspector Session Reconstruction Bug', () => {
  let app: Express;
  let mcpServer: MCPStreamableHttpServer;
  let metadataStore: MemoryMCPMetadataStore;
  let llmManager: LLMManager;

  beforeEach(async () => {
    // Create shared metadata store
    metadataStore = new MemoryMCPMetadataStore();

    // Create LLM manager
    llmManager = new LLMManager();
    try {
      await llmManager.initialize();
    } catch (error) {
      logger.debug('LLM initialization failed in test', { error });
    }

    // Create MCP server (without OAuth for testing)
    mcpServer = new MCPStreamableHttpServer({
      endpoint: '/mcp',
      enableResumability: false,
      enableJsonResponse: true,
      // No OAuth setup - simulates skipAuth mode
      llmManager,
    });

    app = mcpServer['app'];
  });

  afterEach(() => {
    metadataStore.dispose();
  });

  it('REPRODUCES BUG: should handle tools/list after session reconstruction', async () => {
    // Step 1: Initialize session (simulates OAuth flow)
    const initResponse = await request(app)
      .post('/mcp')
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

    // THIS IS WHERE THE BUG MANIFESTS
    // Expected: 200 with tools list
    // Actual: 400 with "Server not initialized"
    expect(toolsResponse.status).toBe(200);
    expect(toolsResponse.body.result).toBeDefined();
    expect(toolsResponse.body.result.tools).toBeInstanceOf(Array);
  });

  it('REPRODUCES BUG: should handle tool execution after session reconstruction', async () => {
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
          clientInfo: { name: 'MCP Inspector', version: '1.0.0' },
        },
      })
      .expect(200);

    const sessionId = initResponse.headers['mcp-session-id'] as string;
    expect(sessionId).toBeDefined();

    // Step 2: Execute a tool with the session ID
    const toolResponse = await request(app)
      .post('/mcp')
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

    // THIS IS WHERE THE BUG MANIFESTS
    expect(toolResponse.status).toBe(200);
    expect(toolResponse.body.result).toBeDefined();
  });

  it('REPRODUCES BUG: should handle multiple requests to same reconstructed session', async () => {
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
