/**
 * Unit tests for FileClientStore
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileClientStore } from '../../../../src/auth/stores/file-client-store.js';

describe('FileClientStore', () => {
  let store: FileClientStore;
  let testFilePath: string;
  let testDir: string;

  beforeEach(async () => {
    // Create unique temp directory for each test
    testDir = join(tmpdir(), `test-oauth-clients-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'oauth-clients.json');

    store = new FileClientStore(testFilePath, {
      defaultSecretExpirySeconds: 3600, // 1 hour for testing
      maxClients: 100,
    });
  });

  afterEach(async () => {
    store.dispose();

    // Clean up test files
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('persistence', () => {
    it('should persist client to file on registration', async () => {
      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      const registered = await store.registerClient(clientMetadata);

      // Check file exists
      const fileExists = await fs.access(testFilePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      // Read and verify file content
      const fileContent = await fs.readFile(testFilePath, 'utf8');
      const data = JSON.parse(fileContent);

      expect(data.version).toBe(1);
      expect(data.updatedAt).toBeDefined();
      expect(data.clients).toHaveLength(1);
      expect(data.clients[0].client_id).toBe(registered.client_id);
    });

    it('should load existing clients from file on initialization', async () => {
      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      const client1 = await store.registerClient(clientMetadata);
      store.dispose();

      // Create new store instance (should load from file)
      const store2 = new FileClientStore(testFilePath);

      const retrieved = await store2.getClient(client1.client_id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.client_id).toBe(client1.client_id);
      expect(retrieved!.client_secret).toBe(client1.client_secret);

      store2.dispose();
    });

    it('should survive server restart', async () => {
      const clients = [];

      // Register multiple clients
      for (let i = 0; i < 5; i++) {
        const client = await store.registerClient({
          redirect_uris: [`http://localhost:${3000 + i}/callback`],
          client_name: `Client ${i}`,
        });
        clients.push(client);
      }

      store.dispose();

      // "Restart" by creating new store instance
      const store2 = new FileClientStore(testFilePath);

      // Verify all clients are still there
      for (const client of clients) {
        const retrieved = await store2.getClient(client.client_id);
        expect(retrieved).toBeDefined();
        expect(retrieved!.client_id).toBe(client.client_id);
      }

      const allClients = await store2.listClients();
      expect(allClients).toHaveLength(5);

      store2.dispose();
    });

    it('should create backup file on update', async () => {
      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      await store.registerClient(clientMetadata);
      await store.registerClient(clientMetadata); // Trigger another save

      const backupExists = await fs.access(`${testFilePath}.backup`).then(() => true).catch(() => false);
      expect(backupExists).toBe(true);
    });

    it('should handle missing file gracefully on initialization', () => {
      const nonExistentPath = join(testDir, 'non-existent.json');
      expect(() => new FileClientStore(nonExistentPath)).not.toThrow();
    });
  });

  describe('atomic writes', () => {
    it('should use atomic write strategy (temp file + rename)', async () => {
      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      await store.registerClient(clientMetadata);

      // Temp file should not exist after write completes
      const tempExists = await fs.access(`${testFilePath}.tmp`).then(() => true).catch(() => false);
      expect(tempExists).toBe(false);

      // Main file should exist
      const mainExists = await fs.access(testFilePath).then(() => true).catch(() => false);
      expect(mainExists).toBe(true);
    });

    it('should create directory if it does not exist', async () => {
      const deepPath = join(testDir, 'deep', 'nested', 'path', 'clients.json');
      const deepStore = new FileClientStore(deepPath);

      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      await deepStore.registerClient(clientMetadata);

      const fileExists = await fs.access(deepPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      deepStore.dispose();
    });
  });

  describe('reload', () => {
    it('should reload clients from file', async () => {
      const client1 = await store.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Client 1',
      });

      // Manually modify the file
      const fileContent = await fs.readFile(testFilePath, 'utf8');
      const data = JSON.parse(fileContent);
      data.clients.push({
        client_id: 'manually-added-id',
        client_secret: 'manually-added-secret',
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: ['http://localhost:4000/callback'],
        client_name: 'Manual Client',
      });
      await fs.writeFile(testFilePath, JSON.stringify(data, null, 2));

      // Reload from file
      await store.reload();

      const retrieved = await store.getClient('manually-added-id');
      expect(retrieved).toBeDefined();
      expect(retrieved!.client_name).toBe('Manual Client');
    });
  });

  describe('registerClient', () => {
    it('should register and persist client', async () => {
      const clientMetadata = {
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      };

      const registered = await store.registerClient(clientMetadata);

      expect(registered.client_id).toBeDefined();
      expect(registered.client_secret).toBeDefined();

      // Verify persistence
      const retrieved = await store.getClient(registered.client_id);
      expect(retrieved).toEqual(registered);
    });
  });

  describe('deleteClient', () => {
    it('should delete and persist removal', async () => {
      const client = await store.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      });

      const deleted = await store.deleteClient(client.client_id);
      expect(deleted).toBe(true);

      // Verify file updated
      const fileContent = await fs.readFile(testFilePath, 'utf8');
      const data = JSON.parse(fileContent);
      expect(data.clients).toHaveLength(0);

      // Verify after reload
      await store.reload();
      const retrieved = await store.getClient(client.client_id);
      expect(retrieved).toBeUndefined();
    });
  });

  describe('cleanupExpired', () => {
    it('should persist cleanup to file', async () => {
      const shortExpiryStore = new FileClientStore(testFilePath, {
        defaultSecretExpirySeconds: 1, // 1 second
      });

      await shortExpiryStore.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      });

      // Wait for expiration (1 second + 100ms buffer)
      await new Promise(resolve => setTimeout(resolve, 1100));

      const cleanedCount = await shortExpiryStore.cleanupExpired();
      expect(cleanedCount).toBe(1);

      // Verify file updated
      const fileContent = await fs.readFile(testFilePath, 'utf8');
      const data = JSON.parse(fileContent);
      expect(data.clients).toHaveLength(0);

      shortExpiryStore.dispose();
    });
  });

  describe('concurrent operations', () => {
    it('should handle rapid sequential writes without corruption', async () => {
      const promises = [];

      // Register 10 clients rapidly
      for (let i = 0; i < 10; i++) {
        promises.push(
          store.registerClient({
            redirect_uris: [`http://localhost:${3000 + i}/callback`],
            client_name: `Client ${i}`,
          })
        );
      }

      const clients = await Promise.all(promises);

      // Verify all clients are retrievable
      for (const client of clients) {
        const retrieved = await store.getClient(client.client_id);
        expect(retrieved).toBeDefined();
      }

      // Verify file has all clients
      const allClients = await store.listClients();
      expect(allClients).toHaveLength(10);
    });
  });

  describe('file format', () => {
    it('should use version 1 format', async () => {
      await store.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      });

      const fileContent = await fs.readFile(testFilePath, 'utf8');
      const data = JSON.parse(fileContent);

      expect(data.version).toBe(1);
      expect(data.updatedAt).toBeDefined();
      expect(data.clients).toBeInstanceOf(Array);
    });

    it('should be human-readable JSON', async () => {
      await store.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      });

      const fileContent = await fs.readFile(testFilePath, 'utf8');

      // Should be pretty-printed with 2-space indentation
      expect(fileContent).toContain('\n');
      expect(fileContent).toContain('  ');
      expect(() => JSON.parse(fileContent)).not.toThrow();
    });
  });
});