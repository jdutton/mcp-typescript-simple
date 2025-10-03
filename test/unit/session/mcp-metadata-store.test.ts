/**
 * Unit tests for MCP Session Metadata Stores
 *
 * Tests all store implementations:
 * - MemoryMCPMetadataStore (in-memory, single-instance)
 * - VercelKVMCPMetadataStore (Redis-backed, multi-instance)
 * - MCPMetadataStoreFactory (auto-detection and creation)
 */

import { MemoryMCPMetadataStore } from '../../../src/session/memory-mcp-metadata-store.js';
import { MCPSessionMetadata } from '../../../src/session/mcp-session-metadata-store-interface.js';
import { MCPMetadataStoreFactory } from '../../../src/session/mcp-metadata-store-factory.js';

describe('MemoryMCPMetadataStore', () => {
  let store: MemoryMCPMetadataStore;

  beforeEach(() => {
    store = new MemoryMCPMetadataStore();
  });

  afterEach(() => {
    store.dispose();
  });

  describe('storeSession', () => {
    it('should store session metadata', async () => {
      const metadata: MCPSessionMetadata = {
        sessionId: 'test-session-123',
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await store.storeSession('test-session-123', metadata);

      const retrieved = await store.getSession('test-session-123');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.sessionId).toBe('test-session-123');
    });

    it('should store session with auth info', async () => {
      const metadata: MCPSessionMetadata = {
        sessionId: 'test-session-456',
        createdAt: Date.now(),
        lastActivity: Date.now(),
        authInfo: {
          provider: 'google',
          userId: 'user-123',
          email: 'test@example.com',
        },
      };

      await store.storeSession('test-session-456', metadata);

      const retrieved = await store.getSession('test-session-456');
      expect(retrieved?.authInfo?.provider).toBe('google');
      expect(retrieved?.authInfo?.userId).toBe('user-123');
    });

    it('should store session with events', async () => {
      const metadata: MCPSessionMetadata = {
        sessionId: 'test-session-789',
        createdAt: Date.now(),
        lastActivity: Date.now(),
        events: [
          {
            eventId: 'event-1',
            streamId: 'stream-1',
            message: { jsonrpc: '2.0', method: 'test' },
            timestamp: Date.now(),
          },
        ],
      };

      await store.storeSession('test-session-789', metadata);

      const retrieved = await store.getSession('test-session-789');
      expect(retrieved?.events).toHaveLength(1);
      expect(retrieved?.events?.[0]?.eventId).toBe('event-1');
    });

    it('should update lastActivity timestamp on store', async () => {
      const now = Date.now();
      const metadata: MCPSessionMetadata = {
        sessionId: 'test-session-timestamp',
        createdAt: now,
        lastActivity: now - 1000, // 1 second ago
      };

      await store.storeSession('test-session-timestamp', metadata);

      const retrieved = await store.getSession('test-session-timestamp');
      expect(retrieved?.lastActivity).toBeGreaterThanOrEqual(now);
    });
  });

  describe('getSession', () => {
    it('should return null for non-existent session', async () => {
      const retrieved = await store.getSession('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should retrieve stored session', async () => {
      const metadata: MCPSessionMetadata = {
        sessionId: 'test-session-get',
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await store.storeSession('test-session-get', metadata);
      const retrieved = await store.getSession('test-session-get');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.sessionId).toBe('test-session-get');
    });

    it('should return null for expired session', async () => {
      const expiredTime = Date.now() - 31 * 60 * 1000; // 31 minutes ago
      const metadata: MCPSessionMetadata = {
        sessionId: 'test-session-expired',
        createdAt: expiredTime,
        lastActivity: expiredTime,
      };

      await store.storeSession('test-session-expired', metadata);

      const retrieved = await store.getSession('test-session-expired');
      expect(retrieved).toBeNull();
    });
  });

  describe('updateActivity', () => {
    it('should update lastActivity timestamp', async () => {
      const now = Date.now();
      const metadata: MCPSessionMetadata = {
        sessionId: 'test-session-activity',
        createdAt: now,
        lastActivity: now,
      };

      await store.storeSession('test-session-activity', metadata);

      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));

      await store.updateActivity('test-session-activity');

      const retrieved = await store.getSession('test-session-activity');
      expect(retrieved?.lastActivity).toBeGreaterThan(now);
    });

    it('should handle update for non-existent session', async () => {
      await expect(store.updateActivity('non-existent')).resolves.not.toThrow();
    });
  });

  describe('deleteSession', () => {
    it('should delete session', async () => {
      const metadata: MCPSessionMetadata = {
        sessionId: 'test-session-delete',
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };

      await store.storeSession('test-session-delete', metadata);
      await store.deleteSession('test-session-delete');

      const retrieved = await store.getSession('test-session-delete');
      expect(retrieved).toBeNull();
    });

    it('should handle delete for non-existent session', async () => {
      await expect(store.deleteSession('non-existent')).resolves.not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should remove expired sessions', async () => {
      const now = Date.now();
      const expiredTime = now - 31 * 60 * 1000; // 31 minutes ago

      // Store active session
      await store.storeSession('active-session', {
        sessionId: 'active-session',
        createdAt: now,
        lastActivity: now,
      });

      // Store expired session
      await store.storeSession('expired-session', {
        sessionId: 'expired-session',
        createdAt: expiredTime,
        lastActivity: expiredTime,
      });

      const cleanedCount = await store.cleanup();

      expect(cleanedCount).toBe(1);
      expect(await store.getSession('active-session')).not.toBeNull();
      expect(await store.getSession('expired-session')).toBeNull();
    });

    it('should return 0 when no sessions to clean', async () => {
      const cleanedCount = await store.cleanup();
      expect(cleanedCount).toBe(0);
    });
  });

  describe('getSessionCount', () => {
    it('should return 0 for empty store', async () => {
      const count = await store.getSessionCount();
      expect(count).toBe(0);
    });

    it('should return correct count', async () => {
      await store.storeSession('session-1', {
        sessionId: 'session-1',
        createdAt: Date.now(),
        lastActivity: Date.now(),
      });

      await store.storeSession('session-2', {
        sessionId: 'session-2',
        createdAt: Date.now(),
        lastActivity: Date.now(),
      });

      const count = await store.getSessionCount();
      expect(count).toBe(2);
    });
  });

  describe('dispose', () => {
    it('should clear all sessions', async () => {
      await store.storeSession('test-session', {
        sessionId: 'test-session',
        createdAt: Date.now(),
        lastActivity: Date.now(),
      });

      store.dispose();

      const count = await store.getSessionCount();
      expect(count).toBe(0);
    });
  });
});

