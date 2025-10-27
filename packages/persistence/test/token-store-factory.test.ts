/**
 * Unit tests for TokenStoreFactory
 */

import { TokenStoreFactory, createTokenStore } from '../src/index.js';
import { InMemoryTestTokenStore } from './helpers/memory-test-token-store.js';
import { FileTokenStore } from '../src/index.js';
import { preserveEnv } from '@mcp-typescript-simple/testing/env-helper';
import { getTestEncryptionKey } from './helpers/encryption-test-helper.js';

describe('TokenStoreFactory', () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = preserveEnv();
    // Set encryption key for tests (factory uses this directly in test mode)
    process.env.TOKEN_ENCRYPTION_KEY = getTestEncryptionKey();
  });

  afterEach(() => {
    restoreEnv();
  });

  describe('create with explicit type', () => {
    it('should create memory store when type is memory', async () => {
      const store = await TokenStoreFactory.create({ type: 'memory' });
      expect(store).toBeInstanceOf(InMemoryTestTokenStore);
    });

    it('should create file store when type is file', async () => {
      const store = await TokenStoreFactory.create({ type: 'file' });
      expect(store).toBeInstanceOf(FileTokenStore);
    });

    it('should throw error for unknown type', async () => {
      await expect(async () => {
        await TokenStoreFactory.create({ type: 'unknown' as any });
      }).rejects.toThrow('Unknown token store type: unknown');
    });
  });

  describe('auto-detection', () => {
    it('should detect test environment and create memory store', async () => {
      process.env.NODE_ENV = 'test';

      const store = await TokenStoreFactory.create({ type: 'auto' });
      expect(store).toBeInstanceOf(InMemoryTestTokenStore);
    });

    it('should detect JEST_WORKER_ID and create memory store', async () => {
      process.env.JEST_WORKER_ID = '1';

      const store = await TokenStoreFactory.create({ type: 'auto' });
      expect(store).toBeInstanceOf(InMemoryTestTokenStore);
    });

    it('should create file store when explicitly requested', async () => {
      // Cannot test auto-detection of file store in test environment
      // because VITEST_WORKER_ID is always set by Vitest runtime
      // Instead, test that file store can be explicitly created
      const store = await TokenStoreFactory.create({ type: 'file' });
      expect(store).toBeInstanceOf(FileTokenStore);
    });

    it('should create file store with encryption', async () => {
      // Verify file store is created with encryption service
      // when TOKEN_ENCRYPTION_KEY is set (which it is in tests)
      const store = await TokenStoreFactory.create({ type: 'file' });
      expect(store).toBeInstanceOf(FileTokenStore);

      // File store should work with encryption - basic smoke test
      const tokenData = await store.createToken({ metadata: { test: true } });
      const result = await store.validateAndUseToken(tokenData.token);

      expect(result.valid).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.token?.id).toBe(tokenData.id);
    });
  });

  describe('validateEnvironment', () => {
    it('should validate memory store with warnings', () => {
      const result = TokenStoreFactory.validateEnvironment('memory');

      expect(result.valid).toBe(true);
      expect(result.storeType).toBe('memory');
      expect(result.warnings).toContain('Memory store is not persistent - tokens will be lost on restart');
      expect(result.warnings).toContain('Memory store not suitable for multi-instance deployments');
    });

    it('should validate file store with warnings', () => {
      const result = TokenStoreFactory.validateEnvironment('file');

      expect(result.valid).toBe(true);
      expect(result.storeType).toBe('file');
      expect(result.warnings).toContain('File store not suitable for multi-instance deployments');
      expect(result.warnings).toContain('File store not suitable for serverless deployments');
    });

    it('should validate auto-detection for test environment', () => {
      process.env.NODE_ENV = 'test';

      const result = TokenStoreFactory.validateEnvironment('auto');

      expect(result.valid).toBe(true);
      expect(result.storeType).toBe('memory');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should validate auto-detection defaults to file', () => {
      // Clear test environment variables to simulate no environment detection
      delete process.env.NODE_ENV;
      delete process.env.JEST_WORKER_ID;
      delete process.env.VITEST;
      delete process.env.VITEST_WORKER_ID;

      const result = TokenStoreFactory.validateEnvironment('auto');

      expect(result.valid).toBe(true);
      expect(result.storeType).toBe('file');
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('createTokenStore convenience function', () => {
    it('should create store with default options', async () => {
      const store = await createTokenStore();
      expect(store).toBeDefined();
    });

    it('should pass options through to factory', async () => {
      const store = await createTokenStore({ type: 'memory' });
      expect(store).toBeInstanceOf(InMemoryTestTokenStore);
    });

    it('should support custom file path', async () => {
      const store = await createTokenStore({
        type: 'file',
        filePath: './custom/path/tokens.json',
      });
      expect(store).toBeInstanceOf(FileTokenStore);
    });

    it('should support auto cleanup for memory store', async () => {
      const store = await createTokenStore({
        type: 'memory',
        autoCleanup: true,
        cleanupIntervalMs: 5000,
      });
      expect(store).toBeInstanceOf(InMemoryTestTokenStore);
    });
  });

  describe('store configuration', () => {
    it('should configure memory store with custom options', async () => {
      const store = await TokenStoreFactory.create({
        type: 'memory',
        autoCleanup: true,
        cleanupIntervalMs: 10000,
      });

      expect(store).toBeInstanceOf(InMemoryTestTokenStore);
    });

    it('should configure file store with custom options', async () => {
      const store = await TokenStoreFactory.create({
        type: 'file',
        filePath: './test-tokens.json',
        debounceMs: 500,
      });

      expect(store).toBeInstanceOf(FileTokenStore);
    });
  });
});