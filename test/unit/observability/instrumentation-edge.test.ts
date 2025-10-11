/**
 * Tests for Edge runtime instrumentation
 */

import { vi } from 'vitest';

// Hoist mocks so they're available in vi.mock() factories
const mocks = vi.hoisted(() => ({
  mockGetTracer: vi.fn(),
  mockStartActiveSpan: vi.fn(),
  mockSpan: {
    setStatus: vi.fn(),
    recordException: vi.fn(),
    end: vi.fn()
  },
  getObservabilityConfig: vi.fn()
}));

// Mock OpenTelemetry API
vi.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: mocks.mockGetTracer
  }
}));

// Mock config module
vi.mock('../../../src/observability/config.js', () => ({
  getObservabilityConfig: mocks.getObservabilityConfig
}));

import {
  initializeEdgeInstrumentation,
  createEdgeSpan
} from '../../../src/observability/instrumentation-edge.js';
import { getObservabilityConfig } from '../../../src/observability/config.js';

describe('Edge Runtime Instrumentation', () => {
  const mockConfig = {
    enabled: true,
    environment: 'production',
    runtime: 'edge' as const,
    service: {
      name: 'edge-service',
      version: '1.0.0',
      namespace: 'edge'
    },
    exporters: {
      console: false,
      otlp: {
        enabled: false,
        endpoint: '',
        protocol: 'http/protobuf' as const
      }
    },
    sampling: {
      traces: 0.1,
      metrics: 0.1
    }
  };

  const mockTracer = {
    startActiveSpan: mocks.mockStartActiveSpan
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getObservabilityConfig.mockReturnValue(mockConfig);
    mocks.mockGetTracer.mockReturnValue(mockTracer);
    mocks.mockStartActiveSpan.mockImplementation((name, callback) => {
      return callback(mocks.mockSpan);
    });
  });

  describe('initializeEdgeInstrumentation', () => {
    it('should not initialize when disabled', () => {
      const disabledConfig = { ...mockConfig, enabled: false };
      mocks.getObservabilityConfig.mockReturnValue(disabledConfig);

      initializeEdgeInstrumentation();

      expect(mocks.mockGetTracer).not.toHaveBeenCalled();
    });

    it('should not initialize for non-edge runtime', () => {
      const nodeConfig = { ...mockConfig, runtime: 'nodejs' as const };
      mocks.getObservabilityConfig.mockReturnValue(nodeConfig);

      initializeEdgeInstrumentation();

      expect(mocks.mockGetTracer).not.toHaveBeenCalled();
    });

    it('should initialize for edge runtime', () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      initializeEdgeInstrumentation();

      expect(mocks.mockGetTracer).toHaveBeenCalledWith('edge-service', '1.0.0');
      expect(consoleSpy).toHaveBeenCalledWith(
        'Edge runtime detected - using minimal observability'
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        'Edge observability initialized',
        {
          service: 'edge-service',
          runtime: 'edge'
        }
      );

      consoleSpy.mockRestore();
    });

    it('should handle initialization errors', () => {
      mocks.mockGetTracer.mockImplementationOnce(() => {
        throw new Error('Failed to get tracer');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => initializeEdgeInstrumentation()).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to initialize edge observability:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('createEdgeSpan', () => {
    it('should bypass span creation when disabled', async () => {
      const disabledConfig = { ...mockConfig, enabled: false };
      mocks.getObservabilityConfig.mockReturnValue(disabledConfig);

      const fn = vi.fn().mockResolvedValue('result');
      const result = await createEdgeSpan('test-span', fn);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalled();
      expect(mocks.mockGetTracer).not.toHaveBeenCalled();
    });

    it('should bypass span creation for non-edge runtime', async () => {
      const nodeConfig = { ...mockConfig, runtime: 'nodejs' as const };
      mocks.getObservabilityConfig.mockReturnValue(nodeConfig);

      const fn = vi.fn().mockResolvedValue('result');
      const result = await createEdgeSpan('test-span', fn);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalled();
      expect(mocks.mockGetTracer).not.toHaveBeenCalled();
    });

    it('should create span for successful operation', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await createEdgeSpan('test-operation', fn);

      expect(result).toBe('success');
      expect(mocks.mockGetTracer).toHaveBeenCalledWith('edge-service');
      expect(mocks.mockStartActiveSpan).toHaveBeenCalledWith('test-operation', expect.any(Function));
      expect(mocks.mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // OK
      expect(mocks.mockSpan.end).toHaveBeenCalled();
    });

    it('should handle synchronous functions', async () => {
      const fn = vi.fn().mockReturnValue('sync-result');
      const result = await createEdgeSpan('sync-operation', fn);

      expect(result).toBe('sync-result');
      expect(mocks.mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // OK
      expect(mocks.mockSpan.end).toHaveBeenCalled();
    });

    it('should record exceptions on failure', async () => {
      const error = new Error('Test error');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(createEdgeSpan('failing-operation', fn)).rejects.toThrow('Test error');

      expect(mocks.mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mocks.mockSpan.setStatus).toHaveBeenCalledWith({ code: 2 }); // ERROR
      expect(mocks.mockSpan.end).toHaveBeenCalled();
    });

    it('should handle synchronous exceptions', async () => {
      const error = new Error('Sync error');
      const fn = vi.fn().mockImplementation(() => {
        throw error;
      });

      await expect(createEdgeSpan('sync-failing', fn)).rejects.toThrow('Sync error');

      expect(mocks.mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mocks.mockSpan.setStatus).toHaveBeenCalledWith({ code: 2 }); // ERROR
      expect(mocks.mockSpan.end).toHaveBeenCalled();
    });

    it('should always call span.end in finally block', async () => {
      // Test with success
      const successFn = vi.fn().mockResolvedValue('ok');
      await createEdgeSpan('test', successFn);
      expect(mocks.mockSpan.end).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Test with failure
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));
      try {
        await createEdgeSpan('test', failFn);
      } catch {
        // Expected to throw
      }
      expect(mocks.mockSpan.end).toHaveBeenCalledTimes(1);
    });
  });
});