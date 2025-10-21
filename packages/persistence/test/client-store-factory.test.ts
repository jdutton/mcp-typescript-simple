/**
 * Unit tests for ClientStoreFactory
 */

import { ClientStoreFactory } from '../src/index.js';
import { InMemoryClientStore } from '../src/index.js';
import { FileClientStore } from '../src/index.js';
import { RedisClientStore } from '../src/index.js';
import { preserveEnv } from '../../../test/helpers/env-helper.js';

describe('ClientStoreFactory', () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = preserveEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  describe('explicit store type', () => {
    it('should create memory store when type is memory', () => {
      const store = ClientStoreFactory.create({ storeType: 'memory' });

      expect(store).toBeInstanceOf(InMemoryClientStore);

      (store as InMemoryClientStore).dispose();
    });

    it('should create file store when type is file', () => {
      const store = ClientStoreFactory.create({ storeType: 'file' });

      expect(store).toBeInstanceOf(FileClientStore);

      (store as FileClientStore).dispose();
    });



    it('should throw error when Redis URL not configured', () => {
      expect(() => {
        ClientStoreFactory.create({ storeType: 'redis' });
      }).toThrow('Redis URL not configured');
    });

    it('should throw error for unknown type', () => {
      expect(() => {
        ClientStoreFactory.create({ storeType: 'unknown' as any });
      }).toThrow('Unknown store type: unknown');
    });
  });

  describe('auto-detection', () => {
    it('should detect Redis when REDIS_URL is set', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const store = ClientStoreFactory.create({ storeType: 'auto' });

      expect(store).toBeInstanceOf(RedisClientStore);

      delete process.env.REDIS_URL;
    });

    it('should use file store for development (default)', () => {
      const store = ClientStoreFactory.create({ storeType: 'auto' });

      expect(store).toBeInstanceOf(FileClientStore);

      (store as FileClientStore).dispose();
    });

    it('should warn and use memory store in production without persistence', () => {
      process.env.NODE_ENV = 'production';

      const store = ClientStoreFactory.create({ storeType: 'auto' });

      expect(store).toBeInstanceOf(InMemoryClientStore);

      (store as InMemoryClientStore).dispose();
    });

    it('should respect DCR_STORE_TYPE environment variable', () => {
      process.env.DCR_STORE_TYPE = 'memory';

      const store = ClientStoreFactory.create({ storeType: 'auto' });

      expect(store).toBeInstanceOf(InMemoryClientStore);

      (store as InMemoryClientStore).dispose();
    });


    it('should use Redis when REDIS_URL is configured', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const store = ClientStoreFactory.create({ storeType: 'auto' });

      // Redis is now implemented - should use RedisClientStore
      expect(store).toBeInstanceOf(RedisClientStore);

      delete process.env.REDIS_URL;
    });
  });

  describe('configuration options', () => {
    it('should pass defaultSecretExpirySeconds to store', async () => {
      const store = ClientStoreFactory.create({
        storeType: 'memory',
        defaultSecretExpirySeconds: 7200, // 2 hours
      }) as InMemoryClientStore;

      const client = await store.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      });

      // Check expiry is approximately 2 hours from now
      const expectedExpiry = Math.floor(Date.now() / 1000) + 7200;
      expect(client.client_secret_expires_at).toBeGreaterThanOrEqual(expectedExpiry - 5);
      expect(client.client_secret_expires_at).toBeLessThanOrEqual(expectedExpiry + 5);

      store.dispose();
    });

    it('should pass maxClients to store', async () => {
      const store = ClientStoreFactory.create({
        storeType: 'memory',
        maxClients: 2,
      }) as InMemoryClientStore;

      await store.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Client 1',
      });

      await store.registerClient({
        redirect_uris: ['http://localhost:4000/callback'],
        client_name: 'Client 2',
      });

      await expect(
        store.registerClient({
          redirect_uris: ['http://localhost:5000/callback'],
          client_name: 'Client 3',
        })
      ).rejects.toThrow('Maximum number of registered clients reached');

      store.dispose();
    });

    it('should pass filePath to file-based stores', async () => {
      const customPath = '/tmp/test-custom-path.json';

      const store = ClientStoreFactory.create({
        storeType: 'file',
        filePath: customPath,
      }) as FileClientStore;

      // We can't directly verify the path, but we can register and retrieve
      const client = await store.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      });

      const retrieved = await store.getClient(client.client_id);
      expect(retrieved).toBeDefined();

      store.dispose();
    });
  });

  describe('createFromEnvironment', () => {
    it('should create store from environment variables', () => {
      process.env.DCR_STORE_TYPE = 'memory';
      process.env.DCR_DEFAULT_SECRET_EXPIRY = '7200';
      process.env.DCR_MAX_CLIENTS = '50';
      process.env.DCR_ENABLE_AUTO_CLEANUP = 'true';

      const store = ClientStoreFactory.createFromEnvironment() as InMemoryClientStore;

      expect(store).toBeInstanceOf(InMemoryClientStore);

      store.dispose();
    });

    it('should use auto-detection when DCR_STORE_TYPE not set', () => {
      const store = ClientStoreFactory.createFromEnvironment();

      // Should default to file in development
      expect(store).toBeInstanceOf(FileClientStore);

      (store as FileClientStore).dispose();
    });

    it('should handle missing environment variables gracefully', () => {
      // No environment variables set
      expect(() => ClientStoreFactory.createFromEnvironment()).not.toThrow();
    });
  });

  describe('getOptionsFromEnvironment', () => {
    it('should parse all environment variables', () => {
      process.env.DCR_STORE_TYPE = 'file';
      process.env.DCR_FILE_PATH = '/custom/path.json';
      process.env.DCR_DEFAULT_SECRET_EXPIRY = '3600';
      process.env.DCR_ENABLE_AUTO_CLEANUP = 'true';
      process.env.DCR_MAX_CLIENTS = '100';

      const options = ClientStoreFactory.getOptionsFromEnvironment();

      expect(options.storeType).toBe('file');
      expect(options.filePath).toBe('/custom/path.json');
      expect(options.defaultSecretExpirySeconds).toBe(3600);
      expect(options.enableAutoCleanup).toBe(true);
      expect(options.maxClients).toBe(100);
    });

    it('should handle missing environment variables', () => {
      const options = ClientStoreFactory.getOptionsFromEnvironment();

      expect(options.storeType).toBe('auto');
      expect(options.filePath).toBeUndefined();
      expect(options.defaultSecretExpirySeconds).toBeUndefined();
      expect(options.enableAutoCleanup).toBe(false);
      expect(options.maxClients).toBeUndefined();
    });

    it('should parse boolean values correctly', () => {
      process.env.DCR_ENABLE_AUTO_CLEANUP = 'false';

      const options = ClientStoreFactory.getOptionsFromEnvironment();

      expect(options.enableAutoCleanup).toBe(false);
    });

    it('should parse numeric values correctly', () => {
      process.env.DCR_DEFAULT_SECRET_EXPIRY = '0';
      process.env.DCR_MAX_CLIENTS = '1000';

      const options = ClientStoreFactory.getOptionsFromEnvironment();

      expect(options.defaultSecretExpirySeconds).toBe(0);
      expect(options.maxClients).toBe(1000);
    });
  });

  describe('Redis validation', () => {
    it('should throw error when creating Redis store without REDIS_URL', () => {
      expect(() => {
        ClientStoreFactory.create({ storeType: 'redis' });
      }).toThrow('Redis URL not configured');
    });

    it('should succeed when creating Redis store with REDIS_URL', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const store = ClientStoreFactory.create({ storeType: 'redis' });

      expect(store).toBeInstanceOf(RedisClientStore);

      delete process.env.REDIS_URL;
    });
  });

  describe('default values', () => {
    it('should use sensible defaults when no options provided', async () => {
      const store = ClientStoreFactory.create({ storeType: 'memory' }) as InMemoryClientStore;

      const client = await store.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      });

      // Should have default 30-day expiry
      const expectedExpiry = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
      expect(client.client_secret_expires_at).toBeGreaterThan(expectedExpiry - 10);
      expect(client.client_secret_expires_at).toBeLessThan(expectedExpiry + 10);

      store.dispose();
    });
  });
});