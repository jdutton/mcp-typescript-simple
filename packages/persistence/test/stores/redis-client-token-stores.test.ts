/**
 * Unit tests for Redis Client Store and OAuth Token Store using ioredis-mock
 */

import { vi } from 'vitest';
import { RedisClientStore } from '../../src/index.js';
import { RedisOAuthTokenStore } from '../../src/index.js';

// Hoist Redis mock to avoid initialization issues
const RedisMock = vi.hoisted(() => require('ioredis-mock'));

// Mock Redis for testing - Vitest requires default export
vi.mock('ioredis', () => ({
  default: RedisMock
}));

// Create a shared Redis instance for cleanup
let sharedRedis: any = null;

describe('Redis Client and OAuth Token Stores', () => {
  beforeEach(async () => {
    if (!sharedRedis) {
      sharedRedis = new (RedisMock as any)();
    }
    // Flush all data between tests
    await sharedRedis.flushall();
  });

  describe('RedisClientStore', () => {
    let store: RedisClientStore;

    beforeEach(() => {
      store = new RedisClientStore('redis://localhost:6379', {
        defaultSecretExpirySeconds: 3600, // 1 hour for tests
        maxClients: 100,
      });
    });

    afterEach(async () => {
      await store.clear();
    });

    describe('registerClient', () => {
      it('should register client with generated credentials', async () => {
        const client = await store.registerClient({
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'Test Client',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        });

        expect(client.client_id).toBeDefined();
        expect(client.client_secret).toBeDefined();
        expect(client.client_id_issued_at).toBeDefined();
        expect(client.client_secret_expires_at).toBeDefined();
        expect(client.client_name).toBe('Test Client');
        expect(client.redirect_uris).toEqual(['http://localhost:3000/callback']);
      });

      it('should register client with all optional fields', async () => {
        const client = await store.registerClient({
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'Full Client',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          scope: 'openid profile email',
          token_endpoint_auth_method: 'client_secret_post',
        });

        expect(client.scope).toBe('openid profile email');
        expect(client.token_endpoint_auth_method).toBe('client_secret_post');
      });

      it('should enforce max clients limit', async () => {
        const smallStore = new RedisClientStore('redis://localhost:6379', {
          maxClients: 2,
        });

        await smallStore.registerClient({
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'Client 1',
        });

        await smallStore.registerClient({
          redirect_uris: ['http://localhost:4000/callback'],
          client_name: 'Client 2',
        });

        await expect(
          smallStore.registerClient({
            redirect_uris: ['http://localhost:5000/callback'],
            client_name: 'Client 3',
          })
        ).rejects.toThrow('Maximum number of registered clients reached');

        await smallStore.clear();
      });

      it('should set client secret expiration', async () => {
        const client = await store.registerClient({
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'Expiring Client',
        });

        const expectedExpiry = Math.floor(Date.now() / 1000) + 3600;
        expect(client.client_secret_expires_at).toBeGreaterThanOrEqual(expectedExpiry - 5);
        expect(client.client_secret_expires_at).toBeLessThanOrEqual(expectedExpiry + 5);
      });
    });

    describe('getClient', () => {
      it('should retrieve registered client', async () => {
        const registered = await store.registerClient({
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'Retrieve Test',
        });

        const retrieved = await store.getClient(registered.client_id);

        expect(retrieved).toBeDefined();
        expect(retrieved?.client_id).toBe(registered.client_id);
        expect(retrieved?.client_name).toBe('Retrieve Test');
      });

      it('should return undefined for non-existent client', async () => {
        const client = await store.getClient('non-existent-client-id');
        expect(client).toBeUndefined();
      });
    });

    describe('deleteClient', () => {
      it('should delete existing client', async () => {
        const client = await store.registerClient({
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'Delete Test',
        });

        const deleted = await store.deleteClient(client.client_id);
        expect(deleted).toBe(true);

        const retrieved = await store.getClient(client.client_id);
        expect(retrieved).toBeUndefined();
      });

      it('should return false for non-existent client', async () => {
        const deleted = await store.deleteClient('non-existent');
        expect(deleted).toBe(false);
      });
    });

    describe('listClients', () => {
      it('should list all registered clients', async () => {
        await store.registerClient({
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'Client 1',
        });

        await store.registerClient({
          redirect_uris: ['http://localhost:4000/callback'],
          client_name: 'Client 2',
        });

        const clients = await store.listClients();
        expect(clients).toHaveLength(2);
        expect(clients.map((c) => c.client_name)).toContain('Client 1');
        expect(clients.map((c) => c.client_name)).toContain('Client 2');
      });

      it('should return empty array when no clients', async () => {
        const clients = await store.listClients();
        expect(clients).toEqual([]);
      });
    });

    describe('cleanupExpired', () => {
      it('should cleanup expired clients', async () => {
        const cleanedCount = await store.cleanupExpired();
        expect(cleanedCount).toBeGreaterThanOrEqual(0);
      });
    });

    describe('getClientCount', () => {
      it('should return correct client count', async () => {
        await store.registerClient({
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'Count Test 1',
        });

        await store.registerClient({
          redirect_uris: ['http://localhost:4000/callback'],
          client_name: 'Count Test 2',
        });

        const count = await store.getClientCount();
        expect(count).toBe(2);
      });

      it('should return 0 when no clients', async () => {
        const count = await store.getClientCount();
        expect(count).toBe(0);
      });
    });

    describe('clear', () => {
      it('should clear all clients', async () => {
        await store.registerClient({
          redirect_uris: ['http://localhost:3000/callback'],
          client_name: 'Clear Test 1',
        });

        await store.registerClient({
          redirect_uris: ['http://localhost:4000/callback'],
          client_name: 'Clear Test 2',
        });

        await store.clear();

        const count = await store.getClientCount();
        expect(count).toBe(0);

        const clients = await store.listClients();
        expect(clients).toEqual([]);
      });
    });
  });

  describe('RedisOAuthTokenStore', () => {
    let store: RedisOAuthTokenStore;

    beforeEach(() => {
      store = new RedisOAuthTokenStore('redis://localhost:6379');
    });

    afterEach(() => {
      store.dispose();
    });

    describe('storeToken', () => {
      it('should store access token', async () => {
        await store.storeToken('access-token-abc', {
          provider: 'google',
          accessToken: 'access-token-abc',
          expiresAt: Date.now() + 3600000,
          userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
          scopes: ['openid', 'profile', 'email'],
        });

        const token = await store.getToken('access-token-abc');
        expect(token).toBeDefined();
        expect(token?.accessToken).toBe('access-token-abc');
        expect(token?.provider).toBe('google');
      });

      it('should store token with refresh token', async () => {
        await store.storeToken('access-token-def', {
          provider: 'github',
          accessToken: 'access-token-def',
          expiresAt: Date.now() + 3600000,
          refreshToken: 'refresh-token-xyz',
          userInfo: { sub: 'user-456', email: 'test2@example.com', name: 'Test User 2', provider: 'github' },
          scopes: ['user:email'],
        });

        const token = await store.getToken('access-token-def');
        expect(token?.refreshToken).toBe('refresh-token-xyz');
      });

      it('should store token with all fields', async () => {
        await store.storeToken('access-token-ghi', {
          provider: 'microsoft',
          accessToken: 'access-token-ghi',
          expiresAt: Date.now() + 7200000,
          refreshToken: 'refresh-token-123',
          scopes: ['openid', 'profile', 'email'],
          idToken: 'id-token-456',
          userInfo: { sub: 'user-789', email: 'test3@example.com', name: 'Test User 3', provider: 'microsoft' },
        });

        const token = await store.getToken('access-token-ghi');
        expect(token?.scopes).toEqual(['openid', 'profile', 'email']);
        expect(token?.idToken).toBe('id-token-456');
      });
    });

    describe('getToken', () => {
      it('should retrieve stored token', async () => {
        await store.storeToken('token-get-1', {
          provider: 'google',
          accessToken: 'token-get-1',
          expiresAt: Date.now() + 3600000,
          userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
          scopes: ['openid', 'profile'],
        });

        const token = await store.getToken('token-get-1');
        expect(token).toBeDefined();
        expect(token?.accessToken).toBe('token-get-1');
      });

      it('should return null for non-existent token', async () => {
        const token = await store.getToken('non-existent-token');
        expect(token).toBeNull();
      });

      it('should return null for expired token', async () => {
        await store.storeToken('expired-token', {
          provider: 'google',
          accessToken: 'expired-token',
          expiresAt: Date.now() - 1000, // Expired
          userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
          scopes: ['openid'],
        });

        const token = await store.getToken('expired-token');
        expect(token).toBeNull();
      });
    });

    describe('findByRefreshToken', () => {
      it('should find token by refresh token', async () => {
        await store.storeToken('access-token-find', {
          provider: 'google',
          accessToken: 'access-token-find',
          expiresAt: Date.now() + 3600000,
          refreshToken: 'refresh-token-find',
          userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
          scopes: ['openid', 'profile'],
        });

        const result = await store.findByRefreshToken('refresh-token-find');
        expect(result).toBeDefined();
        expect(result?.accessToken).toBe('access-token-find');
        expect(result?.tokenInfo.refreshToken).toBe('refresh-token-find');
      });

      it('should return null for non-existent refresh token', async () => {
        const result = await store.findByRefreshToken('non-existent-refresh');
        expect(result).toBeNull();
      });
    });

    describe('deleteToken', () => {
      it('should delete existing token', async () => {
        await store.storeToken('token-delete-1', {
          provider: 'google',
          accessToken: 'token-delete-1',
          expiresAt: Date.now() + 3600000,
          userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
          scopes: ['openid'],
        });

        await store.deleteToken('token-delete-1');

        const token = await store.getToken('token-delete-1');
        expect(token).toBeNull();
      });

      it('should delete token and refresh token index', async () => {
        await store.storeToken('token-delete-2', {
          provider: 'google',
          accessToken: 'token-delete-2',
          expiresAt: Date.now() + 3600000,
          refreshToken: 'refresh-delete-2',
          userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
          scopes: ['openid'],
        });

        await store.deleteToken('token-delete-2');

        const token = await store.getToken('token-delete-2');
        expect(token).toBeNull();

        const byRefresh = await store.findByRefreshToken('refresh-delete-2');
        expect(byRefresh).toBeNull();
      });
    });

    describe('cleanup', () => {
      it('should return 0 (Redis auto-expiration)', async () => {
        const cleanedCount = await store.cleanup();
        expect(cleanedCount).toBe(0);
      });
    });

    describe('getTokenCount', () => {
      it('should return correct token count', async () => {
        await store.storeToken('token-count-1', {
          provider: 'google',
          accessToken: 'token-count-1',
          expiresAt: Date.now() + 3600000,
          userInfo: { sub: 'user-123', email: 'test@example.com', name: 'Test User', provider: 'google' },
          scopes: ['openid'],
        });

        await store.storeToken('token-count-2', {
          provider: 'google',
          accessToken: 'token-count-2',
          expiresAt: Date.now() + 3600000,
          userInfo: { sub: 'user-456', email: 'test2@example.com', name: 'Test User 2', provider: 'github' },
          scopes: ['openid'],
        });

        const count = await store.getTokenCount();
        expect(count).toBe(2);
      });

      it('should return 0 when no tokens', async () => {
        const count = await store.getTokenCount();
        expect(count).toBe(0);
      });
    });
  });
});
