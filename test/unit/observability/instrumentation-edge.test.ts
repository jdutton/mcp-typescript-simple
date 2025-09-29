/**
 * Tests for Edge runtime instrumentation
 */

// Mock OpenTelemetry API
const mockGetTracer = jest.fn();
const mockStartActiveSpan = jest.fn();
const mockSpan = {
  setStatus: jest.fn(),
  recordException: jest.fn(),
  end: jest.fn()
};

jest.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: mockGetTracer
  }
}));

// Mock config module
jest.mock('../../../src/observability/config.js', () => ({
  getObservabilityConfig: jest.fn()
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
    startActiveSpan: mockStartActiveSpan
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getObservabilityConfig as jest.Mock).mockReturnValue(mockConfig);
    mockGetTracer.mockReturnValue(mockTracer);
    mockStartActiveSpan.mockImplementation((name, callback) => {
      return callback(mockSpan);
    });
  });

  describe('initializeEdgeInstrumentation', () => {
    it('should not initialize when disabled', () => {
      const disabledConfig = { ...mockConfig, enabled: false };
      (getObservabilityConfig as jest.Mock).mockReturnValue(disabledConfig);

      initializeEdgeInstrumentation();

      expect(mockGetTracer).not.toHaveBeenCalled();
    });

    it('should not initialize for non-edge runtime', () => {
      const nodeConfig = { ...mockConfig, runtime: 'nodejs' as const };
      (getObservabilityConfig as jest.Mock).mockReturnValue(nodeConfig);

      initializeEdgeInstrumentation();

      expect(mockGetTracer).not.toHaveBeenCalled();
    });

    it('should initialize for edge runtime', () => {
      const consoleSpy = jest.spyOn(console, 'debug').mockImplementation();

      initializeEdgeInstrumentation();

      expect(mockGetTracer).toHaveBeenCalledWith('edge-service', '1.0.0');
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
      mockGetTracer.mockImplementationOnce(() => {
        throw new Error('Failed to get tracer');
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

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
      (getObservabilityConfig as jest.Mock).mockReturnValue(disabledConfig);

      const fn = jest.fn().mockResolvedValue('result');
      const result = await createEdgeSpan('test-span', fn);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalled();
      expect(mockGetTracer).not.toHaveBeenCalled();
    });

    it('should bypass span creation for non-edge runtime', async () => {
      const nodeConfig = { ...mockConfig, runtime: 'nodejs' as const };
      (getObservabilityConfig as jest.Mock).mockReturnValue(nodeConfig);

      const fn = jest.fn().mockResolvedValue('result');
      const result = await createEdgeSpan('test-span', fn);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalled();
      expect(mockGetTracer).not.toHaveBeenCalled();
    });

    it('should create span for successful operation', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const result = await createEdgeSpan('test-operation', fn);

      expect(result).toBe('success');
      expect(mockGetTracer).toHaveBeenCalledWith('edge-service');
      expect(mockStartActiveSpan).toHaveBeenCalledWith('test-operation', expect.any(Function));
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // OK
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should handle synchronous functions', async () => {
      const fn = jest.fn().mockReturnValue('sync-result');
      const result = await createEdgeSpan('sync-operation', fn);

      expect(result).toBe('sync-result');
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // OK
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should record exceptions on failure', async () => {
      const error = new Error('Test error');
      const fn = jest.fn().mockRejectedValue(error);

      await expect(createEdgeSpan('failing-operation', fn)).rejects.toThrow('Test error');

      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 2 }); // ERROR
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should handle synchronous exceptions', async () => {
      const error = new Error('Sync error');
      const fn = jest.fn().mockImplementation(() => {
        throw error;
      });

      await expect(createEdgeSpan('sync-failing', fn)).rejects.toThrow('Sync error');

      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 2 }); // ERROR
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should always call span.end in finally block', async () => {
      // Test with success
      const successFn = jest.fn().mockResolvedValue('ok');
      await createEdgeSpan('test', successFn);
      expect(mockSpan.end).toHaveBeenCalledTimes(1);

      jest.clearAllMocks();

      // Test with failure
      const failFn = jest.fn().mockRejectedValue(new Error('fail'));
      try {
        await createEdgeSpan('test', failFn);
      } catch {
        // Expected to throw
      }
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });
  });
});