describe('MCPMetadataStoreFactory', () => {
  describe('create', () => {
    it('should create memory store when type is memory', () => {
      const store = MCPMetadataStoreFactory.create({ type: 'memory' });
      expect(store).toBeInstanceOf(MemoryMCPMetadataStore);
      store.dispose();
    });

    it('should create memory store by default (auto-detection)', () => {
      // Save original env vars
      const originalVercel = process.env.VERCEL;
      const originalKvUrl = process.env.KV_REST_API_URL;
      const originalKvToken = process.env.KV_REST_API_TOKEN;
      const originalRedisUrl = process.env.REDIS_URL;

      // Clear Vercel/Redis env vars
      delete process.env.VERCEL;
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      delete process.env.REDIS_URL;

      const store = MCPMetadataStoreFactory.create({ type: 'auto' });
      expect(store).toBeInstanceOf(MemoryMCPMetadataStore);
      store.dispose();

      // Restore env vars
      if (originalVercel) process.env.VERCEL = originalVercel;
      if (originalKvUrl) process.env.KV_REST_API_URL = originalKvUrl;
      if (originalKvToken) process.env.KV_REST_API_TOKEN = originalKvToken;
      if (originalRedisUrl) process.env.REDIS_URL = originalRedisUrl;
    });

    it('should throw error for unknown store type', () => {
      expect(() => {
        MCPMetadataStoreFactory.create({ type: 'unknown' as any });
      }).toThrow('Unknown MCP metadata store type: unknown');
    });

    it('should throw error for vercel-kv without environment variables', () => {
      // Save original env vars
      const originalKvUrl = process.env.KV_REST_API_URL;
      const originalKvToken = process.env.KV_REST_API_TOKEN;

      // Clear Vercel KV env vars
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;

      expect(() => {
        MCPMetadataStoreFactory.create({ type: 'vercel-kv' });
      }).toThrow('Vercel KV environment variables not configured');

      // Restore env vars
      if (originalKvUrl) process.env.KV_REST_API_URL = originalKvUrl;
      if (originalKvToken) process.env.KV_REST_API_TOKEN = originalKvToken;
    });
  });

  describe('validateEnvironment', () => {
    it('should validate memory store as valid with warnings', () => {
      const result = MCPMetadataStoreFactory.validateEnvironment('memory');

      expect(result.valid).toBe(true);
      expect(result.storeType).toBe('memory');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should validate vercel-kv as invalid without env vars', () => {
      // Save original env vars
      const originalKvUrl = process.env.KV_REST_API_URL;
      const originalKvToken = process.env.KV_REST_API_TOKEN;

      // Clear Vercel KV env vars
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;

      const result = MCPMetadataStoreFactory.validateEnvironment('vercel-kv');

      expect(result.valid).toBe(false);
      expect(result.storeType).toBe('vercel-kv');
      expect(result.warnings).toContain('Vercel KV environment variables not configured');

      // Restore env vars
      if (originalKvUrl) process.env.KV_REST_API_URL = originalKvUrl;
      if (originalKvToken) process.env.KV_REST_API_TOKEN = originalKvToken;
    });

    it('should auto-detect memory store when no external stores configured', () => {
      // Save original env vars
      const originalVercel = process.env.VERCEL;
      const originalKvUrl = process.env.KV_REST_API_URL;
      const originalKvToken = process.env.KV_REST_API_TOKEN;
      const originalRedisUrl = process.env.REDIS_URL;

      // Clear all external store env vars
      delete process.env.VERCEL;
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      delete process.env.REDIS_URL;

      const result = MCPMetadataStoreFactory.validateEnvironment('auto');

      expect(result.valid).toBe(true);
      expect(result.storeType).toBe('memory');
      expect(result.warnings.some(w => w.includes('does not persist'))).toBe(true);

      // Restore env vars
      if (originalVercel) process.env.VERCEL = originalVercel;
      if (originalKvUrl) process.env.KV_REST_API_URL = originalKvUrl;
      if (originalKvToken) process.env.KV_REST_API_TOKEN = originalKvToken;
      if (originalRedisUrl) process.env.REDIS_URL = originalRedisUrl;
    });
  });
});
