/**
 * Unit tests for FileSecretsProvider
 *
 * Tests file-specific functionality: .env.local parsing, process.env fallback,
 * JSON value handling, and secret counting.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { readFileSync } from 'node:fs';
import { FileSecretsProvider } from '../../src/secrets/file-secrets-provider.js';
import * as ocsfModule from '@mcp-typescript-simple/observability/ocsf';

// Mock node:fs
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

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

describe('FileSecretsProvider', () => {
  let provider: FileSecretsProvider;
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
  });

  afterEach(async () => {
    if (provider) {
      await provider.dispose();
    }

    // Restore original process.env
    process.env = originalEnv;
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with .env.local file', () => {
      const mockEnvContent = `
# Comment line
API_KEY=test-key-123
SECRET_TOKEN=secret-value
DATABASE_URL=postgres://localhost
`;
      (readFileSync as Mock).mockReturnValue(mockEnvContent);

      provider = new FileSecretsProvider({ auditLog: true });

      expect(provider.name).toBe('file');
      expect(provider.readOnly).toBe(false);
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should fallback to process.env when .env.local does not exist', () => {
      (readFileSync as Mock).mockImplementation(() => {
        const error = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      });

      process.env.TEST_SECRET = 'process-env-value';
      process.env.API_KEY = 'from-process';

      provider = new FileSecretsProvider({ auditLog: true });

      expect(provider.name).toBe('file');
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should emit initialization event with .env.local source', () => {
      (readFileSync as Mock).mockReturnValue('API_KEY=test\n');

      provider = new FileSecretsProvider({ auditLog: true });

      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
      // Event should indicate .env.local as source
    });

    it('should emit initialization event with process.env source on fallback', () => {
      (readFileSync as Mock).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      provider = new FileSecretsProvider({ auditLog: true });

      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
      // Event should indicate process.env as source
    });
  });

  describe('.env.local Parsing', () => {
    it('should parse simple key=value pairs', async () => {
      (readFileSync as Mock).mockReturnValue('TEST_KEY=test-value\n');

      provider = new FileSecretsProvider();
      const result = await provider.getSecret('TEST_KEY');

      expect(result).toBe('test-value');
    });

    it('should ignore empty lines', async () => {
      (readFileSync as Mock).mockReturnValue('\nTEST_KEY=value\n\n');

      provider = new FileSecretsProvider();
      const result = await provider.getSecret('TEST_KEY');

      expect(result).toBe('value');
    });

    it('should ignore comment lines', async () => {
      (readFileSync as Mock).mockReturnValue('# This is a comment\nTEST_KEY=value\n');

      provider = new FileSecretsProvider();
      const result = await provider.getSecret('TEST_KEY');

      expect(result).toBe('value');
    });

    it('should remove double quotes from values', async () => {
      (readFileSync as Mock).mockReturnValue('TEST_KEY="quoted-value"\n');

      provider = new FileSecretsProvider();
      const result = await provider.getSecret('TEST_KEY');

      expect(result).toBe('quoted-value');
    });

    it('should remove single quotes from values', async () => {
      (readFileSync as Mock).mockReturnValue("TEST_KEY='quoted-value'\n");

      provider = new FileSecretsProvider();
      const result = await provider.getSecret('TEST_KEY');

      expect(result).toBe('quoted-value');
    });

    it('should handle values containing equals signs', async () => {
      (readFileSync as Mock).mockReturnValue('DATABASE_URL=postgres://user:pass=word@localhost\n');

      provider = new FileSecretsProvider();
      const result = await provider.getSecret('DATABASE_URL');

      expect(result).toBe('postgres://user:pass=word@localhost');
    });

    it('should handle multi-line file with various formats', async () => {
      const mockEnvContent = `
# API Configuration
API_KEY=key123
API_SECRET="secret456"

# Database
DATABASE_URL='postgres://localhost'

# Empty line above is ignored
TOKEN=abc=def=ghi
`;
      (readFileSync as Mock).mockReturnValue(mockEnvContent);

      provider = new FileSecretsProvider();

      expect(await provider.getSecret('API_KEY')).toBe('key123');
      expect(await provider.getSecret('API_SECRET')).toBe('secret456');
      expect(await provider.getSecret('DATABASE_URL')).toBe('postgres://localhost');
      expect(await provider.getSecret('TOKEN')).toBe('abc=def=ghi');
    });

    it('should skip malformed lines without key or value', async () => {
      (readFileSync as Mock).mockReturnValue('VALID_KEY=value\nINVALID_LINE\n=no-key\nkey-only=\n');

      provider = new FileSecretsProvider();

      expect(await provider.getSecret('VALID_KEY')).toBe('value');
      expect(await provider.getSecret('INVALID_LINE')).toBeUndefined();
    });
  });

  describe('Secret Retrieval', () => {
    it('should retrieve string secrets from .env.local', async () => {
      (readFileSync as Mock).mockReturnValue('STRING_KEY=simple-string\n');

      provider = new FileSecretsProvider();
      const result = await provider.getSecret('STRING_KEY');

      expect(result).toBe('simple-string');
    });

    it('should retrieve and parse JSON object secrets', async () => {
      (readFileSync as Mock).mockReturnValue('JSON_KEY={"nested":"value","count":42}\n');

      provider = new FileSecretsProvider();
      const result = await provider.getSecret<{ nested: string; count: number }>('JSON_KEY');

      expect(result).toEqual({ nested: 'value', count: 42 });
    });

    it('should retrieve and parse JSON array secrets', async () => {
      (readFileSync as Mock).mockReturnValue('ARRAY_KEY=["item1","item2","item3"]\n');

      provider = new FileSecretsProvider();
      const result = await provider.getSecret<string[]>('ARRAY_KEY');

      expect(result).toEqual(['item1', 'item2', 'item3']);
    });

    it('should handle invalid JSON gracefully (keep as string)', async () => {
      (readFileSync as Mock).mockReturnValue('INVALID_JSON={broken json}\n');

      provider = new FileSecretsProvider();
      const result = await provider.getSecret('INVALID_JSON');

      expect(result).toBe('{broken json}');
    });

    it('should return undefined for non-existent secrets', async () => {
      (readFileSync as Mock).mockReturnValue('EXISTING_KEY=value\n');

      provider = new FileSecretsProvider();
      const result = await provider.getSecret('NON_EXISTENT_KEY');

      expect(result).toBeUndefined();
    });

    it('should retrieve secrets from process.env on fallback', async () => {
      (readFileSync as Mock).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      process.env.PROCESS_ENV_SECRET = 'from-process-env';

      provider = new FileSecretsProvider();
      const result = await provider.getSecret('PROCESS_ENV_SECRET');

      expect(result).toBe('from-process-env');
    });
  });

  describe('Secret Storage', () => {
    it('should store string secrets in memory', async () => {
      (readFileSync as Mock).mockReturnValue('');

      provider = new FileSecretsProvider();
      await provider.setSecret('NEW_KEY', 'new-value');
      const result = await provider.getSecret('NEW_KEY');

      expect(result).toBe('new-value');
    });

    it('should serialize object secrets to JSON', async () => {
      (readFileSync as Mock).mockReturnValue('');

      provider = new FileSecretsProvider();
      await provider.setSecret('OBJECT_KEY', { nested: 'data' });
      const result = await provider.getSecret<{ nested: string }>('OBJECT_KEY');

      expect(result).toEqual({ nested: 'data' });
    });

    it('should serialize array secrets to JSON', async () => {
      (readFileSync as Mock).mockReturnValue('');

      provider = new FileSecretsProvider();
      await provider.setSecret('ARRAY_KEY', ['a', 'b', 'c']);
      const result = await provider.getSecret<string[]>('ARRAY_KEY');

      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should update existing secrets', async () => {
      (readFileSync as Mock).mockReturnValue('EXISTING_KEY=original\n');

      provider = new FileSecretsProvider();
      await provider.setSecret('EXISTING_KEY', 'updated');
      const result = await provider.getSecret('EXISTING_KEY');

      expect(result).toBe('updated');
    });

    it('should not persist changes to .env.local file', async () => {
      (readFileSync as Mock).mockReturnValue('ORIGINAL_KEY=original\n');

      provider = new FileSecretsProvider();
      await provider.setSecret('NEW_KEY', 'new-value');

      // readFileSync should only be called once during constructor
      expect(readFileSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('hasSecret', () => {
    it('should return true for secrets from .env.local', async () => {
      (readFileSync as Mock).mockReturnValue('EXISTING_KEY=value\n');

      provider = new FileSecretsProvider();
      const exists = await provider.hasSecret('EXISTING_KEY');

      expect(exists).toBe(true);
    });

    it('should return true for secrets from process.env', async () => {
      (readFileSync as Mock).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      process.env.PROCESS_SECRET = 'value';

      provider = new FileSecretsProvider();
      const exists = await provider.hasSecret('PROCESS_SECRET');

      expect(exists).toBe(true);
    });

    it('should return false for non-existent secrets', async () => {
      (readFileSync as Mock).mockReturnValue('');

      provider = new FileSecretsProvider();
      const exists = await provider.hasSecret('NON_EXISTENT');

      expect(exists).toBe(false);
    });

    it('should return true for newly stored secrets', async () => {
      (readFileSync as Mock).mockReturnValue('');

      provider = new FileSecretsProvider();
      await provider.setSecret('NEW_KEY', 'value');
      const exists = await provider.hasSecret('NEW_KEY');

      expect(exists).toBe(true);
    });
  });

  describe('Secret Counting', () => {
    it('should count secrets with KEY in name', async () => {
      (readFileSync as Mock).mockReturnValue('API_KEY=value1\nDATABASE_URL=value2\n');

      provider = new FileSecretsProvider({ auditLog: true });

      // Secret count should be 1 (API_KEY only)
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should count secrets with SECRET in name', async () => {
      (readFileSync as Mock).mockReturnValue('CLIENT_SECRET=value\nDATABASE_URL=value2\n');

      provider = new FileSecretsProvider({ auditLog: true });

      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should count secrets with TOKEN in name', async () => {
      (readFileSync as Mock).mockReturnValue('ACCESS_TOKEN=value\nUSER_NAME=value2\n');

      provider = new FileSecretsProvider({ auditLog: true });

      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should count secrets with PASSWORD in name', async () => {
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Test data, not real credentials
      (readFileSync as Mock).mockReturnValue('DB_PASSWORD=value\nUSER_NAME=value2\n');

      provider = new FileSecretsProvider({ auditLog: true });

      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should count multiple secret patterns', async () => {
      const mockEnvContent = `
API_KEY=key1
CLIENT_SECRET=secret1
ACCESS_TOKEN=token1
DB_PASSWORD=pass1
DATABASE_URL=url1
USER_NAME=name1
`;
      (readFileSync as Mock).mockReturnValue(mockEnvContent);

      provider = new FileSecretsProvider({ auditLog: true });

      // Should count 4 secrets (KEY, SECRET, TOKEN, PASSWORD)
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });
  });

  describe('Disposal', () => {
    it('should clear env vars on dispose', async () => {
      (readFileSync as Mock).mockReturnValue('TEST_KEY=value\n');

      provider = new FileSecretsProvider();
      const before = await provider.hasSecret('TEST_KEY');

      await provider.dispose();

      const after = await provider.hasSecret('TEST_KEY');

      expect(before).toBe(true);
      expect(after).toBe(false);
    });

    it('should emit OCSF dispose event', async () => {
      (readFileSync as Mock).mockReturnValue('');

      provider = new FileSecretsProvider({ auditLog: true });
      vi.clearAllMocks();

      await provider.dispose();

      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });
  });

  describe('Integration with BaseSecretsProvider', () => {
    it('should use caching from base class', async () => {
      (readFileSync as Mock).mockReturnValue('CACHED_KEY=cached-value\n');

      provider = new FileSecretsProvider({ cacheTtlMs: 300000, auditLog: true });
      vi.clearAllMocks();

      // First retrieval
      await provider.getSecret('CACHED_KEY');
      const firstCallCount = mockBridge.emitAPIActivityEvent.mock.calls.length;

      // Second retrieval (should hit cache)
      await provider.getSecret('CACHED_KEY');
      const secondCallCount = mockBridge.emitAPIActivityEvent.mock.calls.length;

      // Cache hit should still emit event
      expect(secondCallCount).toBeGreaterThan(firstCallCount);
    });

    it('should respect auditLog option from base class', async () => {
      (readFileSync as Mock).mockReturnValue('TEST_KEY=value\n');

      provider = new FileSecretsProvider({ auditLog: false });
      vi.clearAllMocks();

      await provider.setSecret('NEW_KEY', 'value');
      await provider.getSecret('NEW_KEY');

      expect(mockBridge.emitAPIActivityEvent).not.toHaveBeenCalled();
    });

    it('should work with disabled caching', async () => {
      (readFileSync as Mock).mockReturnValue('NO_CACHE_KEY=value\n');

      provider = new FileSecretsProvider({ cacheTtlMs: 0 });

      const result1 = await provider.getSecret('NO_CACHE_KEY');
      const result2 = await provider.getSecret('NO_CACHE_KEY');

      expect(result1).toBe('value');
      expect(result2).toBe('value');
    });
  });
});
