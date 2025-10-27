/**
 * Unit tests for VaultSecretsProvider
 *
 * Tests HashiCorp Vault integration including KV v2 API interactions,
 * authentication, namespace support, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { VaultSecretsProvider } from '../../src/secrets/vault-secrets-provider.js';
import * as ocsfModule from '@mcp-typescript-simple/observability/ocsf';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

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

describe('VaultSecretsProvider', () => {
  let provider: VaultSecretsProvider;
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
    it('should initialize with explicit options', () => {
      provider = new VaultSecretsProvider({
        vaultAddr: 'http://vault.example.com:8200',
        vaultToken: 'test-token',
        vaultNamespace: 'test-namespace',
        mountPoint: 'custom-secret',
        basePath: 'custom-path',
        auditLog: true,
      });

      expect(provider.name).toBe('vault');
      expect(provider.readOnly).toBe(false);
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should initialize with environment variables', () => {
      process.env.VAULT_ADDR = 'http://localhost:8200';
      process.env.VAULT_TOKEN = 'env-token';
      process.env.VAULT_NAMESPACE = 'env-namespace';

      provider = new VaultSecretsProvider({ auditLog: true });

      expect(provider.name).toBe('vault');
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should use default vault address when not provided', () => {
      delete process.env.VAULT_ADDR;

      provider = new VaultSecretsProvider({
        vaultToken: 'test-token',
        auditLog: true,
      });

      expect(provider.name).toBe('vault');
    });

    it('should use default mount point and base path', () => {
      provider = new VaultSecretsProvider({
        vaultToken: 'test-token',
        auditLog: true,
      });

      expect(provider.name).toBe('vault');
    });

    it('should throw error when vault token is missing', () => {
      delete process.env.VAULT_TOKEN;

      expect(() => {
        new VaultSecretsProvider();
      }).toThrow('Vault token not configured');
    });

    it('should prefer explicit options over environment variables', () => {
      process.env.VAULT_ADDR = 'http://env-vault:8200';
      process.env.VAULT_TOKEN = 'env-token';
      process.env.VAULT_NAMESPACE = 'env-namespace';

      provider = new VaultSecretsProvider({
        vaultAddr: 'http://option-vault:8200',
        vaultToken: 'option-token',
        vaultNamespace: 'option-namespace',
        auditLog: true,
      });

      expect(provider.name).toBe('vault');
    });

    it('should handle missing namespace (optional)', () => {
      delete process.env.VAULT_NAMESPACE;

      provider = new VaultSecretsProvider({
        vaultToken: 'test-token',
        auditLog: true,
      });

      expect(provider.name).toBe('vault');
    });
  });

  describe('Secret Retrieval (retrieveSecret)', () => {
    beforeEach(() => {
      provider = new VaultSecretsProvider({
        vaultAddr: 'http://localhost:8200',
        vaultToken: 'test-token',
        mountPoint: 'secret',
        basePath: 'mcp-server',
        auditLog: true,
      });
    });

    it('should retrieve existing secret', async () => {
      const mockResponse = {
        data: {
          data: { value: 'secret-value-123' },
          metadata: {
            created_time: '2025-01-01T00:00:00Z',
            custom_metadata: null,
            deletion_time: '',
            destroyed: false,
            version: 1,
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const value = await provider.getSecret('API_KEY');

      expect(value).toBe('secret-value-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8200/v1/secret/data/mcp-server/API_KEY',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'X-Vault-Token': 'test-token',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('should return undefined for non-existent secret (404)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const value = await provider.getSecret('MISSING_KEY');

      expect(value).toBeUndefined();
    });

    it('should throw error on Vault API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(provider.getSecret('ERROR_KEY')).rejects.toThrow(
        'Vault API error (500): Internal Server Error'
      );
    });

    it('should throw error on permission denied (403)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Permission denied',
      });

      await expect(provider.getSecret('FORBIDDEN_KEY')).rejects.toThrow(
        'Vault API error (403): Permission denied'
      );
    });

    it('should retrieve complex JSON secret', async () => {
      const mockResponse = {
        data: {
          data: {
            value: { username: 'admin', password: 'secret' },
          },
          metadata: {
            created_time: '2025-01-01T00:00:00Z',
            custom_metadata: null,
            deletion_time: '',
            destroyed: false,
            version: 1,
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const value = await provider.getSecret<{ username: string; password: string }>('DB_CREDS');

      expect(value).toEqual({ username: 'admin', password: 'secret' });
    });

    it('should include namespace header when configured', async () => {
      await provider.dispose();

      provider = new VaultSecretsProvider({
        vaultAddr: 'http://localhost:8200',
        vaultToken: 'test-token',
        vaultNamespace: 'test-namespace',
        auditLog: true,
      });

      const mockResponse = {
        data: {
          data: { value: 'test' },
          metadata: {
            created_time: '2025-01-01T00:00:00Z',
            custom_metadata: null,
            deletion_time: '',
            destroyed: false,
            version: 1,
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      await provider.getSecret('TEST_KEY');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Vault-Namespace': 'test-namespace',
          }),
        })
      );
    });
  });

  describe('Secret Storage (storeSecret)', () => {
    beforeEach(() => {
      provider = new VaultSecretsProvider({
        vaultAddr: 'http://localhost:8200',
        vaultToken: 'test-token',
        mountPoint: 'secret',
        basePath: 'mcp-server',
        auditLog: true,
      });
    });

    it('should store new secret', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      });

      await provider.setSecret('NEW_KEY', 'new-value');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8200/v1/secret/data/mcp-server/NEW_KEY',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Vault-Token': 'test-token',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ data: { value: 'new-value' } }),
        })
      );
    });

    it('should update existing secret', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      });

      await provider.setSecret('EXISTING_KEY', 'updated-value');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ data: { value: 'updated-value' } }),
        })
      );
    });

    it('should store complex JSON secret', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      });

      const complexValue = {
        api_key: 'key-123',
        api_secret: 'secret-456',
        config: { timeout: 30000 },
      };

      await provider.setSecret('CONFIG', complexValue);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ data: { value: complexValue } }),
        })
      );
    });

    it('should throw error on Vault API error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Write failed',
      });

      await expect(provider.setSecret('ERROR_KEY', 'value')).rejects.toThrow(
        'Vault API error (500): Write failed'
      );
    });

    it('should throw error on permission denied (403)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'Permission denied',
      });

      await expect(provider.setSecret('FORBIDDEN_KEY', 'value')).rejects.toThrow(
        'Vault API error (403): Permission denied'
      );
    });
  });

  describe('hasSecret', () => {
    beforeEach(() => {
      provider = new VaultSecretsProvider({
        vaultAddr: 'http://localhost:8200',
        vaultToken: 'test-token',
        auditLog: true,
      });
    });

    it('should return true for existing secret', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      });

      const exists = await provider.hasSecret('EXISTING_KEY');

      expect(exists).toBe(true);
    });

    it('should return false for non-existent secret (404)', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const exists = await provider.hasSecret('MISSING_KEY');

      expect(exists).toBe(false);
    });

    it('should return false on fetch error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const exists = await provider.hasSecret('ERROR_KEY');

      expect(exists).toBe(false);
    });

    it('should return true for any non-404 status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500, // Server error, but key might exist
      });

      const exists = await provider.hasSecret('UNKNOWN_KEY');

      expect(exists).toBe(true);
    });
  });

  describe('BaseSecretsProvider Integration', () => {
    beforeEach(() => {
      provider = new VaultSecretsProvider({
        vaultAddr: 'http://localhost:8200',
        vaultToken: 'test-token',
        cacheTtlMs: 1000,
        auditLog: true,
      });
    });

    it('should cache secret retrieval', async () => {
      const mockResponse = {
        data: {
          data: { value: 'cached-value' },
          metadata: {
            created_time: '2025-01-01T00:00:00Z',
            custom_metadata: null,
            deletion_time: '',
            destroyed: false,
            version: 1,
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      // First call - should fetch from Vault
      const value1 = await provider.getSecret('CACHED_KEY');
      expect(value1).toBe('cached-value');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const value2 = await provider.getSecret('CACHED_KEY');
      expect(value2).toBe('cached-value');
      expect(mockFetch).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('should emit OCSF events for secret operations', async () => {
      const mockResponse = {
        data: {
          data: { value: 'test-value' },
          metadata: {
            created_time: '2025-01-01T00:00:00Z',
            custom_metadata: null,
            deletion_time: '',
            destroyed: false,
            version: 1,
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      await provider.getSecret('AUDIT_KEY');

      // Should emit OCSF event via BaseSecretsProvider
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should invalidate cache after setSecret', async () => {
      const getResponse = {
        data: {
          data: { value: 'old-value' },
          metadata: {
            created_time: '2025-01-01T00:00:00Z',
            custom_metadata: null,
            deletion_time: '',
            destroyed: false,
            version: 1,
          },
        },
      };

      const updatedResponse = {
        data: {
          data: { value: 'new-value' },
          metadata: {
            created_time: '2025-01-01T00:00:00Z',
            custom_metadata: null,
            deletion_time: '',
            destroyed: false,
            version: 2,
          },
        },
      };

      // First get
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => getResponse,
      });

      const value1 = await provider.getSecret('UPDATE_KEY');
      expect(value1).toBe('old-value');

      // Set (update)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      await provider.setSecret('UPDATE_KEY', 'new-value');

      // Second get - should fetch new value (cache invalidated)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => updatedResponse,
      });

      const value2 = await provider.getSecret('UPDATE_KEY');
      expect(value2).toBe('new-value');
    });
  });

  describe('Disposal', () => {
    it('should dispose without errors', async () => {
      provider = new VaultSecretsProvider({
        vaultToken: 'test-token',
        auditLog: true,
      });

      await expect(provider.dispose()).resolves.toBeUndefined();
    });

    it('should be reusable after disposal', async () => {
      provider = new VaultSecretsProvider({
        vaultToken: 'test-token',
        auditLog: true,
      });

      await provider.dispose();

      // Should not throw
      await expect(provider.dispose()).resolves.toBeUndefined();
    });
  });

  describe('Custom Mount Point and Base Path', () => {
    it('should use custom mount point in path', async () => {
      provider = new VaultSecretsProvider({
        vaultAddr: 'http://localhost:8200',
        vaultToken: 'test-token',
        mountPoint: 'custom-kv',
        basePath: 'app-secrets',
        auditLog: true,
      });

      const mockResponse = {
        data: {
          data: { value: 'test' },
          metadata: {
            created_time: '2025-01-01T00:00:00Z',
            custom_metadata: null,
            deletion_time: '',
            destroyed: false,
            version: 1,
          },
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      await provider.getSecret('MY_KEY');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8200/v1/custom-kv/data/app-secrets/MY_KEY',
        expect.any(Object)
      );
    });
  });
});
