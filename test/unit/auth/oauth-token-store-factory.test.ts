/**
 * Unit tests for OAuth Token Store Factory
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { OAuthTokenStoreFactory, createOAuthTokenStore } from '../../../src/auth/oauth-token-store-factory.js';

describe('OAuthTokenStoreFactory', () => {
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

      const store = OAuthTokenStoreFactory.create();

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('RedisOAuthTokenStore');
    });

    it('should create Memory store when REDIS_URL not configured', () => {
      delete process.env.REDIS_URL;

      const store = OAuthTokenStoreFactory.create();

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('MemoryOAuthTokenStore');
    });
  });

  describe('Explicit Type Selection', () => {
    it('should create MemoryOAuthTokenStore when explicitly requested', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const store = OAuthTokenStoreFactory.create({ type: 'memory' });

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('MemoryOAuthTokenStore');
    });

    it('should create RedisOAuthTokenStore when explicitly requested', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const store = OAuthTokenStoreFactory.create({ type: 'redis' });

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('RedisOAuthTokenStore');
    });

    it('should throw error when Redis requested but not configured', () => {
      delete process.env.REDIS_URL;

      expect(() => OAuthTokenStoreFactory.create({ type: 'redis' }))
        .toThrow('Redis URL not configured');
    });

    it('should throw error for unknown store type', () => {
      expect(() => OAuthTokenStoreFactory.create({ type: 'invalid' as any }))
        .toThrow('Unknown OAuth token store type');
    });
  });

  describe('Environment Validation', () => {
    it('should validate Redis environment', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const result = OAuthTokenStoreFactory.validateEnvironment('redis');

      expect(result.valid).toBe(true);
      expect(result.storeType).toBe('redis');
      expect(result.warnings).toHaveLength(0);
    });

    it('should fail validation when Redis not configured', () => {
      delete process.env.REDIS_URL;

      const result = OAuthTokenStoreFactory.validateEnvironment('redis');

      expect(result.valid).toBe(false);
      expect(result.storeType).toBe('redis');
      expect(result.warnings).toContain('REDIS_URL environment variable not configured');
    });

    it('should validate Memory store with warnings', () => {
      const result = OAuthTokenStoreFactory.validateEnvironment('memory');

      expect(result.valid).toBe(true);
      expect(result.storeType).toBe('memory');
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes('multi-instance'))).toBe(true);
    });

    it('should auto-detect Redis when REDIS_URL configured', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const result = OAuthTokenStoreFactory.validateEnvironment('auto');

      expect(result.valid).toBe(true);
      expect(result.storeType).toBe('redis');
    });

    it('should auto-detect Memory when REDIS_URL not configured', () => {
      delete process.env.REDIS_URL;

      const result = OAuthTokenStoreFactory.validateEnvironment('auto');

      expect(result.valid).toBe(true);
      expect(result.storeType).toBe('memory');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should validate with auto by default', () => {
      delete process.env.REDIS_URL;

      const result = OAuthTokenStoreFactory.validateEnvironment();

      expect(result.valid).toBe(true);
      expect(result.storeType).toBe('memory');
    });
  });

  describe('createOAuthTokenStore convenience function', () => {
    it('should create store with auto-detection', () => {
      delete process.env.REDIS_URL;

      const store = createOAuthTokenStore();

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('MemoryOAuthTokenStore');
    });

    it('should accept options parameter', () => {
      process.env.REDIS_URL = 'redis://localhost:6379';

      const store = createOAuthTokenStore({ type: 'redis' });

      expect(store).toBeDefined();
      expect(store.constructor.name).toBe('RedisOAuthTokenStore');
    });
  });
});
