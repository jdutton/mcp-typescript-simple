/**
 * Unit tests for FileTokenStore
 */

import { FileTokenStore } from '../../../src/auth/stores/file-token-store.js';
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('FileTokenStore', () => {
  let store: FileTokenStore;
  let testDir: string;
  let testFilePath: string;

  beforeEach(() => {
    // Create temporary directory for test files
    testDir = join(tmpdir(), `token-store-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    testFilePath = join(testDir, 'tokens.json');

    store = new FileTokenStore({
      filePath: testFilePath,
      debounceMs: 0, // Disable debouncing for tests
    });
  });

  afterEach(async () => {
    await store.dispose();

    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('createToken', () => {
    it('should create a token and persist to file', async () => {
      const token = await store.createToken({
        description: 'Test token',
      });

      expect(token.id).toBeDefined();
      expect(token.token).toBeDefined();

      // Wait for file write
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify file exists
      expect(existsSync(testFilePath)).toBe(true);

      // Verify file content
      const content = readFileSync(testFilePath, 'utf8');
      const data = JSON.parse(content);
      expect(data.tokens).toHaveLength(1);
      expect(data.tokens[0].id).toBe(token.id);
    });

    it('should create multiple tokens', async () => {
      await store.createToken({ description: 'Token 1' });
      await store.createToken({ description: 'Token 2' });
      await store.createToken({ description: 'Token 3' });

      const tokens = await store.listTokens();
      expect(tokens).toHaveLength(3);
    });
  });

  describe('persistence', () => {
    it('should load tokens from existing file on startup', async () => {
      const token1 = await store.createToken({ description: 'Token 1' });
      const token2 = await store.createToken({ description: 'Token 2' });

      // Wait for file write
      await new Promise(resolve => setTimeout(resolve, 100));

      await store.dispose();

      // Create new store instance
      const newStore = new FileTokenStore({ filePath: testFilePath });

      const tokens = await newStore.listTokens();
      expect(tokens).toHaveLength(2);

      const retrieved1 = await newStore.getToken(token1.id);
      expect(retrieved1?.description).toBe('Token 1');

      const retrieved2 = await newStore.getToken(token2.id);
      expect(retrieved2?.description).toBe('Token 2');

      await newStore.dispose();
    });

    it('should handle missing file gracefully', async () => {
      const nonExistentPath = join(testDir, 'non-existent.json');
      const newStore = new FileTokenStore({ filePath: nonExistentPath });

      const tokens = await newStore.listTokens();
      expect(tokens).toHaveLength(0);

      await newStore.dispose();
    });

    it('should create backup on write', async () => {
      await store.createToken({ description: 'Token 1' });

      // Wait for file write
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create second token to trigger backup
      await store.createToken({ description: 'Token 2' });

      // Wait for file write
      await new Promise(resolve => setTimeout(resolve, 100));

      const backupPath = `${testFilePath}.backup`;
      expect(existsSync(backupPath)).toBe(true);
    });
  });

  describe('validateAndUseToken', () => {
    it('should validate and persist usage updates', async () => {
      const created = await store.createToken({ description: 'Test token' });

      const result = await store.validateAndUseToken(created.token);

      expect(result.valid).toBe(true);
      expect(result.token?.usage_count).toBe(1);

      // Wait for file write
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create new store and verify persistence
      await store.dispose();
      const newStore = new FileTokenStore({ filePath: testFilePath });

      const retrieved = await newStore.getToken(created.id);
      expect(retrieved?.usage_count).toBe(1);
      expect(retrieved?.last_used_at).toBeDefined();

      await newStore.dispose();
    });
  });

  describe('revokeToken', () => {
    it('should revoke token and persist', async () => {
      const token = await store.createToken({ description: 'Test token' });

      await store.revokeToken(token.id);

      // Wait for file write
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create new store and verify persistence
      await store.dispose();
      const newStore = new FileTokenStore({ filePath: testFilePath });

      const retrieved = await newStore.getToken(token.id);
      expect(retrieved?.revoked).toBe(true);

      await newStore.dispose();
    });
  });

  describe('deleteToken', () => {
    it('should delete token and persist', async () => {
      const token = await store.createToken({ description: 'Test token' });

      await store.deleteToken(token.id);

      // Wait for file write
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create new store and verify persistence
      await store.dispose();
      const newStore = new FileTokenStore({ filePath: testFilePath });

      const retrieved = await newStore.getToken(token.id);
      expect(retrieved).toBeUndefined();

      await newStore.dispose();
    });
  });

  describe('cleanup', () => {
    it('should remove expired/revoked and persist', async () => {
      const expired = await store.createToken({ description: 'Expired', expires_in: -1 });
      const revoked = await store.createToken({ description: 'Revoked' });
      await store.createToken({ description: 'Active' });

      await store.revokeToken(revoked.id);

      const cleaned = await store.cleanup();
      expect(cleaned).toBe(2);

      // Wait for file write
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create new store and verify persistence
      await store.dispose();
      const newStore = new FileTokenStore({ filePath: testFilePath });

      const tokens = await newStore.listTokens({ includeRevoked: true, includeExpired: true });
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.description).toBe('Active');

      await newStore.dispose();
    });
  });

  describe('debouncing', () => {
    it('should debounce writes', async () => {
      const debouncedStore = new FileTokenStore({
        filePath: testFilePath,
        debounceMs: 1000,
      });

      await debouncedStore.createToken({ description: 'Token 1' });
      await debouncedStore.createToken({ description: 'Token 2' });
      await debouncedStore.createToken({ description: 'Token 3' });

      // File should not exist yet (writes are debounced)
      expect(existsSync(testFilePath)).toBe(false);

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 1100));

      // File should exist now
      expect(existsSync(testFilePath)).toBe(true);

      const content = readFileSync(testFilePath, 'utf8');
      const data = JSON.parse(content);
      expect(data.tokens).toHaveLength(3);

      await debouncedStore.dispose();
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent token creation', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        store.createToken({ description: `Token ${i}` })
      );

      const tokens = await Promise.all(promises);

      expect(tokens).toHaveLength(10);

      // All tokens should have unique IDs
      const ids = new Set(tokens.map(t => t.id));
      expect(ids.size).toBe(10);

      // Wait for file write
      await new Promise(resolve => setTimeout(resolve, 100));

      const listTokens = await store.listTokens();
      expect(listTokens).toHaveLength(10);
    });
  });

  describe('error handling', () => {
    it('should handle corrupt file gracefully', async () => {
      // Write corrupt JSON to file
      const fs = await import('fs/promises');
      await fs.writeFile(testFilePath, 'invalid json {', 'utf8');

      // Create new store - should handle corrupt file
      const newStore = new FileTokenStore({ filePath: testFilePath });

      // Should start with empty store
      const tokens = await newStore.listTokens();
      expect(tokens).toHaveLength(0);

      // Should be able to create new tokens
      await newStore.createToken({ description: 'New token' });

      const newTokens = await newStore.listTokens();
      expect(newTokens).toHaveLength(1);

      await newStore.dispose();
    });
  });

  describe('listTokens', () => {
    it('should list all active tokens', async () => {
      await store.createToken({ description: 'Token 1' });
      await store.createToken({ description: 'Token 2' });

      const tokens = await store.listTokens();
      expect(tokens).toHaveLength(2);
    });

    it('should filter by revoked/expired status', async () => {
      const token1 = await store.createToken({ description: 'Token 1' });
      await store.createToken({ description: 'Token 2', expires_in: -1 });

      await store.revokeToken(token1.id);

      const activeOnly = await store.listTokens();
      expect(activeOnly).toHaveLength(0);

      const includeRevoked = await store.listTokens({ includeRevoked: true });
      expect(includeRevoked).toHaveLength(1);

      const includeExpired = await store.listTokens({ includeExpired: true });
      expect(includeExpired).toHaveLength(1);

      const includeAll = await store.listTokens({ includeRevoked: true, includeExpired: true });
      expect(includeAll).toHaveLength(2);
    });
  });
});