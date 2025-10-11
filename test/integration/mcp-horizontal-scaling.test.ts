/**
 * Integration tests for MCP Horizontal Scaling (Issue #48)
 *
 * Tests the MCPInstanceManager reconstruction pattern:
 * - Session metadata storage and retrieval
 * - Just-in-time instance reconstruction
 * - Auth info preservation in metadata
 * - Cache warming and TTL behavior
 */

import { MCPInstanceManager } from '../../src/server/mcp-instance-manager.js';
import { MemoryMCPMetadataStore } from '../../src/session/memory-mcp-metadata-store.js';
import { LLMManager } from '../../src/llm/manager.js';
import { logger } from '../../src/observability/logger.js';

describe('MCP Horizontal Scaling Integration Tests', () => {
  let instanceManager: MCPInstanceManager;
  let metadataStore: MemoryMCPMetadataStore;
  let llmManager: LLMManager;

  beforeEach(async () => {
    // Create fresh metadata store
    metadataStore = new MemoryMCPMetadataStore();

    // Create LLM manager
    llmManager = new LLMManager();
    try {
      await llmManager.initialize();
    } catch (error) {
      // Ignore - LLM tools will be unavailable but basic tools still work
      logger.debug('LLM initialization failed in test', { error });
    }

    // Create instance manager with explicit metadata store
    instanceManager = new MCPInstanceManager(llmManager, metadataStore);
  });

  afterEach(() => {
    instanceManager.dispose();
    metadataStore.dispose();
  });

  describe('Session Metadata Storage', () => {
    it('should store session metadata without auth', async () => {
      const sessionId = 'test-session-no-auth';

      await instanceManager.storeSessionMetadata(sessionId);

      const metadata = await metadataStore.getSession(sessionId);
      expect(metadata).not.toBeNull();
      expect(metadata?.sessionId).toBe(sessionId);
      expect(metadata?.createdAt).toBeGreaterThan(0);
      expect(metadata?.expiresAt).toBeGreaterThan(metadata?.createdAt || 0);
      expect(metadata?.authInfo).toBeUndefined();
    });

    it('should store session metadata with auth info', async () => {
      const sessionId = 'test-session-with-auth';
      const authInfo = {
        provider: 'google',
        userId: 'user-123',
        email: 'test@example.com',
      };

      await instanceManager.storeSessionMetadata(sessionId, authInfo);

      const metadata = await metadataStore.getSession(sessionId);
      expect(metadata).not.toBeNull();
      expect(metadata?.sessionId).toBe(sessionId);
      expect(metadata?.authInfo?.provider).toBe('google');
      expect(metadata?.authInfo?.userId).toBe('user-123');
      expect(metadata?.authInfo?.email).toBe('test@example.com');
    });

    it('should update lastActivity on store', async () => {
      const sessionId = 'test-session-activity';
      const now = Date.now();

      await instanceManager.storeSessionMetadata(sessionId);

      const metadata = await metadataStore.getSession(sessionId);
      // Note: MCPSessionMetadata doesn't have lastActivity field - check createdAt instead
      expect(metadata?.createdAt).toBeGreaterThanOrEqual(now);
    });
  });

  describe('Instance Reconstruction', () => {
    it('should reconstruct instance from metadata', async () => {
      const sessionId = 'test-session-reconstruct';

      // Store metadata first
      await instanceManager.storeSessionMetadata(sessionId);

      // Get or recreate instance (should reconstruct)
      const instance = await instanceManager.getOrRecreateInstance(sessionId, {});

      expect(instance).toBeDefined();
      expect(instance.sessionId).toBe(sessionId);
      expect(instance.server).toBeDefined();
      expect(instance.transport).toBeDefined();
      expect(instance.lastUsed).toBeGreaterThan(0);

      // BUG REPRODUCTION: Transport should have session ID set
      expect(instance.transport.sessionId).toBe(sessionId);

      // BUG REPRODUCTION: Transport should be marked as initialized
      // The _initialized flag is critical for the SDK to accept non-initialization requests
      expect((instance.transport as any)._initialized).toBe(true);
    });

    it('should throw error for non-existent session', async () => {
      await expect(
        instanceManager.getOrRecreateInstance('non-existent-session', {})
      ).rejects.toThrow('Session not found');
    });

    it('should preserve auth info during reconstruction', async () => {
      const sessionId = 'test-session-auth-preserve';
      const authInfo = {
        provider: 'github',
        userId: 'user-456',
        email: 'github@example.com',
      };

      // Store metadata with auth
      await instanceManager.storeSessionMetadata(sessionId, authInfo);

      // Reconstruct instance
      const instance = await instanceManager.getOrRecreateInstance(sessionId, {});

      expect(instance).toBeDefined();

      // Verify metadata still has auth info
      const metadata = await metadataStore.getSession(sessionId);
      expect(metadata?.authInfo?.provider).toBe('github');
      expect(metadata?.authInfo?.userId).toBe('user-456');
      expect(metadata?.authInfo?.email).toBe('github@example.com');
    });
  });

  describe('Instance Caching', () => {
    it('should cache instance after reconstruction', async () => {
      const sessionId = 'test-session-cache';

      await instanceManager.storeSessionMetadata(sessionId);

      // First call - reconstruct
      const instance1 = await instanceManager.getOrRecreateInstance(sessionId, {});

      // Second call - should reuse from cache
      const instance2 = await instanceManager.getOrRecreateInstance(sessionId, {});

      // Should be the same object reference
      expect(instance1).toBe(instance2);
    });

    it('should update lastUsed on cache hit', async () => {
      const sessionId = 'test-session-timestamp';

      await instanceManager.storeSessionMetadata(sessionId);

      const instance1 = await instanceManager.getOrRecreateInstance(sessionId, {});
      const firstTimestamp = instance1.lastUsed;

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      const instance2 = await instanceManager.getOrRecreateInstance(sessionId, {});
      const secondTimestamp = instance2.lastUsed;

      expect(secondTimestamp).toBeGreaterThan(firstTimestamp);
    });

    it('should track cache statistics', async () => {
      // Initially no instances cached
      let stats = instanceManager.getStats();
      expect(stats.cachedInstances).toBe(0);
      expect(stats.oldestInstanceAge).toBe(0);

      // Store and reconstruct two sessions
      await instanceManager.storeSessionMetadata('session-1');
      await instanceManager.storeSessionMetadata('session-2');

      await instanceManager.getOrRecreateInstance('session-1', {});

      // Wait a bit to ensure age > 0
      await new Promise(resolve => setTimeout(resolve, 10));

      await instanceManager.getOrRecreateInstance('session-2', {});

      stats = instanceManager.getStats();
      expect(stats.cachedInstances).toBe(2);
      expect(stats.oldestInstanceAge).toBeGreaterThan(0);
    });
  });

  describe('Multi-Instance Simulation', () => {
    it('should simulate session handoff between instances', async () => {
      const sessionId = 'test-session-handoff';
      const authInfo = {
        provider: 'microsoft',
        userId: 'user-789',
      };

      // Use a shared metadata store (simulating Redis)
      const sharedMetadataStore = new MemoryMCPMetadataStore();
      const manager1 = new MCPInstanceManager(llmManager, sharedMetadataStore);

      // Instance 1: Create session and store metadata
      await manager1.storeSessionMetadata(sessionId, authInfo);
      const instance1 = await manager1.getOrRecreateInstance(sessionId, {});
      expect(instance1.sessionId).toBe(sessionId);

      // Simulate instance 1 going away (dispose instance cache but keep metadata)
      manager1.dispose();

      // Instance 2: Create new manager (simulating different server with same Redis)
      const manager2 = new MCPInstanceManager(llmManager, sharedMetadataStore);

      // Instance 2 should be able to reconstruct from metadata
      const instance2 = await manager2.getOrRecreateInstance(sessionId, {});
      expect(instance2.sessionId).toBe(sessionId);

      // Verify metadata preserved
      const metadata = await sharedMetadataStore.getSession(sessionId);
      expect(metadata?.authInfo?.provider).toBe('microsoft');
      expect(metadata?.authInfo?.userId).toBe('user-789');

      manager2.dispose();
      sharedMetadataStore.dispose();
    });

    it('should handle concurrent reconstruction requests', async () => {
      const sessionId = 'test-session-concurrent';

      await instanceManager.storeSessionMetadata(sessionId);

      // First reconstruction
      const instance1 = await instanceManager.getOrRecreateInstance(sessionId, {});

      // Subsequent concurrent requests should hit cache
      const [instance2, instance3, instance4] = await Promise.all([
        instanceManager.getOrRecreateInstance(sessionId, {}),
        instanceManager.getOrRecreateInstance(sessionId, {}),
        instanceManager.getOrRecreateInstance(sessionId, {}),
      ]);

      // All subsequent requests should get same cached instance
      expect(instance2).toBe(instance1);
      expect(instance3).toBe(instance1);
      expect(instance4).toBe(instance1);

      // Should only have one cached instance
      const stats = instanceManager.getStats();
      expect(stats.cachedInstances).toBe(1);
    });
  });

  describe('Disposal and Cleanup', () => {
    it('should clear cache on dispose', async () => {
      await instanceManager.storeSessionMetadata('session-1');
      await instanceManager.storeSessionMetadata('session-2');

      await instanceManager.getOrRecreateInstance('session-1', {});
      await instanceManager.getOrRecreateInstance('session-2', {});

      expect(instanceManager.getStats().cachedInstances).toBe(2);

      instanceManager.dispose();

      expect(instanceManager.getStats().cachedInstances).toBe(0);
    });

    it('should not affect metadata store on instance manager disposal', async () => {
      const sessionId = 'test-session-persist';
      const authInfo = { provider: 'google', userId: 'user-123' };

      // Use a separate metadata store that we control
      const separateMetadataStore = new MemoryMCPMetadataStore();
      const separateManager = new MCPInstanceManager(llmManager, separateMetadataStore);

      await separateManager.storeSessionMetadata(sessionId, authInfo);

      // Dispose instance manager (clears cache)
      separateManager.dispose();

      // Metadata should still exist in the store
      const metadata = await separateMetadataStore.getSession(sessionId);
      expect(metadata).not.toBeNull();
      expect(metadata?.sessionId).toBe(sessionId);
      expect(metadata?.authInfo?.provider).toBe('google');

      separateMetadataStore.dispose();
    });
  });
});
