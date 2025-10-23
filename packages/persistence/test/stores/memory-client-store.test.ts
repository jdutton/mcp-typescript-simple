/**
 * Unit tests for InMemoryClientStore
 */

import { InMemoryClientStore } from '../../src/index.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

describe('InMemoryClientStore', () => {
  let store: InMemoryClientStore;

  beforeEach(() => {
    store = new InMemoryClientStore({
      defaultSecretExpirySeconds: 3600, // 1 hour for testing
      enableAutoCleanup: false, // Disable for predictable tests
      maxClients: 100,
    });
  });

  afterEach(() => {
    store.dispose();
  });

  describe('registerClient', () => {
    it('should register a new client with all required fields', async () => {
      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
        grant_types: ['authorization_code'],
        response_types: ['code'],
      };

      const registered = await store.registerClient(clientMetadata);

      expect(registered.client_id).toBeDefined();
      expect(registered.client_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i); // UUID v4
      expect(registered.client_secret).toBeDefined();
      expect(registered.client_secret).toHaveLength(43); // base64url of 32 bytes
      expect(registered.client_id_issued_at).toBeDefined();
      expect(registered.client_id_issued_at).toBeGreaterThan(0);
      expect(registered.client_secret_expires_at).toBeDefined();
      expect(registered.client_secret_expires_at).toBeGreaterThan(registered.client_id_issued_at!);
      expect(registered.redirect_uris).toEqual(clientMetadata.redirect_uris);
      expect(registered.client_name).toBe(clientMetadata.client_name);
      expect(registered.grant_types).toEqual(clientMetadata.grant_types);
      expect(registered.response_types).toEqual(clientMetadata.response_types);
    });

    it('should generate unique client IDs for multiple registrations', async () => {
      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      const client1 = await store.registerClient(clientMetadata);
      const client2 = await store.registerClient(clientMetadata);
      const client3 = await store.registerClient(clientMetadata);

      expect(client1.client_id).not.toBe(client2.client_id);
      expect(client2.client_id).not.toBe(client3.client_id);
      expect(client1.client_id).not.toBe(client3.client_id);
    });

    it('should generate unique client secrets for multiple registrations', async () => {
      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      const client1 = await store.registerClient(clientMetadata);
      const client2 = await store.registerClient(clientMetadata);

      expect(client1.client_secret).not.toBe(client2.client_secret);
    });

    it('should set expiration when defaultSecretExpirySeconds is configured', async () => {
      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      const beforeRegister = Math.floor(Date.now() / 1000);
      const registered = await store.registerClient(clientMetadata);
      const afterRegister = Math.floor(Date.now() / 1000);

      expect(registered.client_secret_expires_at).toBeDefined();
      expect(registered.client_secret_expires_at).toBeGreaterThanOrEqual(beforeRegister + 3600);
      expect(registered.client_secret_expires_at).toBeLessThanOrEqual(afterRegister + 3600);
    });

    it('should not set expiration when defaultSecretExpirySeconds is 0', async () => {
      const noExpiryStore = new InMemoryClientStore({
        defaultSecretExpirySeconds: 0,
      });

      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      const registered = await noExpiryStore.registerClient(clientMetadata);

      expect(registered.client_secret_expires_at).toBeUndefined();

      noExpiryStore.dispose();
    });

    it('should throw error when max clients limit is reached', async () => {
      const limitedStore = new InMemoryClientStore({
        maxClients: 2,
      });

      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      await limitedStore.registerClient(clientMetadata);
      await limitedStore.registerClient(clientMetadata);

      await expect(limitedStore.registerClient(clientMetadata)).rejects.toThrow(
        'Maximum number of registered clients reached (2)'
      );

      limitedStore.dispose();
    });

    it('should preserve all optional client metadata fields', async () => {
      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
        client_uri: 'https://example.com',
        logo_uri: 'https://example.com/logo.png',
        scope: 'openid profile email',
        contacts: ['admin@example.com'],
        tos_uri: 'https://example.com/tos',
        policy_uri: 'https://example.com/policy',
        jwks_uri: 'https://example.com/jwks',
        token_endpoint_auth_method: 'client_secret_post',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      };

      const registered = await store.registerClient(clientMetadata);

      expect(registered.client_uri).toBe(clientMetadata.client_uri);
      expect(registered.logo_uri).toBe(clientMetadata.logo_uri);
      expect(registered.scope).toBe(clientMetadata.scope);
      expect(registered.contacts).toEqual(clientMetadata.contacts);
      expect(registered.tos_uri).toBe(clientMetadata.tos_uri);
      expect(registered.policy_uri).toBe(clientMetadata.policy_uri);
      expect(registered.jwks_uri).toBe(clientMetadata.jwks_uri);
      expect(registered.token_endpoint_auth_method).toBe(clientMetadata.token_endpoint_auth_method);
    });
  });

  describe('getClient', () => {
    it('should retrieve a registered client by client_id', async () => {
      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      const registered = await store.registerClient(clientMetadata);
      const retrieved = await store.getClient(registered.client_id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.client_id).toBe(registered.client_id);
      expect(retrieved!.client_secret).toBe(registered.client_secret);
      expect(retrieved!.client_name).toBe(registered.client_name);
      expect(retrieved!.redirect_uris).toEqual(registered.redirect_uris);
    });

    it('should return undefined for non-existent client_id', async () => {
      const retrieved = await store.getClient('non-existent-id');

      expect(retrieved).toBeUndefined();
    });

    it('should return undefined (not null) for non-existent client', async () => {
      const retrieved = await store.getClient('non-existent-id');

      expect(retrieved).toBe(undefined);
      expect(retrieved).not.toBe(null);
    });
  });

  describe('deleteClient', () => {
    it('should delete an existing client', async () => {
      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      const registered = await store.registerClient(clientMetadata);
      const deleted = await store.deleteClient(registered.client_id);

      expect(deleted).toBe(true);

      const retrieved = await store.getClient(registered.client_id);
      expect(retrieved).toBeUndefined();
    });

    it('should return false when deleting non-existent client', async () => {
      const deleted = await store.deleteClient('non-existent-id');

      expect(deleted).toBe(false);
    });

    it('should allow re-registration after deletion', async () => {
      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      const client1 = await store.registerClient(clientMetadata);
      await store.deleteClient(client1.client_id);

      const client2 = await store.registerClient(clientMetadata);

      expect(client2.client_id).not.toBe(client1.client_id);
      expect(await store.getClient(client2.client_id)).toBeDefined();
    });
  });

  describe('listClients', () => {
    it('should return empty array when no clients registered', async () => {
      const clients = await store.listClients();

      expect(clients).toEqual([]);
    });

    it('should return all registered clients', async () => {
      const metadata1 = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Client 1',
      };
      const metadata2 = {
        redirect_uris: ['http://localhost:4000/callback'],
        client_name: 'Client 2',
      };
      const metadata3 = {
        redirect_uris: ['http://localhost:5000/callback'],
        client_name: 'Client 3',
      };

      const client1 = await store.registerClient(metadata1);
      const client2 = await store.registerClient(metadata2);
      const client3 = await store.registerClient(metadata3);

      const clients = await store.listClients();

      expect(clients).toHaveLength(3);
      expect(clients.map(c => c.client_id)).toContain(client1.client_id);
      expect(clients.map(c => c.client_id)).toContain(client2.client_id);
      expect(clients.map(c => c.client_id)).toContain(client3.client_id);
    });

    it('should include expired clients in listing', async () => {
      const shortExpiryStore = new InMemoryClientStore({
        defaultSecretExpirySeconds: 1, // 1 second
      });

      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      await shortExpiryStore.registerClient(clientMetadata);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      const clients = await shortExpiryStore.listClients();

      // Expired clients should still be in the list (cleanup is separate)
      expect(clients).toHaveLength(1);

      shortExpiryStore.dispose();
    });
  });

  describe('cleanupExpired', () => {
    it('should remove expired clients', async () => {
      const shortExpiryStore = new InMemoryClientStore({
        defaultSecretExpirySeconds: 1, // 1 second
      });

      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      const client1 = await shortExpiryStore.registerClient(clientMetadata);
      const client2 = await shortExpiryStore.registerClient(clientMetadata);

      // Wait for expiration (1 second + 100ms buffer)
      await new Promise(resolve => setTimeout(resolve, 1100));

      const cleanedCount = await shortExpiryStore.cleanupExpired();

      expect(cleanedCount).toBe(2);
      expect(await shortExpiryStore.getClient(client1.client_id)).toBeUndefined();
      expect(await shortExpiryStore.getClient(client2.client_id)).toBeUndefined();

      shortExpiryStore.dispose();
    });

    it('should not remove non-expired clients', async () => {
      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      const client1 = await store.registerClient(clientMetadata);

      const cleanedCount = await store.cleanupExpired();

      expect(cleanedCount).toBe(0);
      expect(await store.getClient(client1.client_id)).toBeDefined();
    });

    it('should return 0 when no expired clients', async () => {
      const cleanedCount = await store.cleanupExpired();

      expect(cleanedCount).toBe(0);
    });

    it('should not remove clients without expiration', async () => {
      const noExpiryStore = new InMemoryClientStore({
        defaultSecretExpirySeconds: 0, // No expiration
      });

      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      const client1 = await noExpiryStore.registerClient(clientMetadata);

      const cleanedCount = await noExpiryStore.cleanupExpired();

      expect(cleanedCount).toBe(0);
      expect(await noExpiryStore.getClient(client1.client_id)).toBeDefined();

      noExpiryStore.dispose();
    });
  });

  describe('getClientCount', () => {
    it('should return 0 for empty store', () => {
      expect(store.getClientCount()).toBe(0);
    });

    it('should return correct count after registrations', async () => {
      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      await store.registerClient(clientMetadata);
      expect(store.getClientCount()).toBe(1);

      await store.registerClient(clientMetadata);
      expect(store.getClientCount()).toBe(2);

      await store.registerClient(clientMetadata);
      expect(store.getClientCount()).toBe(3);
    });

    it('should decrease count after deletion', async () => {
      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      const client1 = await store.registerClient(clientMetadata);
      await store.registerClient(clientMetadata);

      expect(store.getClientCount()).toBe(2);

      await store.deleteClient(client1.client_id);

      expect(store.getClientCount()).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all clients', async () => {
      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      await store.registerClient(clientMetadata);
      await store.registerClient(clientMetadata);
      await store.registerClient(clientMetadata);

      expect(store.getClientCount()).toBe(3);

      store.clear();

      expect(store.getClientCount()).toBe(0);
      expect(await store.listClients()).toEqual([]);
    });
  });

  describe('dispose', () => {
    it('should clean up resources', () => {
      const autoCleanupStore = new InMemoryClientStore({
        enableAutoCleanup: true,
        cleanupIntervalMs: 1000,
      });

      expect(() => autoCleanupStore.dispose()).not.toThrow();
      expect(autoCleanupStore.getClientCount()).toBe(0);
    });

    it('should be safe to call multiple times', () => {
      expect(() => {
        store.dispose();
        store.dispose();
        store.dispose();
      }).not.toThrow();
    });
  });

  describe('auto-cleanup', () => {
    it('should automatically clean up expired clients when enabled', async () => {
      const autoCleanupStore = new InMemoryClientStore({
        defaultSecretExpirySeconds: 1, // 1 second
        enableAutoCleanup: true,
        cleanupIntervalMs: 500, // Clean every 500ms
      });

      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      const client1 = await autoCleanupStore.registerClient(clientMetadata);

      expect(autoCleanupStore.getClientCount()).toBe(1);

      // Wait for expiration + cleanup cycle (1s expiry + 500ms cleanup + buffer)
      await new Promise(resolve => setTimeout(resolve, 2000));

      expect(autoCleanupStore.getClientCount()).toBe(0);
      expect(await autoCleanupStore.getClient(client1.client_id)).toBeUndefined();

      autoCleanupStore.dispose();
    }, 10000); // Increase timeout for this test
  });
});