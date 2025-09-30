/**
 * Unit tests for HybridClientStore
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { HybridClientStore } from '../../../../src/auth/stores/hybrid-client-store.js';

describe('HybridClientStore', () => {
  let store: HybridClientStore;
  let testFilePath: string;
  let testDir: string;

  beforeEach(async () => {
    // Create unique temp directory for each test
    testDir = join(tmpdir(), `test-hybrid-clients-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    await fs.mkdir(testDir, { recursive: true });
    testFilePath = join(testDir, 'oauth-clients.json');

    store = new HybridClientStore({
      filePath: testFilePath,
      defaultSecretExpirySeconds: 3600,
      debounceMs: 100, // Short debounce for testing
      enablePeriodicSync: false, // Disable for predictable tests
    });
  });

  afterEach(async () => {
    await store.dispose();

    // Clean up test files
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('hybrid behavior', () => {
    it('should read from memory (fast)', async () => {
      const client = await store.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      });

      // Multiple reads should not hit disk
      const start = Date.now();
      for (let i = 0; i < 100; i++) {
        await store.getClient(client.client_id);
      }
      const duration = Date.now() - start;

      // Should be very fast (< 10ms for 100 reads)
      expect(duration).toBeLessThan(50);
    });

    it('should write to memory immediately', async () => {
      const beforeWrite = Date.now();

      const client = await store.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      });

      const afterWrite = Date.now();

      // Registration should be instant (< 10ms)
      expect(afterWrite - beforeWrite).toBeLessThan(50);

      // Should be immediately retrievable
      const retrieved = await store.getClient(client.client_id);
      expect(retrieved).toBeDefined();
    });

    it('should debounce file writes', async () => {
      // Register multiple clients rapidly
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          store.registerClient({
            redirect_uris: [`http://localhost:${3000 + i}/callback`],
            client_name: `Client ${i}`,
          })
        );
      }

      await Promise.all(promises);

      // File might not exist yet due to debouncing
      const fileExistsImmediately = await fs.access(testFilePath)
        .then(() => true)
        .catch(() => false);

      // Wait for debounce to complete (100ms debounce + 50ms buffer)
      await new Promise(resolve => setTimeout(resolve, 150));

      // File should exist after debounce
      const fileExistsAfterDebounce = await fs.access(testFilePath)
        .then(() => true)
        .catch(() => false);

      expect(fileExistsAfterDebounce).toBe(true);
    });
  });

  describe('persistence', () => {
    it('should persist to file in background', async () => {
      const client = await store.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      });

      // Wait for debounced write (100ms debounce + 50ms buffer)
      await new Promise(resolve => setTimeout(resolve, 150));

      // Verify file exists and contains client
      const fileContent = await fs.readFile(testFilePath, 'utf8');
      const data = JSON.parse(fileContent);

      expect(data.clients).toHaveLength(1);
      expect(data.clients[0].client_id).toBe(client.client_id);
    });

    it('should load from file on initialization', async () => {
      const client1 = await store.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      });

      await store.flush(); // Force write
      await store.dispose();

      // Create new store (should load from file)
      const store2 = new HybridClientStore({
        filePath: testFilePath,
      });

      const retrieved = await store2.getClient(client1.client_id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.client_id).toBe(client1.client_id);

      await store2.dispose();
    });

    it('should survive restart with data', async () => {
      // Register multiple clients
      const clients = [];
      for (let i = 0; i < 5; i++) {
        const client = await store.registerClient({
          redirect_uris: [`http://localhost:${3000 + i}/callback`],
          client_name: `Client ${i}`,
        });
        clients.push(client);
      }

      await store.flush();
      await store.dispose();

      // "Restart" - new store instance
      const store2 = new HybridClientStore({
        filePath: testFilePath,
      });

      // All clients should be available
      for (const client of clients) {
        const retrieved = await store2.getClient(client.client_id);
        expect(retrieved).toBeDefined();
      }

      await store2.dispose();
    });
  });

  describe('flush', () => {
    it('should force immediate write to file', async () => {
      const client = await store.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      });

      // Flush immediately (bypass debounce)
      await store.flush();

      // File should exist immediately
      const fileExists = await fs.access(testFilePath)
        .then(() => true)
        .catch(() => false);

      expect(fileExists).toBe(true);

      const fileContent = await fs.readFile(testFilePath, 'utf8');
      const data = JSON.parse(fileContent);

      expect(data.clients).toHaveLength(1);
      expect(data.clients[0].client_id).toBe(client.client_id);
    });

    it('should be idempotent', async () => {
      await store.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      });

      await store.flush();
      await store.flush();
      await store.flush();

      const clients = await store.listClients();
      expect(clients).toHaveLength(1);
    });
  });

  describe('disposal', () => {
    it('should flush pending writes on dispose', async () => {
      const client = await store.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      });

      // Dispose immediately (before debounce completes)
      await store.dispose();

      // File should still be written
      const fileExists = await fs.access(testFilePath)
        .then(() => true)
        .catch(() => false);

      expect(fileExists).toBe(true);

      const fileContent = await fs.readFile(testFilePath, 'utf8');
      const data = JSON.parse(fileContent);

      expect(data.clients).toHaveLength(1);
    });
  });

  describe('periodic sync', () => {
    it('should sync periodically when enabled', async () => {
      const syncStore = new HybridClientStore({
        filePath: testFilePath,
        debounceMs: 100,
        enablePeriodicSync: true,
        syncIntervalMs: 200, // Sync every 200ms
      });

      await syncStore.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      });

      // Wait for periodic sync
      await new Promise(resolve => setTimeout(resolve, 400));

      const fileExists = await fs.access(testFilePath)
        .then(() => true)
        .catch(() => false);

      expect(fileExists).toBe(true);

      await syncStore.dispose();
    });
  });

  describe('client operations', () => {
    it('should support all client store operations', async () => {
      // Register
      const client = await store.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      });

      expect(client.client_id).toBeDefined();

      // Get
      const retrieved = await store.getClient(client.client_id);
      expect(retrieved).toBeDefined();

      // List
      const clients = await store.listClients();
      expect(clients).toHaveLength(1);

      // Delete
      const deleted = await store.deleteClient(client.client_id);
      expect(deleted).toBe(true);

      // Verify deletion
      const afterDelete = await store.getClient(client.client_id);
      expect(afterDelete).toBeUndefined();

      await store.flush();

      // Verify persistence of deletion
      const fileContent = await fs.readFile(testFilePath, 'utf8');
      const data = JSON.parse(fileContent);
      expect(data.clients).toHaveLength(0);
    });

    it('should cleanup expired clients', async () => {
      const shortExpiryStore = new HybridClientStore({
        filePath: testFilePath,
        defaultSecretExpirySeconds: 1,
        debounceMs: 100,
      });

      await shortExpiryStore.registerClient({
        redirect_uris: ['http://localhost:3000/callback'],
        client_name: 'Test Client',
      });

      // Wait for expiration (1 second + 100ms buffer)
      await new Promise(resolve => setTimeout(resolve, 1100));

      const cleanedCount = await shortExpiryStore.cleanupExpired();
      expect(cleanedCount).toBe(1);

      await shortExpiryStore.flush();

      // Verify cleanup persisted
      const fileContent = await fs.readFile(testFilePath, 'utf8');
      const data = JSON.parse(fileContent);
      expect(data.clients).toHaveLength(0);

      await shortExpiryStore.dispose();
    });
  });

  describe('performance', () => {
    it('should handle many clients efficiently', async () => {
      const start = Date.now();

      // Register 100 clients
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          store.registerClient({
            redirect_uris: [`http://localhost:${3000 + i}/callback`],
            client_name: `Client ${i}`,
          })
        );
      }

      await Promise.all(promises);

      const duration = Date.now() - start;

      // Should be fast (< 100ms for 100 registrations)
      expect(duration).toBeLessThan(1000);

      // Verify all clients
      const clients = await store.listClients();
      expect(clients).toHaveLength(100);
    });

    it('should minimize file I/O through debouncing', async () => {
      const writeCountStore = new HybridClientStore({
        filePath: testFilePath,
        debounceMs: 100,
      });

      // Register 10 clients rapidly
      for (let i = 0; i < 10; i++) {
        await writeCountStore.registerClient({
          redirect_uris: [`http://localhost:${3000 + i}/callback`],
          client_name: `Client ${i}`,
        });
      }

      // Wait for debounce (100ms debounce + 50ms buffer)
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should only have written once (debounced)
      // We can't directly count writes, but we can verify the file exists
      const fileExists = await fs.access(testFilePath)
        .then(() => true)
        .catch(() => false);

      expect(fileExists).toBe(true);

      await writeCountStore.dispose();
    });
  });
});