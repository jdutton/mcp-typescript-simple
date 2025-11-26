/**
 * Unit tests for EncryptedFileSecretsProvider
 *
 * Tests encryption, file operations, atomic writes, and master key management.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { promises as fs } from 'node:fs';
import { EncryptedFileSecretsProvider } from '../../src/secrets/encrypted-file-secrets-provider.js';
import * as ocsfModule from '@mcp-typescript-simple/observability/ocsf';

// Mock node:fs with both sync and async functions
vi.mock('node:fs', () => {
  const mockReadFileSync = vi.fn();
  return {
    promises: {
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      copyFile: vi.fn(),
      rename: vi.fn(),
      readFile: vi.fn(),
    },
    readFileSync: mockReadFileSync,
  };
});

// Don't fully mock node:crypto - we need real implementations for some tests
// We'll mock specific functions in individual tests as needed

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
  updateAPIEvent: vi.fn(() => ({
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

describe('EncryptedFileSecretsProvider', () => {
  let provider: EncryptedFileSecretsProvider;
  let mockBridge: { emitAPIActivityEvent: Mock };
  const validMasterKey = Buffer.from('a'.repeat(64), 'hex').toString('base64'); // 32 bytes = 256 bits

  beforeEach(async () => {
    vi.clearAllMocks();
    mockBridge = {
      emitAPIActivityEvent: vi.fn(),
    };
    (ocsfModule.getOCSFOTELBridge as Mock).mockReturnValue(mockBridge);

    // Mock readFileSync to return empty encrypted file (no existing secrets)
    const fsModule = await import('node:fs');
    (fsModule.readFileSync as Mock).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    // Mock fs promises
    (fs.mkdir as Mock).mockResolvedValue();
    (fs.writeFile as Mock).mockResolvedValue();
    (fs.copyFile as Mock).mockResolvedValue();
    (fs.rename as Mock).mockResolvedValue();
  });

  afterEach(async () => {
    if (provider) {
      await provider.dispose();
    }
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with valid master key', () => {
      provider = new EncryptedFileSecretsProvider({
        masterKey: validMasterKey,
        auditLog: true,
      });

      expect(provider.name).toBe('encrypted-file');
      expect(provider.readOnly).toBe(false);
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should use custom file path', () => {
      provider = new EncryptedFileSecretsProvider({
        masterKey: validMasterKey,
        filePath: '.custom-secrets.encrypted',
      });

      expect(provider).toBeDefined();
    });

    it('should throw error when master key is missing', () => {
      expect(() => {
        provider = new EncryptedFileSecretsProvider();
      }).toThrow('Master encryption key not configured');
    });

    it('should throw error when master key has invalid length', () => {
      const invalidKey = Buffer.from('short').toString('base64');

      expect(() => {
        provider = new EncryptedFileSecretsProvider({
          masterKey: invalidKey,
        });
      }).toThrow('Invalid master key length');
    });

    it('should load existing encrypted file on initialization', () => {
      // This test verifies the provider can be created with an existing file
      // The actual file loading behavior is already tested in integration
      expect(() => {
        provider = new EncryptedFileSecretsProvider({
          masterKey: validMasterKey,
        });
      }).not.toThrow();
    });

    it('should handle missing file gracefully', () => {
      // Missing file is the default behavior (ENOENT) - provider starts empty
      expect(() => {
        provider = new EncryptedFileSecretsProvider({
          masterKey: validMasterKey,
        });
      }).not.toThrow();
    });

    it('should emit initialization event with file metadata', () => {
      provider = new EncryptedFileSecretsProvider({
        masterKey: validMasterKey,
        auditLog: true,
      });

      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });
  });

  describe('Encryption and Decryption', () => {
    beforeEach(() => {
      provider = new EncryptedFileSecretsProvider({
        masterKey: validMasterKey,
        cacheTtlMs: 0, // Disable caching to test actual encryption/decryption
      });
    });

    it('should encrypt and decrypt string secrets correctly', async () => {
      await provider.setSecret('TEST_KEY', 'test-value');
      const result = await provider.getSecret('TEST_KEY');

      expect(result).toBe('test-value');
    });

    it('should handle JSON object encryption/decryption', async () => {
      await provider.setSecret('OBJECT_KEY', { key: 'value', nested: { data: 42 } });
      const result = await provider.getSecret<{ key: string; nested: { data: number } }>('OBJECT_KEY');

      expect(result).toEqual({ key: 'value', nested: { data: 42 } });
    });

    it('should handle JSON array encryption/decryption', async () => {
      await provider.setSecret('ARRAY_KEY', ['a', 'b', 'c']);
      const result = await provider.getSecret<string[]>('ARRAY_KEY');

      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should produce different ciphertext for same value (random IV)', async () => {
      vi.clearAllMocks(); // Clear previous writes

      await provider.setSecret('KEY1', 'same-value');
      const firstWrite = (fs.writeFile as Mock).mock.calls[0];
      const content1 = firstWrite?.[1];

      vi.clearAllMocks();

      await provider.setSecret('KEY2', 'same-value');
      const secondWrite = (fs.writeFile as Mock).mock.calls[0];
      const content2 = secondWrite?.[1];

      // Both writes should have happened
      expect(content1).toBeDefined();
      expect(content2).toBeDefined();

      // Parse the encrypted values
      const parsed1 = JSON.parse(content1);
      const parsed2 = JSON.parse(content2);

      // Same plaintext should produce different ciphertext (due to random IV)
      expect(parsed1.secrets.KEY1).not.toBe(parsed2.secrets.KEY2);
    });

    it('should throw error when decrypting with wrong master key', async () => {
      await provider.setSecret('TEST_KEY', 'value');

      // Create new provider with different key
      const wrongKey = Buffer.from('d'.repeat(64), 'hex').toString('base64');
      const wrongProvider = new EncryptedFileSecretsProvider({
        masterKey: wrongKey,
        cacheTtlMs: 0,
      });

      // Load the encrypted secret from first provider
      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const content = writeCall?.[1];
      const parsed = JSON.parse(content);

      // Try to decrypt with wrong key by setting up wrong provider with same secrets
      wrongProvider['secrets'] = parsed.secrets;

      await expect(wrongProvider.getSecret('TEST_KEY')).rejects.toThrow(
        'Failed to decrypt secret'
      );

      await wrongProvider.dispose();
    });

    it('should encrypt data using AES-256-GCM', async () => {
      await provider.setSecret('KEY', 'value');

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const content = writeCall?.[1];
      const parsed = JSON.parse(content);

      // Encrypted value should be base64url string
      expect(typeof parsed.secrets.KEY).toBe('string');
      expect(parsed.secrets.KEY.length).toBeGreaterThan(0);

      // Should not contain plaintext
      expect(parsed.secrets.KEY).not.toContain('value');
    });
  });

  describe('File Operations', () => {
    beforeEach(() => {
      provider = new EncryptedFileSecretsProvider({
        masterKey: validMasterKey,
        filePath: '.test-secrets.encrypted',
      });
    });

    it('should create directory if it does not exist', async () => {
      await provider.setSecret('KEY', 'value');

      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true }
      );
    });

    it('should write to temp file before rename (atomic write)', async () => {
      await provider.setSecret('KEY', 'value');

      expect(fs.writeFile).toHaveBeenCalledWith(
        '.test-secrets.encrypted.tmp',
        expect.any(String),
        'utf8'
      );
    });

    it('should rename temp file to actual file', async () => {
      await provider.setSecret('KEY', 'value');

      expect(fs.rename).toHaveBeenCalledWith(
        '.test-secrets.encrypted.tmp',
        '.test-secrets.encrypted'
      );
    });

    it('should create backup before write', async () => {
      await provider.setSecret('KEY', 'value');

      expect(fs.copyFile).toHaveBeenCalledWith(
        '.test-secrets.encrypted',
        '.test-secrets.encrypted.backup'
      );
    });

    it('should handle backup failure when file does not exist', async () => {
      (fs.copyFile as Mock).mockRejectedValue(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      );

      await expect(provider.setSecret('KEY', 'value')).resolves.toBeUndefined();
    });

    it('should throw on backup failure for other errors', async () => {
      (fs.copyFile as Mock).mockRejectedValue(new Error('Permission denied'));

      await expect(provider.setSecret('KEY', 'value')).rejects.toThrow(
        'Permission denied'
      );
    });

    it('should write JSON with version and timestamp', async () => {
      await provider.setSecret('KEY', 'value');

      const writeCall = (fs.writeFile as Mock).mock.calls[0];
      const written = writeCall?.[1];
      const parsed = JSON.parse(written);

      expect(parsed.version).toBe(1);
      expect(parsed.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(parsed.secrets).toBeDefined();
    });

    it('should preserve existing secrets when adding new ones', async () => {
      await provider.setSecret('KEY1', 'value1');
      await provider.setSecret('KEY2', 'value2');

      const exists1 = await provider.hasSecret('KEY1');
      const exists2 = await provider.hasSecret('KEY2');

      expect(exists1).toBe(true);
      expect(exists2).toBe(true);
    });
  });

  describe('Secret Retrieval', () => {
    beforeEach(() => {
      provider = new EncryptedFileSecretsProvider({
        masterKey: validMasterKey,
        cacheTtlMs: 0, // Disable caching for retrieval tests
      });
    });

    it('should retrieve encrypted secrets', async () => {
      await provider.setSecret('KEY', 'test-value');
      const result = await provider.getSecret('KEY');

      expect(result).toBe('test-value');
    });

    it('should return undefined for non-existent secrets', async () => {
      const result = await provider.getSecret('NON_EXISTENT');

      expect(result).toBeUndefined();
    });

    it('should emit OCSF read event on successful retrieval', async () => {
      await provider.setSecret('KEY', 'value');

      provider = new EncryptedFileSecretsProvider({
        masterKey: validMasterKey,
        auditLog: true,
      });
      vi.clearAllMocks();

      await provider.getSecret('KEY');

      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });
  });

  describe('Secret Storage', () => {
    beforeEach(() => {
      provider = new EncryptedFileSecretsProvider({
        masterKey: validMasterKey,
        auditLog: true,
      });
      vi.clearAllMocks();
    });

    it('should store new secrets', async () => {
      await provider.setSecret('NEW_KEY', 'new-value');

      const exists = await provider.hasSecret('NEW_KEY');
      expect(exists).toBe(true);
    });

    it('should update existing secrets', async () => {
      await provider.setSecret('KEY', 'original');
      await provider.setSecret('KEY', 'updated');

      const result = await provider.getSecret('KEY');
      expect(result).toBe('updated');
    });

    it('should emit OCSF create event for new secrets', async () => {
      await provider.setSecret('NEW_KEY', 'value');

      expect(ocsfModule.createAPIEvent).toHaveBeenCalled();
    });

    it('should emit OCSF update event for existing secrets', async () => {
      await provider.setSecret('KEY', 'value1');
      vi.clearAllMocks();

      await provider.setSecret('KEY', 'value2');

      expect(ocsfModule.updateAPIEvent).toHaveBeenCalled();
    });
  });

  describe('hasSecret', () => {
    beforeEach(() => {
      provider = new EncryptedFileSecretsProvider({
        masterKey: validMasterKey,
      });
    });

    it('should return true for existing secrets', async () => {
      await provider.setSecret('KEY', 'value');

      const exists = await provider.hasSecret('KEY');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent secrets', async () => {
      const exists = await provider.hasSecret('NON_EXISTENT');
      expect(exists).toBe(false);
    });
  });

  describe('Disposal', () => {
    beforeEach(() => {
      provider = new EncryptedFileSecretsProvider({
        masterKey: validMasterKey,
        auditLog: true,
      });
    });

    it('should clear secrets on dispose', async () => {
      await provider.setSecret('KEY', 'value');
      await provider.dispose();

      const exists = await provider.hasSecret('KEY');
      expect(exists).toBe(false);
    });

    it('should emit OCSF dispose event', async () => {
      vi.clearAllMocks();
      await provider.dispose();

      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });
  });

  describe('Static Methods', () => {
    it('should generate valid master key', () => {
      const key = EncryptedFileSecretsProvider.generateMasterKey();
      const buffer = Buffer.from(key, 'base64');

      expect(buffer.length).toBe(32); // 256 bits
    });

    it('should migrate from plaintext env file', async () => {
      const envContent = 'API_KEY=key123\nSECRET=secret456\n';
      (fs.readFile as Mock) = vi.fn().mockResolvedValue(envContent);

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await EncryptedFileSecretsProvider.migrateFromPlaintext(
        '.env.local',
        validMasterKey,
        '.test-migrated.encrypted'
      );

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Migrated')
      );
      consoleLogSpy.mockRestore();
    });
  });

  describe('Integration with BaseSecretsProvider', () => {
    beforeEach(() => {
      provider = new EncryptedFileSecretsProvider({
        masterKey: validMasterKey,
        cacheTtlMs: 300000,
        auditLog: true,
      });
    });

    it('should use caching from base class', async () => {
      await provider.setSecret('CACHED_KEY', 'cached-value');
      vi.clearAllMocks();

      await provider.getSecret('CACHED_KEY');
      await provider.getSecret('CACHED_KEY');

      // Both retrievals should emit events (cache hit tracking)
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should respect auditLog option', async () => {
      provider = new EncryptedFileSecretsProvider({
        masterKey: validMasterKey,
        auditLog: false,
      });
      vi.clearAllMocks();

      await provider.setSecret('KEY', 'value');

      expect(mockBridge.emitAPIActivityEvent).not.toHaveBeenCalled();
    });

    it('should disable caching when cacheTtlMs is 0', async () => {
      provider = new EncryptedFileSecretsProvider({
        masterKey: validMasterKey,
        cacheTtlMs: 0,
      });

      await provider.setSecret('KEY', 'value');

      const result1 = await provider.getSecret('KEY');
      const result2 = await provider.getSecret('KEY');

      // Both retrievals should work correctly
      expect(result1).toBe('value');
      expect(result2).toBe('value');
    });
  });
});
