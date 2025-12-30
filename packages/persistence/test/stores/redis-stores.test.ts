/**
 * Unit tests for Redis Store implementations using ioredis-mock
 */

import { vi } from 'vitest';
import { RedisSessionStore } from '../../src/index.js';
import {
  RedisTestInstance,
  createTestSession,
} from '../helpers/redis-test-helpers.js';

// Hoist Redis mock at module scope (required for Vitest)
const RedisMock = vi.hoisted(() => require('ioredis-mock'));

// Mock Redis for testing
vi.mock('ioredis', () => ({
  default: RedisMock,
  Redis: RedisMock,
}));

describe('Redis OAuth Stores', () => {
  beforeEach(async () => {
    await RedisTestInstance.flush();
  });

  afterAll(async () => {
    await RedisTestInstance.cleanup();
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
        const session = createTestSession({
          state,
          provider: 'google',
          codeVerifier: 'test-verifier',
          codeChallenge: 'test-challenge',
          scopes: ['openid', 'profile', 'email'],
        });

        await store.storeSession(state, session);

        // Verify stored
        const retrieved = await store.getSession(state);
        expect(retrieved).toEqual(session);
      });

      it('should store session with all optional fields', async () => {
        const state = 'test-state-456';
        const session = createTestSession({
          state,
          provider: 'github',
          codeVerifier: 'test-verifier',
          codeChallenge: 'test-challenge-2',
          scopes: ['user:email'],
          clientState: 'client-csrf-token',
          clientRedirectUri: 'http://localhost:6274/callback',
        });

        await store.storeSession(state, session);

        const retrieved = await store.getSession(state);
        expect(retrieved).toEqual(session);
      });
    });

    describe('getSession', () => {
      it('should retrieve stored session', async () => {
        const state = 'test-state-789';
        const session = createTestSession({
          state,
          provider: 'microsoft',
          codeVerifier: 'test-verifier',
          codeChallenge: 'test-challenge-3',
          scopes: ['openid'],
        });

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
        const session = createTestSession({
          state,
          provider: 'google',
          codeVerifier: 'test-verifier',
          codeChallenge: 'test-challenge-4',
          scopes: ['openid'],
          expiresIn: -1000, // Expired 1 second ago
        });

        await store.storeSession(state, session);
        const retrieved = await store.getSession(state);

        expect(retrieved).toBeNull();
      });
    });

    describe('deleteSession', () => {
      it('should delete existing session', async () => {
        const state = 'delete-test-state';
        const session = createTestSession({
          state,
          provider: 'google',
          codeVerifier: 'test-verifier',
          codeChallenge: 'test-challenge-5',
          scopes: ['openid'],
        });

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
        await store.storeSession('state-1', createTestSession({
          state: 'state-1',
          provider: 'google',
          codeVerifier: 'verifier-1',
          codeChallenge: 'challenge-1',
          scopes: ['openid'],
        }));

        await store.storeSession('state-2', createTestSession({
          state: 'state-2',
          provider: 'github',
          codeVerifier: 'verifier-2',
          codeChallenge: 'challenge-2',
          scopes: ['user:email'],
        }));

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
