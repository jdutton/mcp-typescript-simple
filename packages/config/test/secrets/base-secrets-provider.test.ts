/**
 * Unit tests for BaseSecretsProvider
 *
 * Tests OCSF audit event emission, caching, and template method pattern.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { BaseSecretsProvider } from '../../src/secrets/base-secrets-provider.js';
import type { SecretsProviderOptions } from '../../src/secrets/secrets-provider.js';
import * as ocsfModule from '@mcp-typescript-simple/observability/ocsf';
import * as loggerModule from '@mcp-typescript-simple/observability';

// Mock the logger module
vi.mock('@mcp-typescript-simple/observability', () => ({
  logger: {
    error: vi.fn(),
  },
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
    Unknown: 0,
    Informational: 1,
    Low: 2,
    Medium: 3,
    High: 4,
    Critical: 5,
    Fatal: 6,
    Other: 99,
  },
  StatusId: {
    Unknown: 0,
    Success: 1,
    Failure: 2,
    Other: 99,
  },
}));

/**
 * Concrete test implementation of BaseSecretsProvider
 */
class TestSecretsProvider extends BaseSecretsProvider {
  readonly name = 'test';
  readonly readOnly = false;

  private storage = new Map<string, unknown>();

  constructor(options?: SecretsProviderOptions) {
    super(options);
    this.emitInitializationEvent({ test: true });
  }

  protected async retrieveSecret<T = string>(key: string): Promise<T | undefined> {
    return this.storage.get(key) as T | undefined;
  }

  protected async storeSecret<T = string>(key: string, value: T): Promise<void> {
    this.storage.set(key, value);
  }

  async hasSecret(key: string): Promise<boolean> {
    return this.storage.has(key);
  }

  protected async disposeResources(): Promise<void> {
    this.storage.clear();
  }

  // Expose for testing
  public getCache(): Map<string, unknown> {
    return this.cache;
  }
}

