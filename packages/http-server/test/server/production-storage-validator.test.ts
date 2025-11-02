/**
 * Unit tests for production storage validator
 *
 * Tests the fail-fast validation that ensures production deployments
 * use Redis instead of file/memory stores.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateProductionStorage, getStorageBackendStatus } from '../../src/server/production-storage-validator.js';

describe('Production Storage Validator', () => {
  // Save original environment
  const originalEnv = { ...process.env };
  const originalExit = process.exit;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;
    delete process.env.VERCEL_ENV;
    delete process.env.REDIS_URL;

    // Mock process.exit to prevent test termination
    process.exit = vi.fn() as never;
  });

  afterEach(() => {
    // Restore original environment and process.exit
    process.env = originalEnv;
    process.exit = originalExit;
    vi.restoreAllMocks();
  });

  describe('validateProductionStorage', () => {
    describe('Development/Test Environments', () => {
      it('should allow any storage in development (no NODE_ENV)', () => {
        // No NODE_ENV set = development
        delete process.env.NODE_ENV;
        delete process.env.VERCEL_ENV;
        delete process.env.REDIS_URL;

        expect(() => validateProductionStorage()).not.toThrow();
        expect(process.exit).not.toHaveBeenCalled();
      });

      it('should allow any storage in development (NODE_ENV=development)', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.REDIS_URL;

        expect(() => validateProductionStorage()).not.toThrow();
        expect(process.exit).not.toHaveBeenCalled();
      });

      it('should allow any storage in test environment', () => {
        process.env.NODE_ENV = 'test';
        delete process.env.REDIS_URL;

        expect(() => validateProductionStorage()).not.toThrow();
        expect(process.exit).not.toHaveBeenCalled();
      });

      it('should allow development with Redis configured', () => {
        process.env.NODE_ENV = 'development';
        process.env.REDIS_URL = 'redis://localhost:6379';

        expect(() => validateProductionStorage()).not.toThrow();
        expect(process.exit).not.toHaveBeenCalled();
      });
    });

    describe('Production Environment - NODE_ENV=production', () => {
      it('should FAIL FAST when production without Redis (NODE_ENV=production)', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.REDIS_URL;

        validateProductionStorage();

        // Should call process.exit(1)
        expect(process.exit).toHaveBeenCalledWith(1);
      });

      it('should succeed when production with Redis (NODE_ENV=production)', () => {
        process.env.NODE_ENV = 'production';
        process.env.REDIS_URL = 'redis://localhost:6379';

        expect(() => validateProductionStorage()).not.toThrow();
        expect(process.exit).not.toHaveBeenCalled();
      });
    });

    describe('Production Environment - VERCEL_ENV=production', () => {
      it('should FAIL FAST when Vercel production without Redis', () => {
        process.env.VERCEL_ENV = 'production';
        delete process.env.REDIS_URL;

        validateProductionStorage();

        // Should call process.exit(1)
        expect(process.exit).toHaveBeenCalledWith(1);
      });

      it('should succeed when Vercel production with Redis', () => {
        process.env.VERCEL_ENV = 'production';
        process.env.REDIS_URL = 'redis://upstash.example.com:6379';

        expect(() => validateProductionStorage()).not.toThrow();
        expect(process.exit).not.toHaveBeenCalled();
      });
    });

    describe('Production Environment - Both ENV vars set', () => {
      it('should FAIL FAST when both production ENVs without Redis', () => {
        process.env.NODE_ENV = 'production';
        process.env.VERCEL_ENV = 'production';
        delete process.env.REDIS_URL;

        validateProductionStorage();

        // Should call process.exit(1)
        expect(process.exit).toHaveBeenCalledWith(1);
      });

      it('should succeed when both production ENVs with Redis', () => {
        process.env.NODE_ENV = 'production';
        process.env.VERCEL_ENV = 'production';
        process.env.REDIS_URL = 'redis://production.example.com:6379';

        expect(() => validateProductionStorage()).not.toThrow();
        expect(process.exit).not.toHaveBeenCalled();
      });
    });

    describe('Edge Cases', () => {
      it('should allow Vercel preview deployments without Redis', () => {
        process.env.VERCEL_ENV = 'preview'; // Not production
        delete process.env.REDIS_URL;

        expect(() => validateProductionStorage()).not.toThrow();
        expect(process.exit).not.toHaveBeenCalled();
      });

      it('should handle empty REDIS_URL as missing', () => {
        process.env.NODE_ENV = 'production';
        process.env.REDIS_URL = ''; // Empty string

        validateProductionStorage();

        // Should call process.exit(1) - empty is same as missing
        expect(process.exit).toHaveBeenCalledWith(1);
      });

      it('should accept any valid Redis URL format', () => {
        process.env.NODE_ENV = 'production';

        // Test various Redis URL formats
        const redisUrls = [
          'redis://localhost:6379',
          'redis://default:password@localhost:6379',
          'rediss://upstash.example.com:6379', // TLS
          'redis://:password@redis.example.com:6379',
        ];

        for (const url of redisUrls) {
          vi.clearAllMocks();
          process.env.REDIS_URL = url;

          expect(() => validateProductionStorage()).not.toThrow();
          expect(process.exit).not.toHaveBeenCalled();
        }
      });
    });
  });

  describe('getStorageBackendStatus', () => {
    describe('Environment Detection', () => {
      it('should detect development environment (no NODE_ENV)', () => {
        delete process.env.NODE_ENV;
        delete process.env.VERCEL_ENV;

        const status = getStorageBackendStatus();

        expect(status.environment).toBe('development');
      });

      it('should detect test environment', () => {
        process.env.NODE_ENV = 'test';

        const status = getStorageBackendStatus();

        expect(status.environment).toBe('test');
      });

      it('should detect production environment (NODE_ENV=production)', () => {
        process.env.NODE_ENV = 'production';

        const status = getStorageBackendStatus();

        expect(status.environment).toBe('production');
      });

      it('should detect production environment (VERCEL_ENV=production)', () => {
        process.env.VERCEL_ENV = 'production';

        const status = getStorageBackendStatus();

        expect(status.environment).toBe('production');
      });
    });

    describe('Backend Detection', () => {
      it('should detect redis backend when REDIS_URL is set', () => {
        process.env.REDIS_URL = 'redis://localhost:6379';

        const status = getStorageBackendStatus();

        expect(status.backend).toBe('redis');
        expect(status.redisConfigured).toBe(true);
      });

      it('should detect memory backend in test environment', () => {
        process.env.NODE_ENV = 'test';
        delete process.env.REDIS_URL;

        const status = getStorageBackendStatus();

        expect(status.backend).toBe('memory');
        expect(status.redisConfigured).toBe(false);
      });

      it('should detect file backend in development', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.REDIS_URL;

        const status = getStorageBackendStatus();

        expect(status.backend).toBe('file');
        expect(status.redisConfigured).toBe(false);
      });
    });

    describe('Validation Status', () => {
      it('should be valid when production with Redis', () => {
        process.env.NODE_ENV = 'production';
        process.env.REDIS_URL = 'redis://localhost:6379';

        const status = getStorageBackendStatus();

        expect(status.valid).toBe(true);
      });

      it('should be INVALID when production without Redis', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.REDIS_URL;

        const status = getStorageBackendStatus();

        expect(status.valid).toBe(false);
      });

      it('should be valid when development without Redis', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.REDIS_URL;

        const status = getStorageBackendStatus();

        expect(status.valid).toBe(true);
      });

      it('should be valid when test without Redis', () => {
        process.env.NODE_ENV = 'test';
        delete process.env.REDIS_URL;

        const status = getStorageBackendStatus();

        expect(status.valid).toBe(true);
      });
    });

    describe('Complete Status Object', () => {
      it('should return complete status for production with Redis', () => {
        process.env.NODE_ENV = 'production';
        process.env.REDIS_URL = 'redis://production.example.com:6379';

        const status = getStorageBackendStatus();

        expect(status).toEqual({
          environment: 'production',
          backend: 'redis',
          redisConfigured: true,
          valid: true,
        });
      });

      it('should return complete status for production without Redis (INVALID)', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.REDIS_URL;

        const status = getStorageBackendStatus();

        expect(status).toEqual({
          environment: 'production',
          backend: 'file', // Fallback to file (but invalid!)
          redisConfigured: false,
          valid: false, // ❌ INVALID
        });
      });

      it('should return complete status for development with file storage', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.REDIS_URL;

        const status = getStorageBackendStatus();

        expect(status).toEqual({
          environment: 'development',
          backend: 'file',
          redisConfigured: false,
          valid: true, // ✅ Valid - file storage OK in development
        });
      });

      it('should return complete status for test with memory storage', () => {
        process.env.NODE_ENV = 'test';
        delete process.env.REDIS_URL;

        const status = getStorageBackendStatus();

        expect(status).toEqual({
          environment: 'test',
          backend: 'memory',
          redisConfigured: false,
          valid: true, // ✅ Valid - memory storage OK in test
        });
      });
    });
  });
});
