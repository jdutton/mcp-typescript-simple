/**
 * Unit tests for MCP Instance Manager
 *
 * Tests the just-in-time reconstruction pattern for horizontal scalability
 */

import { MCPInstanceManager } from '../../../src/server/mcp-instance-manager.js';
import { MemoryMCPMetadataStore } from '../../../src/session/memory-mcp-metadata-store.js';
import { LLMManager } from '@mcp-typescript-simple/tools-llm';
import { ToolRegistry } from '@mcp-typescript-simple/tools';
import { basicTools } from '@mcp-typescript-simple/example-tools-basic';
import { createLLMTools } from '@mcp-typescript-simple/example-tools-llm';
import { MCPSessionMetadata } from '../../../src/session/mcp-session-metadata-store-interface.js';

describe('MCPInstanceManager', () => {
  let manager: MCPInstanceManager;
  let metadataStore: MemoryMCPMetadataStore;
  let toolRegistry: ToolRegistry;

  beforeEach(async () => {
    metadataStore = new MemoryMCPMetadataStore();

    // Create tool registry with basic tools
    toolRegistry = new ToolRegistry();
    toolRegistry.merge(basicTools);

    // Try to add LLM tools (gracefully handle missing API keys)
    try {
      const llmManager = new LLMManager();
      await llmManager.initialize();
      toolRegistry.merge(createLLMTools(llmManager));
    } catch (error) {
      // Ignore - LLM tools will be unavailable but basic tools still work
    }

    manager = new MCPInstanceManager(toolRegistry, metadataStore);
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('storeSessionMetadata', () => {
    it('should store session metadata without auth', async () => {
      const sessionId = 'test-session-123';

      await manager.storeSessionMetadata(sessionId);

      const metadata = await metadataStore.getSession(sessionId);
      expect(metadata).not.toBeNull();
      expect(metadata?.sessionId).toBe(sessionId);
      expect(metadata?.authInfo).toBeUndefined();
    });

    it('should store session metadata with auth', async () => {
      const sessionId = 'test-session-456';
      const authInfo = {
        provider: 'google',
        userId: 'user-123',
        email: 'test@example.com',
      };

      await manager.storeSessionMetadata(sessionId, authInfo);

      const metadata = await metadataStore.getSession(sessionId);
      expect(metadata?.authInfo?.provider).toBe('google');
      expect(metadata?.authInfo?.userId).toBe('user-123');
    });
  });

  describe('getOrRecreateInstance', () => {
    it('should throw error for non-existent session', async () => {
      await expect(
        manager.getOrRecreateInstance('non-existent', {})
      ).rejects.toThrow('Session not found');
    });

    it('should recreate instance from metadata', async () => {
      const sessionId = 'test-session-789';

      // Store metadata first
      await manager.storeSessionMetadata(sessionId);

      // Get instance (should reconstruct)
      const instance = await manager.getOrRecreateInstance(sessionId, {});

      expect(instance).toBeDefined();
      expect(instance.sessionId).toBe(sessionId);
      expect(instance.server).toBeDefined();
      expect(instance.transport).toBeDefined();
      expect(instance.lastUsed).toBeGreaterThan(0);
    });

    it('should cache instance after reconstruction', async () => {
      const sessionId = 'test-session-cache';

      await manager.storeSessionMetadata(sessionId);

      // First call - reconstruct
      const instance1 = await manager.getOrRecreateInstance(sessionId, {});

      // Second call - should reuse from cache
      const instance2 = await manager.getOrRecreateInstance(sessionId, {});

      expect(instance1).toBe(instance2); // Same object reference
    });

    it('should update lastUsed timestamp on cache hit', async () => {
      const sessionId = 'test-session-timestamp';

      await manager.storeSessionMetadata(sessionId);

      const instance1 = await manager.getOrRecreateInstance(sessionId, {});
      const firstTimestamp = instance1.lastUsed;

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      const instance2 = await manager.getOrRecreateInstance(sessionId, {});
      const secondTimestamp = instance2.lastUsed;

      expect(secondTimestamp).toBeGreaterThan(firstTimestamp);
    });

    it('should reconstruct instance with auth info', async () => {
      const sessionId = 'test-session-auth';
      const authInfo = {
        provider: 'github',
        userId: 'user-456',
      };

      await manager.storeSessionMetadata(sessionId, authInfo);

      const instance = await manager.getOrRecreateInstance(sessionId, {});

      expect(instance).toBeDefined();
      expect(instance.sessionId).toBe(sessionId);

      // Verify metadata still has auth
      const metadata = await metadataStore.getSession(sessionId);
      expect(metadata?.authInfo?.provider).toBe('github');
    });
  });

  describe('getStats', () => {
    it('should return zero stats for empty cache', () => {
      const stats = manager.getStats();

      expect(stats.cachedInstances).toBe(0);
      expect(stats.oldestInstanceAge).toBe(0);
    });

    it('should return correct cached instance count', async () => {
      await manager.storeSessionMetadata('session-1');
      await manager.storeSessionMetadata('session-2');

      await manager.getOrRecreateInstance('session-1', {});
      await manager.getOrRecreateInstance('session-2', {});

      const stats = manager.getStats();
      expect(stats.cachedInstances).toBe(2);
    });

    it('should track oldest instance age', async () => {
      await manager.storeSessionMetadata('session-old');
      await manager.getOrRecreateInstance('session-old', {});

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = manager.getStats();
      expect(stats.oldestInstanceAge).toBeGreaterThan(0);
    });
  });

  describe('dispose', () => {
    it('should clear instance cache', async () => {
      await manager.storeSessionMetadata('session-1');
      await manager.getOrRecreateInstance('session-1', {});

      expect(manager.getStats().cachedInstances).toBe(1);

      manager.dispose();

      expect(manager.getStats().cachedInstances).toBe(0);
    });
  });
});
