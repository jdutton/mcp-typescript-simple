/**
 * Unit tests for Redis Store implementations using ioredis-mock
 */

import { vi } from 'vitest';
import { RedisSessionStore, OAuthSession } from '../../src/index.js';

// Hoist Redis mock to avoid initialization issues
const RedisMock = vi.hoisted(() => require('ioredis-mock'));

// Mock Redis for testing - Vitest requires both default and named exports
vi.mock('ioredis', () => ({
  default: RedisMock,
  Redis: RedisMock,
}));

// Create a shared Redis instance for cleanup
let sharedRedis: any = null;

describe('Redis OAuth Stores', () => {
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

  describe('RedisSessionStore', () => {
    let store: RedisSessionStore;

    beforeEach(() => {
      // Create store with mock Redis URL
      store = new RedisSessionStore('redis://localhost:6379');
    });

    afterEach(() => {
      store.dispose();
    });

    describe('storeSession', () => {
      it('should store session with TTL', async () => {
        const state = 'test-state-123';
        const session: OAuthSession = {
          provider: 'google',
          state,
          codeVerifier: 'test-verifier',
          codeChallenge: 'test-challenge',
          redirectUri: 'http://localhost:3000/callback',
          scopes: ['openid', 'profile', 'email'],
          expiresAt: Date.now() + 600000, // 10 minutes
        };

        await store.storeSession(state, session);

        // Verify stored
        const retrieved = await store.getSession(state);
        expect(retrieved).toEqual(session);
      });

      it('should store session with all optional fields', async () => {
        const state = 'test-state-456';
        const session: OAuthSession = {
          provider: 'github',
          state,
          codeVerifier: 'test-verifier',
          codeChallenge: 'test-challenge-2',
          redirectUri: 'http://localhost:3000/callback',
          scopes: ['user:email'],
          expiresAt: Date.now() + 600000,
          clientState: 'client-csrf-token',
          clientRedirectUri: 'http://localhost:6274/callback',
        };

        await store.storeSession(state, session);

        const retrieved = await store.getSession(state);
        expect(retrieved).toEqual(session);
      });
    });

    describe('getSession', () => {
      it('should retrieve stored session', async () => {
        const state = 'test-state-789';
        const session: OAuthSession = {
          provider: 'microsoft',
          state,
          codeVerifier: 'test-verifier',
          codeChallenge: 'test-challenge-3',
          redirectUri: 'http://localhost:3000/callback',
          scopes: ['openid'],
          expiresAt: Date.now() + 600000,
        };

        await store.storeSession(state, session);
        const retrieved = await store.getSession(state);

        expect(retrieved).toEqual(session);
      });

      it('should return null for non-existent session', async () => {
        const retrieved = await store.getSession('non-existent');
        expect(retrieved).toBeNull();
      });

      it('should return null for expired session', async () => {
        const state = 'expired-state';
        const session: OAuthSession = {
          provider: 'google',
          state,
          codeVerifier: 'test-verifier',
          codeChallenge: 'test-challenge-4',
          redirectUri: 'http://localhost:3000/callback',
          scopes: ['openid'],
          expiresAt: Date.now() - 1000, // Expired 1 second ago
        };

        await store.storeSession(state, session);
        const retrieved = await store.getSession(state);

        expect(retrieved).toBeNull();
      });
    });

    describe('deleteSession', () => {
      it('should delete existing session', async () => {
        const state = 'delete-test-state';
        const session: OAuthSession = {
          provider: 'google',
          state,
          codeVerifier: 'test-verifier',
          codeChallenge: 'test-challenge-5',
          redirectUri: 'http://localhost:3000/callback',
          scopes: ['openid'],
          expiresAt: Date.now() + 600000,
        };

        await store.storeSession(state, session);
        await store.deleteSession(state);

        const retrieved = await store.getSession(state);
        expect(retrieved).toBeNull();
      });

      it('should handle deleting non-existent session', async () => {
        // Should not throw
        await expect(store.deleteSession('non-existent')).resolves.not.toThrow();
      });
    });

    describe('cleanup', () => {
      it('should return 0 (TTL-based cleanup)', async () => {
        const count = await store.cleanup();
        expect(count).toBe(0);
      });
    });

    describe('getSessionCount', () => {
      it('should return correct session count', async () => {
        // Store multiple sessions
        await store.storeSession('state-1', {
          provider: 'google',
          state: 'state-1',
          codeVerifier: 'verifier-1',
          codeChallenge: 'challenge-1',
          redirectUri: 'http://localhost:3000/callback',
          scopes: ['openid'],
          expiresAt: Date.now() + 600000,
        });

        await store.storeSession('state-2', {
          provider: 'github',
          state: 'state-2',
          codeVerifier: 'verifier-2',
          codeChallenge: 'challenge-2',
          redirectUri: 'http://localhost:3000/callback',
          scopes: ['user:email'],
          expiresAt: Date.now() + 600000,
        });

        const count = await store.getSessionCount();
        expect(count).toBe(2);
      });

      it('should return 0 when no sessions', async () => {
        const count = await store.getSessionCount();
        expect(count).toBe(0);
      });
    });
  });
});
