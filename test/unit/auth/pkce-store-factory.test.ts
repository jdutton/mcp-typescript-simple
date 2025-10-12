/**
 * Unit tests for PKCE Store Factory
 */

import { PKCEStoreFactory, createPKCEStore } from '../../../src/auth/pkce-store-factory.js';
import { preserveEnv } from '../../helpers/env-helper.js';

describe('PKCEStoreFactory', () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = preserveEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  describe('Production Environment', () => {
    it('should throw error when Redis not configured in production', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.REDIS_URL;

      expect(() => PKCEStoreFactory.create()).toThrow('Redis required for PKCE store in production');
    });

    it('should create RedisPKCEStore when Redis configured in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_URL = 'redis://localhost:6379';

      const store = PKCEStoreFactory.create();

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('RedisPKCEStore');
    });
  });

  describe('Test Environment', () => {
    it('should create MemoryPKCEStore in test environment', () => {
      process.env.NODE_ENV = 'test';
      delete process.env.REDIS_URL;

      const store = PKCEStoreFactory.create();

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('MemoryPKCEStore');
    });
  });

  describe('Development Environment', () => {
    it('should create MemoryPKCEStore in development without Redis', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.REDIS_URL;

      const store = PKCEStoreFactory.create();

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('MemoryPKCEStore');
    });

    it('should create RedisPKCEStore when Redis configured in development', () => {
      process.env.NODE_ENV = 'development';
      process.env.REDIS_URL = 'redis://localhost:6379';

      const store = PKCEStoreFactory.create();

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('RedisPKCEStore');
    });
  });

  describe('Explicit Type Selection', () => {
    it('should create MemoryPKCEStore when explicitly requested', () => {
      process.env.NODE_ENV = 'production';
      process.env.REDIS_URL = 'redis://localhost:6379';

      const store = PKCEStoreFactory.create({ type: 'memory' });

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('MemoryPKCEStore');
    });

    it('should create RedisPKCEStore when explicitly requested', () => {
      process.env.NODE_ENV = 'development';
      process.env.REDIS_URL = 'redis://localhost:6379';

      const store = PKCEStoreFactory.create({ type: 'redis' });

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('RedisPKCEStore');
    });

    it('should throw error for unknown store type', () => {
      expect(() => PKCEStoreFactory.create({ type: 'invalid' as any })).toThrow('Unknown PKCE store type');
    });
  });

  describe('createPKCEStore convenience function', () => {
    it('should create store with auto-detection', () => {
      process.env.NODE_ENV = 'test';

      const store = createPKCEStore();

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('MemoryPKCEStore');
    });

    it('should accept options parameter', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const store = createPKCEStore({ type: 'redis' });

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('RedisPKCEStore');
    });
  });
});
