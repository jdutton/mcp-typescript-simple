/**
 * Unit tests for TokenStoreFactory
 */

import { TokenStoreFactory, createTokenStore } from '../../../src/auth/token-store-factory.js';
import { InMemoryTokenStore } from '../../../src/auth/stores/memory-token-store.js';
import { FileTokenStore } from '../../../src/auth/stores/file-token-store.js';
describe('TokenStoreFactory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.VERCEL;
    delete process.env.NODE_ENV;
    delete process.env.JEST_WORKER_ID;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('create with explicit type', () => {
    it('should create memory store when type is memory', () => {
      const store = TokenStoreFactory.create({ type: 'memory' });
      expect(store).toBeInstanceOf(InMemoryTokenStore);
    });

    it('should create file store when type is file', () => {
      const store = TokenStoreFactory.create({ type: 'file' });
      expect(store).toBeInstanceOf(FileTokenStore);
    });

    it('should throw error for unknown type', () => {
      expect(() => {
        TokenStoreFactory.create({ type: 'unknown' as any });
      }).toThrow('Unknown token store type: unknown');
    });
  });

  describe('auto-detection', () => {
    it('should detect test environment and create memory store', () => {
      process.env.NODE_ENV = 'test';

      const store = TokenStoreFactory.create({ type: 'auto' });
      expect(store).toBeInstanceOf(InMemoryTokenStore);
    });

    it('should detect JEST_WORKER_ID and create memory store', () => {
      process.env.JEST_WORKER_ID = '1';

      const store = TokenStoreFactory.create({ type: 'auto' });
      expect(store).toBeInstanceOf(InMemoryTokenStore);
    });

    it('should default to file store for development', () => {
      process.env.NODE_ENV = 'development';

      const store = TokenStoreFactory.create({ type: 'auto' });
      expect(store).toBeInstanceOf(FileTokenStore);
    });

    it('should default to file store when no environment detected', () => {
      const store = TokenStoreFactory.create({ type: 'auto' });
      expect(store).toBeInstanceOf(FileTokenStore);
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
      const result = TokenStoreFactory.validateEnvironment('auto');

      expect(result.valid).toBe(true);
      expect(result.storeType).toBe('file');
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('createTokenStore convenience function', () => {
    it('should create store with default options', () => {
      const store = createTokenStore();
      expect(store).toBeDefined();
    });

    it('should pass options through to factory', () => {
      const store = createTokenStore({ type: 'memory' });
      expect(store).toBeInstanceOf(InMemoryTokenStore);
    });

    it('should support custom file path', () => {
      const store = createTokenStore({
        type: 'file',
        filePath: './custom/path/tokens.json',
      });
      expect(store).toBeInstanceOf(FileTokenStore);
    });

    it('should support auto cleanup for memory store', () => {
      const store = createTokenStore({
        type: 'memory',
        autoCleanup: true,
        cleanupIntervalMs: 5000,
      });
      expect(store).toBeInstanceOf(InMemoryTokenStore);
    });
  });

  describe('store configuration', () => {
    it('should configure memory store with custom options', () => {
      const store = TokenStoreFactory.create({
        type: 'memory',
        autoCleanup: true,
        cleanupIntervalMs: 10000,
      });

      expect(store).toBeInstanceOf(InMemoryTokenStore);
    });

    it('should configure file store with custom options', () => {
      const store = TokenStoreFactory.create({
        type: 'file',
        filePath: './test-tokens.json',
        debounceMs: 500,
      });

      expect(store).toBeInstanceOf(FileTokenStore);
    });
  });
});