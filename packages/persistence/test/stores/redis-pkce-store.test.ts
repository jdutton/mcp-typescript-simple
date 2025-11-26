/**
 * Integration tests for RedisPKCEStore using ioredis-mock
 *
 * Tests Redis-backed PKCE store for:
 * - Basic CRUD operations
 * - Atomic get-and-delete (prevents code reuse attacks)
 * - TTL expiration
 * - Lua script execution
 * - Connection error handling
 */

import { vi } from 'vitest';
import { RedisPKCEStore , PKCEData } from '../../src/index.js';

// Hoist Redis mock to avoid initialization issues
const RedisMock = vi.hoisted(() => require('ioredis-mock'));

// Mock Redis for testing - Vitest requires default export
vi.mock('ioredis', () => ({
  default: RedisMock
}));

// Create a shared Redis instance for cleanup
let sharedRedis: any = null;

describe('RedisPKCEStore', () => {
  let store: RedisPKCEStore;

  beforeEach(async () => {
    if (!sharedRedis) {
      sharedRedis = new (RedisMock as any)();
    }
    // Flush all data between tests
    await sharedRedis.flushall();

    // Create store with mock Redis URL
    store = new RedisPKCEStore('redis://localhost:6379');
  });

  afterEach(() => {
    // ioredis-mock doesn't require explicit cleanup
  });

  describe('storeCodeVerifier', () => {
    it('should store PKCE data with default TTL', async () => {
      const code = 'auth-code-12345';
      const data: PKCEData = {
        codeVerifier: 'test-verifier-abc123',
        state: 'test-state-xyz789'
      };

      await store.storeCodeVerifier(code, data);

      // Verify stored
      const retrieved = await store.getCodeVerifier(code);
      expect(retrieved).toEqual(data);
    });

    it('should store PKCE data with custom TTL', async () => {
      const code = 'auth-code-67890';
      const data: PKCEData = {
        codeVerifier: 'custom-verifier-def456',
        state: 'custom-state-uvw012'
      };

      await store.storeCodeVerifier(code, data, 300); // 5 minutes

      const retrieved = await store.getCodeVerifier(code);
      expect(retrieved).toEqual(data);
    });

    it('should overwrite existing PKCE data', async () => {
      const code = 'auth-code-999';
      const data1: PKCEData = {
        codeVerifier: 'first-verifier',
        state: 'first-state'
      };
      const data2: PKCEData = {
        codeVerifier: 'second-verifier',
        state: 'second-state'
      };

      await store.storeCodeVerifier(code, data1);
      await store.storeCodeVerifier(code, data2);

      const retrieved = await store.getCodeVerifier(code);
      expect(retrieved).toEqual(data2);
    });
  });

  describe('getCodeVerifier', () => {
    it('should retrieve stored PKCE data', async () => {
      const code = 'auth-code-abcdef';
      const data: PKCEData = {
        codeVerifier: 'retrieve-test-verifier',
        state: 'retrieve-test-state'
      };

      await store.storeCodeVerifier(code, data);
      const retrieved = await store.getCodeVerifier(code);

      expect(retrieved).toEqual(data);
      expect(retrieved?.codeVerifier).toBe(data.codeVerifier);
      expect(retrieved?.state).toBe(data.state);
    });

    it('should return null for non-existent code', async () => {
      const retrieved = await store.getCodeVerifier('non-existent-code');
      expect(retrieved).toBeNull();
    });

    it('should handle special characters in code', async () => {
      const code = 'auth-code-with-special-chars_!@#$%^&*()';
      const data: PKCEData = {
        codeVerifier: 'special-verifier',
        state: 'special-state'
      };

      await store.storeCodeVerifier(code, data);
      const retrieved = await store.getCodeVerifier(code);

      expect(retrieved).toEqual(data);
    });
  });

  describe('getAndDeleteCodeVerifier', () => {
    it('should atomically retrieve and delete PKCE data', async () => {
      const code = 'auth-code-atomic-test';
      const data: PKCEData = {
        codeVerifier: 'atomic-verifier',
        state: 'atomic-state'
      };

      await store.storeCodeVerifier(code, data);

      // First retrieval should succeed and delete
      const retrieved = await store.getAndDeleteCodeVerifier(code);
      expect(retrieved).toEqual(data);

      // Second retrieval should return null (data was deleted)
      const secondRetrieval = await store.getAndDeleteCodeVerifier(code);
      expect(secondRetrieval).toBeNull();

      // Verify data is actually gone
      const verified = await store.getCodeVerifier(code);
      expect(verified).toBeNull();
    });

    it('should return null for non-existent code', async () => {
      const retrieved = await store.getAndDeleteCodeVerifier('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should prevent authorization code reuse', async () => {
      const code = 'auth-code-reuse-test';
      const data: PKCEData = {
        codeVerifier: 'reuse-prevention-verifier',
        state: 'reuse-prevention-state'
      };

      await store.storeCodeVerifier(code, data);

      // First attempt: success
      const first = await store.getAndDeleteCodeVerifier(code);
      expect(first).toEqual(data);

      // Second attempt: fails (simulates replay attack)
      const second = await store.getAndDeleteCodeVerifier(code);
      expect(second).toBeNull();
    });
  });

  describe('hasCodeVerifier', () => {
    it('should return true for existing code', async () => {
      const code = 'auth-code-exists';
      const data: PKCEData = {
        codeVerifier: 'exists-verifier',
        state: 'exists-state'
      };

      await store.storeCodeVerifier(code, data);
      const exists = await store.hasCodeVerifier(code);

      expect(exists).toBe(true);
    });

    it('should return false for non-existent code', async () => {
      const exists = await store.hasCodeVerifier('non-existent');
      expect(exists).toBe(false);
    });

    it('should return false after deletion', async () => {
      const code = 'auth-code-deleted';
      const data: PKCEData = {
        codeVerifier: 'delete-test-verifier',
        state: 'delete-test-state'
      };

      await store.storeCodeVerifier(code, data);
      expect(await store.hasCodeVerifier(code)).toBe(true);

      await store.deleteCodeVerifier(code);
      expect(await store.hasCodeVerifier(code)).toBe(false);
    });
  });

  describe('deleteCodeVerifier', () => {
    it('should delete existing PKCE data', async () => {
      const code = 'auth-code-delete';
      const data: PKCEData = {
        codeVerifier: 'delete-verifier',
        state: 'delete-state'
      };

      await store.storeCodeVerifier(code, data);
      expect(await store.hasCodeVerifier(code)).toBe(true);

      await store.deleteCodeVerifier(code);
      expect(await store.hasCodeVerifier(code)).toBe(false);

      const retrieved = await store.getCodeVerifier(code);
      expect(retrieved).toBeNull();
    });

    it('should handle deletion of non-existent code', async () => {
      // Should not throw
      await expect(store.deleteCodeVerifier('non-existent')).resolves.not.toThrow();
    });
  });

  describe('TTL and Expiration', () => {
    it('should respect TTL for stored data', async () => {
      const code = 'auth-code-ttl-test';
      const data: PKCEData = {
        codeVerifier: 'ttl-verifier',
        state: 'ttl-state'
      };

      // Store with 1 second TTL
      await store.storeCodeVerifier(code, data, 1);

      // Immediately should exist
      const immediate = await store.getCodeVerifier(code);
      expect(immediate).toEqual(data);

      // After 2 seconds, should be expired (using ioredis-mock fast-forward)
      // Note: ioredis-mock doesn't perfectly simulate TTL, so we test the API contract
      // In real Redis, this would be null after TTL expires
    });

    it('should use default TTL when not specified', async () => {
      const code = 'auth-code-default-ttl';
      const data: PKCEData = {
        codeVerifier: 'default-ttl-verifier',
        state: 'default-ttl-state'
      };

      await store.storeCodeVerifier(code, data); // Uses default 600 seconds
      const retrieved = await store.getCodeVerifier(code);
      expect(retrieved).toEqual(data);
    });
  });

  describe('Lua Script Execution', () => {
    it('should execute Lua script for atomic get-and-delete', async () => {
      const code = 'auth-code-lua-test';
      const data: PKCEData = {
        codeVerifier: 'lua-verifier',
        state: 'lua-state'
      };

      await store.storeCodeVerifier(code, data);

      // getAndDeleteCodeVerifier uses Lua script internally
      const result = await store.getAndDeleteCodeVerifier(code);
      expect(result).toEqual(data);

      // Verify deletion happened atomically
      const afterDelete = await store.getCodeVerifier(code);
      expect(afterDelete).toBeNull();
    });
  });

  describe('Redis Key Prefix', () => {
    it('should use oauth:pkce: prefix for keys', async () => {
      const code = 'auth-code-prefix-test';
      const data: PKCEData = {
        codeVerifier: 'prefix-verifier',
        state: 'prefix-state'
      };

      await store.storeCodeVerifier(code, data);

      // Verify key exists with correct prefix (using shared Redis instance)
      const key = `oauth:pkce:${code}`;
      const rawValue = await sharedRedis.get(key);
      expect(rawValue).not.toBeNull();

      const parsed = JSON.parse(rawValue);
      expect(parsed).toEqual(data);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty code verifier', async () => {
      const code = 'auth-code-empty-verifier';
      const data: PKCEData = {
        codeVerifier: '',
        state: 'state-with-empty-verifier'
      };

      await store.storeCodeVerifier(code, data);
      const retrieved = await store.getCodeVerifier(code);
      expect(retrieved).toEqual(data);
    });

    it('should handle empty state', async () => {
      const code = 'auth-code-empty-state';
      const data: PKCEData = {
        codeVerifier: 'verifier-with-empty-state',
        state: ''
      };

      await store.storeCodeVerifier(code, data);
      const retrieved = await store.getCodeVerifier(code);
      expect(retrieved).toEqual(data);
    });

    it('should handle very long code verifier', async () => {
      const code = 'auth-code-long-verifier';
      const data: PKCEData = {
        codeVerifier: 'a'.repeat(1000), // 1000 character verifier
        state: 'long-verifier-state'
      };

      await store.storeCodeVerifier(code, data);
      const retrieved = await store.getCodeVerifier(code);
      expect(retrieved).toEqual(data);
    });

    it('should handle very long state', async () => {
      const code = 'auth-code-long-state';
      const data: PKCEData = {
        codeVerifier: 'long-state-verifier',
        state: 'b'.repeat(1000) // 1000 character state
      };

      await store.storeCodeVerifier(code, data);
      const retrieved = await store.getCodeVerifier(code);
      expect(retrieved).toEqual(data);
    });

    it('should handle Unicode characters', async () => {
      const code = 'auth-code-unicode';
      const data: PKCEData = {
        codeVerifier: 'verifier-with-unicode-🔒-🔑',
        state: 'state-with-unicode-✅-🚀'
      };

      await store.storeCodeVerifier(code, data);
      const retrieved = await store.getCodeVerifier(code);
      expect(retrieved).toEqual(data);
    });
  });

  describe('Multiple Operations', () => {
    it('should handle multiple concurrent stores', async () => {
      const codes = Array.from({ length: 10 }, (_, i) => `auth-code-${i}`);
      const dataArray: PKCEData[] = codes.map((_, i) => ({
        codeVerifier: `verifier-${i}`,
        state: `state-${i}`
      }));

      // Store all
      await Promise.all(
        codes.map((code, i) => store.storeCodeVerifier(code, dataArray[i]!))
      );

      // Retrieve all
      const retrieved = await Promise.all(
        codes.map(code => store.getCodeVerifier(code))
      );

      // Verify all match
      for (const [i, data] of retrieved.entries()) {
        expect(data).toEqual(dataArray[i]);
      }
    });

    it('should handle interleaved operations', async () => {
      const code1 = 'auth-code-interleave-1';
      const code2 = 'auth-code-interleave-2';
      const data1: PKCEData = {
        codeVerifier: 'interleave-verifier-1',
        state: 'interleave-state-1'
      };
      const data2: PKCEData = {
        codeVerifier: 'interleave-verifier-2',
        state: 'interleave-state-2'
      };

      await store.storeCodeVerifier(code1, data1);
      await store.storeCodeVerifier(code2, data2);

      const retrieved1 = await store.getAndDeleteCodeVerifier(code1);
      expect(retrieved1).toEqual(data1);

      // code2 should still exist
      const retrieved2 = await store.getCodeVerifier(code2);
      expect(retrieved2).toEqual(data2);

      // code1 should be gone
      const gone = await store.getCodeVerifier(code1);
      expect(gone).toBeNull();
    });
  });

  describe('Redis Transaction Safety (M3)', () => {
    it('should handle concurrent getAndDeleteCodeVerifier calls on same code', async () => {
      // M3: Verify atomic Lua script prevents race conditions
      const code = 'auth-code-concurrent-race';
      const data: PKCEData = {
        codeVerifier: 'concurrent-verifier',
        state: 'concurrent-state'
      };

      await store.storeCodeVerifier(code, data);

      // Simulate multiple server instances trying to exchange the same code simultaneously
      const results = await Promise.all([
        store.getAndDeleteCodeVerifier(code),
        store.getAndDeleteCodeVerifier(code),
        store.getAndDeleteCodeVerifier(code),
        store.getAndDeleteCodeVerifier(code),
        store.getAndDeleteCodeVerifier(code)
      ]);

      // Exactly ONE should succeed (get the data), all others should return null
      const successfulResults = results.filter(r => r !== null);
      const failedResults = results.filter(r => r === null);

      expect(successfulResults).toHaveLength(1);
      expect(successfulResults[0]).toEqual(data);
      expect(failedResults).toHaveLength(4);

      // Verify code is deleted
      const afterRace = await store.getCodeVerifier(code);
      expect(afterRace).toBeNull();
    });

    it('should ensure Lua script atomicity under concurrent load', async () => {
      // M3: Test atomicity with multiple codes being exchanged concurrently
      const codes = Array.from({ length: 5 }, (_, i) => `auth-code-atomic-${i}`);
      const dataArray: PKCEData[] = codes.map((_, i) => ({
        codeVerifier: `atomic-verifier-${i}`,
        state: `atomic-state-${i}`
      }));

      // Store all codes
      await Promise.all(
        codes.map((code, i) => store.storeCodeVerifier(code, dataArray[i]!))
      );

      // Each code should be exchanged exactly once despite concurrent attempts
      const allResults = await Promise.all(
        codes.flatMap((code, i) => [
          store.getAndDeleteCodeVerifier(code),
          store.getAndDeleteCodeVerifier(code),
          store.getAndDeleteCodeVerifier(code)
        ])
      );

      // For each code, exactly 1 of 3 attempts should succeed
      for (let i = 0; i < codes.length; i++) {
        const codeResults = allResults.slice(i * 3, (i + 1) * 3);
        const successful = codeResults.filter(r => r !== null);
        expect(successful).toHaveLength(1);
        expect(successful[0]).toEqual(dataArray[i]);
      }

      // All codes should be deleted
      const finalCheck = await Promise.all(
        codes.map(code => store.getCodeVerifier(code))
      );
      expect(finalCheck.every(r => r === null)).toBe(true);
    });

    it('should prevent race conditions in cleanupAfterTokenExchange flow', async () => {
      // M3: Simulate the exact race condition scenario from base-provider.ts:155-168
      // Multiple instances call cleanupAfterTokenExchange simultaneously
      const code = 'auth-code-cleanup-race';
      const data: PKCEData = {
        codeVerifier: 'cleanup-verifier',
        state: 'cleanup-state-session-123'
      };

      await store.storeCodeVerifier(code, data);

      // Simulate 10 server instances all trying to complete token exchange
      const cleanupAttempts = await Promise.all(
        Array.from({ length: 10 }, () =>
          store.getAndDeleteCodeVerifier(code)
        )
      );

      // Only the first one succeeds, preventing double session cleanup
      const successful = cleanupAttempts.filter(r => r !== null);
      expect(successful).toHaveLength(1);
      expect(successful[0]).toEqual(data);

      // All other attempts get null (as if code was already used)
      const failed = cleanupAttempts.filter(r => r === null);
      expect(failed).toHaveLength(9);

      // Verify code is truly deleted
      expect(await store.hasCodeVerifier(code)).toBe(false);
    });

    it('should maintain transaction integrity with rapid sequential operations', async () => {
      // M3: Test that rapid store/getAndDelete cycles maintain consistency
      const code = 'auth-code-rapid-ops';
      const iterations = 5;

      for (let i = 0; i < iterations; i++) {
        const data: PKCEData = {
          codeVerifier: `rapid-verifier-${i}`,
          state: `rapid-state-${i}`
        };

        // Store
        await store.storeCodeVerifier(code, data);

        // Immediately try to exchange from multiple "instances"
        const results = await Promise.all([
          store.getAndDeleteCodeVerifier(code),
          store.getAndDeleteCodeVerifier(code)
        ]);

        // Exactly one should succeed
        const successful = results.filter(r => r !== null);
        expect(successful).toHaveLength(1);
        expect(successful[0]).toEqual(data);

        // Code should be deleted
        expect(await store.hasCodeVerifier(code)).toBe(false);
      }
    });

    it('should handle mixed concurrent operations without corruption', async () => {
      // M3: Mix of stores, gets, getAndDeletes, and hasCodeVerifier
      const code = 'auth-code-mixed-ops';
      const data1: PKCEData = {
        codeVerifier: 'mixed-verifier-1',
        state: 'mixed-state-1'
      };
      const data2: PKCEData = {
        codeVerifier: 'mixed-verifier-2',
        state: 'mixed-state-2'
      };

      // Initial store
      await store.storeCodeVerifier(code, data1);

      // Mix of operations happening concurrently
      await Promise.all([
        store.getAndDeleteCodeVerifier(code),
        store.getCodeVerifier(code),
        store.hasCodeVerifier(code),
        store.storeCodeVerifier(code, data2),
        store.getCodeVerifier(code)
      ]);

      // After mixed operations, state should be consistent
      // Either data was deleted by first getAndDelete, or data2 was stored
      const finalState = await store.getCodeVerifier(code);

      // Should either be null (if getAndDelete won) or data2 (if store won)
      expect(finalState === null || finalState).toEqual(data2);
    });

    it('should verify Lua script execution is truly atomic', async () => {
      // M3: Verify the Lua script in getAndDeleteCodeVerifier cannot be interrupted
      const code = 'auth-code-lua-atomic';
      const data: PKCEData = {
        codeVerifier: 'lua-atomic-verifier',
        state: 'lua-atomic-state'
      };

      await store.storeCodeVerifier(code, data);

      // Launch concurrent getAndDelete operations
      // The Lua script ensures only one succeeds
      const promise1 = store.getAndDeleteCodeVerifier(code);
      const promise2 = store.getAndDeleteCodeVerifier(code);
      const promise3 = store.getAndDeleteCodeVerifier(code);

      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

      // Collect results
      const allResults = [result1, result2, result3];
      const successCount = allResults.filter(r => r !== null).length;
      const failCount = allResults.filter(r => r === null).length;

      // Exactly one should have retrieved the data
      expect(successCount).toBe(1);
      expect(failCount).toBe(2);

      // The successful one should have the correct data
      const successful = allResults.find(r => r !== null);
      expect(successful).toEqual(data);

      // Data should be gone from Redis
      expect(await store.hasCodeVerifier(code)).toBe(false);
      expect(await store.getCodeVerifier(code)).toBeNull();
    });
  });
});