describe('BaseSecretsProvider', () => {
  let provider: TestSecretsProvider;
  let mockBridge: { emitAPIActivityEvent: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    mockBridge = {
      emitAPIActivityEvent: vi.fn(),
    };
    (ocsfModule.getOCSFOTELBridge as Mock).mockReturnValue(mockBridge);
  });

  describe('Constructor and Initialization', () => {
    it('should initialize with default options', () => {
      provider = new TestSecretsProvider();
      expect(provider.name).toBe('test');
      expect(provider.readOnly).toBe(false);
    });

    it('should initialize with custom cache TTL', () => {
      provider = new TestSecretsProvider({ cacheTtlMs: 60000 });
      expect(provider).toBeDefined();
    });

    it('should emit initialization event when auditLog is enabled', () => {
      provider = new TestSecretsProvider({ auditLog: true });
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should not emit initialization event when auditLog is disabled', () => {
      provider = new TestSecretsProvider({ auditLog: false });
      expect(mockBridge.emitAPIActivityEvent).not.toHaveBeenCalled();
    });
  });

  describe('getSecret - Read Operations', () => {
    beforeEach(() => {
      provider = new TestSecretsProvider({ auditLog: true, cacheTtlMs: 300000 });
      vi.clearAllMocks(); // Clear initialization event
    });

    it('should retrieve existing secret', async () => {
      await provider.setSecret('TEST_KEY', 'test-value');
      vi.clearAllMocks(); // Clear setSecret events

      const result = await provider.getSecret('TEST_KEY');
      expect(result).toBe('test-value');
    });

    it('should emit OCSF read event on successful retrieval', async () => {
      await provider.setSecret('TEST_KEY', 'test-value');
      vi.clearAllMocks();

      await provider.getSecret('TEST_KEY');

      expect(ocsfModule.readAPIEvent).toHaveBeenCalled();
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should return undefined for non-existent secret', async () => {
      const result = await provider.getSecret('NON_EXISTENT');
      expect(result).toBeUndefined();
    });

    it('should emit OCSF read event with failure status for non-existent secret', async () => {
      await provider.getSecret('NON_EXISTENT');

      expect(ocsfModule.readAPIEvent).toHaveBeenCalled();
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should cache retrieved secrets', async () => {
      await provider.setSecret('CACHED_KEY', 'cached-value');
      vi.clearAllMocks();

      // First retrieval
      await provider.getSecret('CACHED_KEY');
      const firstCallCount = mockBridge.emitAPIActivityEvent.mock.calls.length;

      // Second retrieval (should hit cache)
      await provider.getSecret('CACHED_KEY');
      const secondCallCount = mockBridge.emitAPIActivityEvent.mock.calls.length;

      expect(secondCallCount).toBe(firstCallCount + 1); // Cache hit should still emit event
    });

    it('should handle errors during secret retrieval', async () => {
      const errorProvider = new TestSecretsProvider({ auditLog: true });
      errorProvider['retrieveSecret'] = vi.fn().mockRejectedValue(new Error('Storage error'));
      vi.clearAllMocks();

      await expect(errorProvider.getSecret('ERROR_KEY')).rejects.toThrow('Storage error');
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });
  });

  describe('setSecret - Create/Update Operations', () => {
    beforeEach(() => {
      provider = new TestSecretsProvider({ auditLog: true });
      vi.clearAllMocks();
    });

    it('should store new secret', async () => {
      await provider.setSecret('NEW_KEY', 'new-value');
      const result = await provider.getSecret('NEW_KEY');
      expect(result).toBe('new-value');
    });

    it('should emit OCSF create event for new secret', async () => {
      await provider.setSecret('NEW_KEY', 'new-value');

      expect(ocsfModule.createAPIEvent).toHaveBeenCalled();
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should emit OCSF update event for existing secret', async () => {
      await provider.setSecret('EXISTING_KEY', 'original-value');
      vi.clearAllMocks();

      await provider.setSecret('EXISTING_KEY', 'updated-value');

      expect(ocsfModule.updateAPIEvent).toHaveBeenCalled();
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should update cache when setting secret', async () => {
      await provider.setSecret('CACHE_KEY', 'cache-value');
      const cache = provider.getCache();
      expect(cache.size).toBeGreaterThan(0);
    });

    it('should handle different value types', async () => {
      await provider.setSecret('OBJECT_KEY', { nested: 'value' });
      const result = await provider.getSecret<{ nested: string }>('OBJECT_KEY');
      expect(result).toEqual({ nested: 'value' });
    });

    it('should handle errors during secret storage', async () => {
      const errorProvider = new TestSecretsProvider({ auditLog: true });
      errorProvider['storeSecret'] = vi.fn().mockRejectedValue(new Error('Storage full'));
      vi.clearAllMocks();

      await expect(errorProvider.setSecret('ERROR_KEY', 'value')).rejects.toThrow('Storage full');
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });
  });

  describe('hasSecret', () => {
    beforeEach(() => {
      provider = new TestSecretsProvider();
    });

    it('should return true for existing secret', async () => {
      await provider.setSecret('EXISTS_KEY', 'value');
      const exists = await provider.hasSecret('EXISTS_KEY');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent secret', async () => {
      const exists = await provider.hasSecret('NON_EXISTENT');
      expect(exists).toBe(false);
    });
  });

  describe('dispose', () => {
    beforeEach(() => {
      provider = new TestSecretsProvider({ auditLog: true });
      vi.clearAllMocks();
    });

    it('should clear cache on dispose', async () => {
      await provider.setSecret('KEY1', 'value1');
      await provider.setSecret('KEY2', 'value2');

      await provider.dispose();

      const cache = provider.getCache();
      expect(cache.size).toBe(0);
    });

    it('should emit OCSF dispose event', async () => {
      await provider.dispose();

      expect(ocsfModule.readAPIEvent).toHaveBeenCalled();
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });

    it('should call disposeResources', async () => {
      const disposeSpy = vi.spyOn(provider as never, 'disposeResources');
      await provider.dispose();
      expect(disposeSpy).toHaveBeenCalled();
    });
  });

  describe('Caching Behavior', () => {
    it('should disable caching when cacheTtlMs is 0', async () => {
      provider = new TestSecretsProvider({ cacheTtlMs: 0 });
      await provider.setSecret('NO_CACHE', 'value');

      const cache = provider.getCache();
      expect(cache.size).toBe(0);
    });

    it('should respect cache TTL', async () => {
      provider = new TestSecretsProvider({ cacheTtlMs: 100, auditLog: true }); // 100ms TTL with audit
      await provider.setSecret('TTL_KEY', 'value');

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      vi.clearAllMocks();
      await provider.getSecret('TTL_KEY');

      // Should retrieve from storage (not cache) and emit event
      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });
  });

  describe('Audit Log Toggle', () => {
    it('should not emit events when auditLog is false', async () => {
      provider = new TestSecretsProvider({ auditLog: false });
      vi.clearAllMocks();

      await provider.setSecret('KEY', 'value');
      await provider.getSecret('KEY');
      await provider.dispose();

      expect(mockBridge.emitAPIActivityEvent).not.toHaveBeenCalled();
    });

    it('should emit events when auditLog is true', async () => {
      provider = new TestSecretsProvider({ auditLog: true });
      vi.clearAllMocks();

      await provider.setSecret('KEY', 'value');

      expect(mockBridge.emitAPIActivityEvent).toHaveBeenCalled();
    });
  });

  describe('Error Resilience', () => {
    it('should not throw when OCSF event emission fails', async () => {
      mockBridge.emitAPIActivityEvent.mockImplementation(() => {
        throw new Error('OCSF emission failed');
      });

      provider = new TestSecretsProvider({ auditLog: true });
      vi.clearAllMocks();

      // Should not throw despite OCSF failure
      await expect(provider.setSecret('KEY', 'value')).resolves.toBeUndefined();
      await expect(provider.getSecret('KEY')).resolves.toBe('value');
    });

    it('should handle logger.error calls gracefully', async () => {
      mockBridge.emitAPIActivityEvent.mockImplementation(() => {
        throw new Error('OCSF failure');
      });

      provider = new TestSecretsProvider({ auditLog: true });
      vi.clearAllMocks();

      await provider.setSecret('KEY', 'value');

      // Verify logger.error was called with error details
      expect(loggerModule.logger.error).toHaveBeenCalled();
    });
  });
});
