/**
 * Unit tests for VercelSecretsProvider
 *
 * Tests Vercel platform-specific functionality including process.env access,
 * JSON value parsing, and read-only behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { VercelSecretsProvider } from '../../src/secrets/vercel-secrets-provider.js';
import * as ocsfModule from '@mcp-typescript-simple/observability/ocsf';

// Mock the OCSF module
vi.mock('@mcp-typescript-simple/observability/ocsf', () => ({
  getOCSFOTELBridge: vi.fn(() => ({
    emitAPIActivityEvent: vi.fn(),
  })),
  readAPIEvent: vi.fn(() => ({
    actor: vi.fn().mockReturnThis(),
    api: vi.fn().mockReturnThis(),
    resource: vi.fn().mockReturnThis(),
    message: vi.fn().mockReturnThis(),
    severity: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    duration: vi.fn().mockReturnThis(),
    unmapped: vi.fn().mockReturnThis(),
    build: vi.fn(() => ({})),
  })),
  createAPIEvent: vi.fn(() => ({
    actor: vi.fn().mockReturnThis(),
    api: vi.fn().mockReturnThis(),
    resource: vi.fn().mockReturnThis(),
    message: vi.fn().mockReturnThis(),
    severity: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    duration: vi.fn().mockReturnThis(),
    unmapped: vi.fn().mockReturnThis(),
    build: vi.fn(() => ({})),
  })),
  SeverityId: {
    Informational: 1,
  },
  StatusId: {
    Success: 1,
    Failure: 2,
  },
}));

describe('VercelSecretsProvider', () => {
  let provider: VercelSecretsProvider;
  let mockBridge: { emitAPIActivityEvent: Mock };
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBridge = {
      emitAPIActivityEvent: vi.fn(),
    };
    (ocsfModule.getOCSFOTELBridge as Mock).mockReturnValue(mockBridge);

    // Save original process.env
    originalEnv = { ...process.env };

    // Set VERCEL env var (required for VercelSecretsProvider)
    process.env.VERCEL = '1';
  });

  afterEach(async () => {
    if (provider) {
      await provider.dispose();
    }

    // Restore original process.env
    process.env = originalEnv;
  });

  describe('Constructor and Initialization', () => {
    it('should initialize on Vercel platform', () => {
      process.env.VERCEL = '1';
      process.env.VERCEL_REGION = 'iad1';
      process.env.VERCEL_ENV = 'production';

      provider = new VercelSecretsProvider({ auditLog: true });

      expect(provider.name).toBe('vercel');
      expect(provider.readOnly).toBe(true);
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should throw error when not on Vercel platform', () => {
      delete process.env.VERCEL;

      // Intentional: Testing constructor throws error (required for toThrow() validation)
      expect(() => {
        new VercelSecretsProvider();
      }).toThrow('VercelSecretsProvider requires VERCEL=1 environment variable');
    });

    it('should emit initialization event with Vercel metadata', () => {
      process.env.VERCEL = '1';
      process.env.VERCEL_REGION = 'sfo1';
      process.env.VERCEL_ENV = 'preview';

      provider = new VercelSecretsProvider({ auditLog: true });

      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should handle missing VERCEL_REGION and VERCEL_ENV', () => {
      process.env.VERCEL = '1';
      delete process.env.VERCEL_REGION;
      delete process.env.VERCEL_ENV;

      provider = new VercelSecretsProvider({ auditLog: true });

      expect(provider.name).toBe('vercel');
    });

    it('should be marked as read-only', () => {
      provider = new VercelSecretsProvider({ auditLog: true });

      expect(provider.readOnly).toBe(true);
    });
  });

  describe('Secret Retrieval (retrieveSecret)', () => {
    beforeEach(() => {
      provider = new VercelSecretsProvider({ auditLog: true });
    });

    it('should retrieve string secret from process.env', async () => {
      process.env.API_KEY = 'test-api-key-123';

      const value = await provider.getSecret('API_KEY');

      expect(value).toBe('test-api-key-123');
    });

    it('should return undefined for non-existent secret', async () => {
      delete process.env.MISSING_KEY;

      const value = await provider.getSecret('MISSING_KEY');

      expect(value).toBeUndefined();
    });

    it('should parse JSON object values', async () => {
      process.env.CONFIG = '{"host":"localhost","port":3000}';

      const value = await provider.getSecret<{ host: string; port: number }>('CONFIG');

      expect(value).toEqual({ host: 'localhost', port: 3000 });
    });

    it('should parse JSON array values', async () => {
      process.env.ALLOWED_ORIGINS = '["http://localhost:3000","https://example.com"]';

      const value = await provider.getSecret<string[]>('ALLOWED_ORIGINS');

      expect(value).toEqual(['http://localhost:3000', 'https://example.com']);
    });

    it('should keep non-JSON string values as strings', async () => {
      process.env.DATABASE_URL = 'postgres://user:pass@localhost/db';

      const value = await provider.getSecret('DATABASE_URL');

      expect(value).toBe('postgres://user:pass@localhost/db');
    });

    it('should handle invalid JSON gracefully', async () => {
      process.env.INVALID_JSON = '{invalid json}';

      const value = await provider.getSecret('INVALID_JSON');

      // Should return as string when JSON parsing fails
      expect(value).toBe('{invalid json}');
    });

    it('should handle string that starts with { but is not JSON', async () => {
      process.env.CURLY_STRING = '{not-json-at-all';

      const value = await provider.getSecret('CURLY_STRING');

      expect(value).toBe('{not-json-at-all');
    });

    it('should handle string that starts with [ but is not JSON', async () => {
      process.env.BRACKET_STRING = '[not-json-at-all';

      const value = await provider.getSecret('BRACKET_STRING');

      expect(value).toBe('[not-json-at-all');
    });

    it('should handle empty string values', async () => {
      process.env.EMPTY_VALUE = '';

      const value = await provider.getSecret('EMPTY_VALUE');

      expect(value).toBe('');
    });

    it('should handle complex nested JSON', async () => {
      process.env.COMPLEX_CONFIG = JSON.stringify({
        database: { host: 'localhost', port: 5432 },
        cache: { ttl: 300 },
        features: ['auth', 'logging'],
      });

      const value = await provider.getSecret<{
        database: { host: string; port: number };
        cache: { ttl: number };
        features: string[];
      }>('COMPLEX_CONFIG');

      expect(value).toEqual({
        database: { host: 'localhost', port: 5432 },
        cache: { ttl: 300 },
        features: ['auth', 'logging'],
      });
    });
  });

  describe('Secret Storage (storeSecret)', () => {
    beforeEach(() => {
      provider = new VercelSecretsProvider({ auditLog: true });
    });

    it('should throw error when attempting to store secret', async () => {
      await expect(provider.setSecret('NEW_KEY', 'new-value')).rejects.toThrow(
        'VercelSecretsProvider is read-only'
      );
    });

    it('should provide helpful error message with CLI command', async () => {
      await expect(provider.setSecret('API_KEY', 'value')).rejects.toThrow(
        'vercel env add <key> <environment>'
      );
    });

    it('should throw error for complex values too', async () => {
      await expect(
        provider.setSecret('CONFIG', { host: 'localhost', port: 3000 })
      ).rejects.toThrow('VercelSecretsProvider is read-only');
    });
  });

  describe('hasSecret', () => {
    beforeEach(() => {
      provider = new VercelSecretsProvider({ auditLog: true });
    });

    it('should return true for existing secret', async () => {
      process.env.EXISTING_KEY = 'value';

      const exists = await provider.hasSecret('EXISTING_KEY');

      expect(exists).toBe(true);
    });

    it('should return false for non-existent secret', async () => {
      delete process.env.MISSING_KEY;

      const exists = await provider.hasSecret('MISSING_KEY');

      expect(exists).toBe(false);
    });

    it('should return true for empty string values', async () => {
      process.env.EMPTY_VALUE = '';

      const exists = await provider.hasSecret('EMPTY_VALUE');

      expect(exists).toBe(true);
    });

    it('should return false for undefined values', async () => {
      process.env.EXPLICIT_UNDEFINED = undefined as unknown as string;

      const exists = await provider.hasSecret('EXPLICIT_UNDEFINED');

      expect(exists).toBe(false);
    });
  });

  describe('BaseSecretsProvider Integration', () => {
    beforeEach(() => {
      provider = new VercelSecretsProvider({
        cacheTtlMs: 1000,
        auditLog: true,
      });
    });

    it('should cache secret retrieval', async () => {
      process.env.CACHED_KEY = 'cached-value';

      // First call - should access process.env
      const value1 = await provider.getSecret('CACHED_KEY');
      expect(value1).toBe('cached-value');

      // Change process.env (but cache should return old value)
      process.env.CACHED_KEY = 'new-value';

      // Second call - should use cache
      const value2 = await provider.getSecret('CACHED_KEY');
      expect(value2).toBe('cached-value'); // Still old value from cache
    });

    it('should emit OCSF events for secret operations', async () => {
      process.env.AUDIT_KEY = 'audit-value';

      await provider.getSecret('AUDIT_KEY');

      // Should emit OCSF event via BaseSecretsProvider
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should handle cache expiration', async () => {
      const shortCacheProvider = new VercelSecretsProvider({
        cacheTtlMs: 10, // 10ms cache
        auditLog: true,
      });

      process.env.EXPIRE_KEY = 'initial-value';

      // First call - populate cache
      const value1 = await shortCacheProvider.getSecret('EXPIRE_KEY');
      expect(value1).toBe('initial-value');

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Change value
      process.env.EXPIRE_KEY = 'updated-value';

      // Second call - cache expired, should get new value
      const value2 = await shortCacheProvider.getSecret('EXPIRE_KEY');
      expect(value2).toBe('updated-value');

      await shortCacheProvider.dispose();
    });
  });

  describe('Disposal', () => {
    it('should dispose without errors', async () => {
      provider = new VercelSecretsProvider({ auditLog: true });

      await expect(provider.dispose()).resolves.toBeUndefined();
    });

    it('should be reusable after disposal', async () => {
      provider = new VercelSecretsProvider({ auditLog: true });

      await provider.dispose();

      // Should not throw
      await expect(provider.dispose()).resolves.toBeUndefined();
    });

    it('should still be usable after disposal (stateless)', async () => {
      provider = new VercelSecretsProvider({ auditLog: true });
      process.env.TEST_KEY = 'test-value';

      await provider.dispose();

      // Should still work (no resources to clean up)
      const value = await provider.getSecret('TEST_KEY');
      expect(value).toBe('test-value');
    });
  });

  describe('Vercel Platform Detection', () => {
    it('should detect production environment', () => {
      process.env.VERCEL = '1';
      process.env.VERCEL_ENV = 'production';

      provider = new VercelSecretsProvider({ auditLog: true });

      expect(provider.name).toBe('vercel');
    });

    it('should detect preview environment', () => {
      process.env.VERCEL = '1';
      process.env.VERCEL_ENV = 'preview';

      provider = new VercelSecretsProvider({ auditLog: true });

      expect(provider.name).toBe('vercel');
    });

    it('should detect development environment', () => {
      process.env.VERCEL = '1';
      process.env.VERCEL_ENV = 'development';

      provider = new VercelSecretsProvider({ auditLog: true });

      expect(provider.name).toBe('vercel');
    });

    it('should work with different Vercel regions', () => {
      process.env.VERCEL = '1';
      process.env.VERCEL_REGION = 'cdg1'; // Paris

      provider = new VercelSecretsProvider({ auditLog: true });

      expect(provider.name).toBe('vercel');
    });
  });
});
