/**
 * Integration tests for Redis key prefix isolation (ADR 006)
 *
 * Verifies that multiple MCP servers can coexist on the same Redis instance
 * without key collisions by using different key prefixes.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { RedisSessionStore, RedisClientStore, OAuthSession } from '../../src/index.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

// Hoist Redis mock to avoid initialization issues
const RedisMock = vi.hoisted(() => require('ioredis-mock'));

// Mock Redis for testing
vi.mock('ioredis', () => ({
  default: RedisMock,
  Redis: RedisMock,
}));

// Create a shared Redis instance for all tests
let sharedRedis: any = null;

describe('Redis Key Prefix Isolation (ADR 006)', () => {
  beforeEach(async () => {
    if (!sharedRedis) {
      sharedRedis = new (RedisMock as any)();
    }
    // Flush all data between tests
    await sharedRedis.flushall();
  });

  afterAll(async () => {
    // Clean up shared Redis instance
    if (sharedRedis) {
      await sharedRedis.quit();
      sharedRedis = null;
    }
  });

  describe('Session Store Key Isolation', () => {
    it('should isolate sessions between different prefixes', async () => {
      // Create two stores with different prefixes (simulating two MCP servers)
      const store1 = new RedisSessionStore('redis://localhost:6379', 'mcp-server-1');
      const store2 = new RedisSessionStore('redis://localhost:6379', 'mcp-server-2');

      const state = 'shared-state-123';
      const session1: OAuthSession = {
        provider: 'google',
        state,
        codeVerifier: 'verifier-1',
        codeChallenge: 'challenge-1',
        redirectUri: 'http://localhost:3001/callback',
        scopes: ['openid', 'profile'],
        expiresAt: Date.now() + 600000,
      };

      const session2: OAuthSession = {
        provider: 'github',
        state,
        codeVerifier: 'verifier-2',
        codeChallenge: 'challenge-2',
        redirectUri: 'http://localhost:3002/callback',
        scopes: ['user:email'],
        expiresAt: Date.now() + 600000,
      };

      // Store sessions with same state but different prefixes
      await store1.storeSession(state, session1);
      await store2.storeSession(state, session2);

      // Verify isolation: each store retrieves its own session
      const retrieved1 = await store1.getSession(state);
      const retrieved2 = await store2.getSession(state);

      expect(retrieved1).toEqual(session1);
      expect(retrieved2).toEqual(session2);
      expect(retrieved1).not.toEqual(retrieved2);

      // Verify session counts are isolated
      const count1 = await store1.getSessionCount();
      const count2 = await store2.getSessionCount();

      expect(count1).toBe(1);
      expect(count2).toBe(1);

      // Cleanup
      store1.dispose();
      store2.dispose();
    });

    it('should support factories using default prefix "mcp"', async () => {
      // Factories use default prefix 'mcp' from getRedisKeyPrefix() (per ADR 006)
      // Direct instantiation with no prefix uses empty string for backward compatibility
      const storeMcp1 = new RedisSessionStore('redis://localhost:6379', 'mcp');
      const storeMcp2 = new RedisSessionStore('redis://localhost:6379', 'mcp');

      const state = 'test-state';
      const session: OAuthSession = {
        provider: 'google',
        state,
        codeVerifier: 'verifier',
        codeChallenge: 'challenge',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['openid'],
        expiresAt: Date.now() + 600000,
      };

      // Store with 'mcp' prefix
      await storeMcp1.storeSession(state, session);

      // Should be retrievable with same 'mcp' prefix
      const retrieved = await storeMcp2.getSession(state);
      expect(retrieved).toEqual(session);

      // Cleanup
      storeMcp1.dispose();
      storeMcp2.dispose();
    });

    it('should handle prefix normalization (trailing colons)', async () => {
      // All these should be equivalent after normalization
      const store1 = new RedisSessionStore('redis://localhost:6379', 'test');
      const store2 = new RedisSessionStore('redis://localhost:6379', 'test:');
      const store3 = new RedisSessionStore('redis://localhost:6379', 'test::');

      const state = 'normalized-state';
      const session: OAuthSession = {
        provider: 'google',
        state,
        codeVerifier: 'verifier',
        codeChallenge: 'challenge',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['openid'],
        expiresAt: Date.now() + 600000,
      };

      // Store with first prefix
      await store1.storeSession(state, session);

      // Should be retrievable with all normalized variants
      const retrieved2 = await store2.getSession(state);
      const retrieved3 = await store3.getSession(state);

      expect(retrieved2).toEqual(session);
      expect(retrieved3).toEqual(session);

      // Cleanup
      store1.dispose();
      store2.dispose();
      store3.dispose();
    });
  });

  describe('Client Store Key Isolation', () => {
    it('should isolate clients between different prefixes', async () => {
      // Create two stores with different prefixes
      const store1 = new RedisClientStore('redis://localhost:6379', {}, 'mcp-server-1');
      const store2 = new RedisClientStore('redis://localhost:6379', {}, 'mcp-server-2');

      // Register clients in both stores
      const client1: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'> = {
        client_name: 'Client 1',
        client_uri: 'http://localhost:3001',
        redirect_uris: ['http://localhost:3001/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };

      const client2: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'> = {
        client_name: 'Client 2',
        client_uri: 'http://localhost:3002',
        redirect_uris: ['http://localhost:3002/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };

      const registered1 = await store1.registerClient(client1);
      await store2.registerClient(client2);

      // Verify isolation: each store has only its own client
      const count1 = await store1.getClientCount();
      const count2 = await store2.getClientCount();

      expect(count1).toBe(1);
      expect(count2).toBe(1);

      // Verify cross-store isolation: client from store1 not in store2
      const notFound = await store2.getClient(registered1.client_id);
      expect(notFound).toBeUndefined();
    });
  });

  describe('Multi-Environment Scenario', () => {
    it('should support dev/staging/prod on same Redis instance', async () => {
      // Simulate three environments on same Redis
      const devStore = new RedisSessionStore('redis://localhost:6379', 'mcp-dev');
      const stagingStore = new RedisSessionStore('redis://localhost:6379', 'mcp-staging');
      const prodStore = new RedisSessionStore('redis://localhost:6379', 'mcp-prod');

      const state = 'test-state';
      const createSession = (env: string): OAuthSession => ({
        provider: 'google',
        state,
        codeVerifier: `verifier-${env}`,
        codeChallenge: `challenge-${env}`,
        redirectUri: `http://${env}.example.com/callback`,
        scopes: ['openid'],
        expiresAt: Date.now() + 600000,
      });

      // Store sessions in all three environments
      await devStore.storeSession(state, createSession('dev'));
      await stagingStore.storeSession(state, createSession('staging'));
      await prodStore.storeSession(state, createSession('prod'));

      // Verify complete isolation
      const devSession = await devStore.getSession(state);
      const stagingSession = await stagingStore.getSession(state);
      const prodSession = await prodStore.getSession(state);

      expect(devSession?.codeVerifier).toBe('verifier-dev');
      expect(stagingSession?.codeVerifier).toBe('verifier-staging');
      expect(prodSession?.codeVerifier).toBe('verifier-prod');

      // Verify each environment has exactly 1 session
      expect(await devStore.getSessionCount()).toBe(1);
      expect(await stagingStore.getSessionCount()).toBe(1);
      expect(await prodStore.getSessionCount()).toBe(1);

      // Cleanup
      devStore.dispose();
      stagingStore.dispose();
      prodStore.dispose();
    });
  });
});
