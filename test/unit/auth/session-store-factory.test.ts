/**
 * Unit tests for OAuth Session Store Factory
 */

import { SessionStoreFactory, createSessionStore } from '../../../src/auth/session-store-factory.js';

describe('SessionStoreFactory', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Auto-Detection', () => {
    it('should create Redis store when REDIS_URL configured', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const store = SessionStoreFactory.create();

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('RedisSessionStore');
    });

    it('should create Memory store when REDIS_URL not configured', () => {
      delete process.env.REDIS_URL;

      const store = SessionStoreFactory.create();

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('MemorySessionStore');
    });
  });

  describe('Explicit Type Selection', () => {
    it('should create MemorySessionStore when explicitly requested', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const store = SessionStoreFactory.create({ type: 'memory' });

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('MemorySessionStore');
    });

    it('should create RedisSessionStore when explicitly requested', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const store = SessionStoreFactory.create({ type: 'redis' });

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('RedisSessionStore');
    });

    it('should throw error when Redis requested but not configured', () => {
      delete process.env.REDIS_URL;

      expect(() => SessionStoreFactory.create({ type: 'redis' }))
        .toThrow('Redis URL not configured');
    });

    it('should throw error for unknown store type', () => {
      expect(() => SessionStoreFactory.create({ type: 'invalid' as any }))
        .toThrow('Unknown session store type');
    });
  });

  describe('Environment Validation', () => {
    it('should validate Redis environment', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const result = SessionStoreFactory.validateEnvironment('redis');

      expect(result.valid).toBe(true);
      expect(result.storeType).toBe('redis');
      expect(result.warnings).toHaveLength(0);
    });

    it('should fail validation when Redis not configured', () => {
      delete process.env.REDIS_URL;

      const result = SessionStoreFactory.validateEnvironment('redis');

      expect(result.valid).toBe(false);
      expect(result.storeType).toBe('redis');
      expect(result.warnings).toContain('REDIS_URL environment variable not configured');
    });

    it('should validate Memory store with warnings', () => {
      const result = SessionStoreFactory.validateEnvironment('memory');

      expect(result.valid).toBe(true);
      expect(result.storeType).toBe('memory');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('multi-instance'))).toBe(true);
    });

    it('should auto-detect Redis when REDIS_URL configured', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const result = SessionStoreFactory.validateEnvironment('auto');

      expect(result.valid).toBe(true);
      expect(result.storeType).toBe('redis');
    });

    it('should auto-detect Memory when REDIS_URL not configured', () => {
      delete process.env.REDIS_URL;

      const result = SessionStoreFactory.validateEnvironment('auto');

      expect(result.valid).toBe(true);
      expect(result.storeType).toBe('memory');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should validate with auto by default', () => {
      delete process.env.REDIS_URL;

      const result = SessionStoreFactory.validateEnvironment();

      expect(result.valid).toBe(true);
      expect(result.storeType).toBe('memory');
    });
  });

  describe('createSessionStore convenience function', () => {
    it('should create store with auto-detection', () => {
      delete process.env.REDIS_URL;

      const store = createSessionStore();

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('MemorySessionStore');
    });

    it('should accept options parameter', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const store = createSessionStore({ type: 'redis' });

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('RedisSessionStore');
    });
  });
});
