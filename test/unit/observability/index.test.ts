/**
 * Tests for observability initialization
 */

// Mock config module
const mockGetObservabilityConfig = jest.fn();
const mockDetectRuntime = jest.fn();
jest.mock('../../../src/observability/config.js', () => ({
  getObservabilityConfig: mockGetObservabilityConfig,
  detectRuntime: mockDetectRuntime
}));

// Mock instrumentation modules
const mockInitializeInstrumentation = jest.fn();
const mockInitializeEdgeInstrumentation = jest.fn();
const mockShutdownInstrumentation = jest.fn();

jest.mock('../../../src/observability/instrumentation.js', () => ({
  initializeInstrumentation: mockInitializeInstrumentation,
  shutdownInstrumentation: mockShutdownInstrumentation
}));

jest.mock('../../../src/observability/instrumentation-edge.js', () => ({
  initializeEdgeInstrumentation: mockInitializeEdgeInstrumentation
}));

// Mock metrics
const mockInitializeMetrics = jest.fn();
jest.mock('../../../src/observability/metrics.js', () => ({
  initializeMetrics: mockInitializeMetrics
}));

// Mock logger
const mockGetLogger = jest.fn();
jest.mock('../../../src/observability/logger.js', () => ({
  getLogger: mockGetLogger
}));

import { initializeObservability } from '../../../src/observability/index.js';

describe('Observability Initialization', () => {
  const mockNodeConfig = {
    enabled: true,
    environment: 'development',
    runtime: 'nodejs' as const,
    service: {
      name: 'test-service',
      version: '1.0.0',
      namespace: 'test'
    },
    sampling: {
      traces: 1.0,
      metrics: 1.0
    },
    exporters: {
      console: true,
      otlp: {
        enabled: true,
        endpoint: 'http://localhost:4318',
        protocol: 'http/protobuf' as const
      }
    }
  };

  const mockEdgeConfig = {
    ...mockNodeConfig,
    runtime: 'edge' as const
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'debug').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    mockDetectRuntime.mockReturnValue('nodejs');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Node.js runtime', () => {
    it('should initialize Node.js instrumentation when enabled', async () => {
      mockGetObservabilityConfig.mockReturnValue(mockNodeConfig);

      await initializeObservability();

      // Check for warning about using register.ts instead
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[OTEL] Warning: initializeObservability() called in Node.js runtime'));

      expect(console.debug).toHaveBeenCalledWith('[OTEL] Late initialization (runtime-based)', {
        environment: 'development',
        runtime: 'nodejs',
        service: 'test-service'
      });

      expect(mockInitializeMetrics).toHaveBeenCalled();
      expect(console.debug).toHaveBeenCalledWith('[OTEL] Metrics initialized (tracing should be via register.ts)');

      // Should not initialize edge instrumentation
      expect(mockInitializeEdgeInstrumentation).not.toHaveBeenCalled();
    });

    it('should skip initialization when disabled', async () => {
      const disabledConfig = { ...mockNodeConfig, enabled: false };
      mockGetObservabilityConfig.mockReturnValue(disabledConfig);

      await initializeObservability();

      expect(console.debug).toHaveBeenCalledWith('[OTEL] Observability disabled');
      expect(mockInitializeMetrics).not.toHaveBeenCalled();
      expect(mockInitializeEdgeInstrumentation).not.toHaveBeenCalled();
    });

    it('should handle initialization errors gracefully', async () => {
      mockGetObservabilityConfig.mockReturnValue(mockNodeConfig);
      mockInitializeMetrics.mockImplementationOnce(() => {
        throw new Error('Metrics failed');
      });

      await expect(initializeObservability()).resolves.not.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        '[OTEL] Failed to initialize observability:',
        expect.any(Error)
      );
    });
  });

  describe('Edge runtime', () => {
    it('should initialize Edge instrumentation when enabled', async () => {
      mockGetObservabilityConfig.mockReturnValue(mockEdgeConfig);
      mockDetectRuntime.mockReturnValue('edge');

      await initializeObservability();

      expect(console.debug).toHaveBeenCalledWith('[OTEL] Late initialization (runtime-based)', {
        environment: 'development',
        runtime: 'edge',
        service: 'test-service'
      });

      expect(mockInitializeEdgeInstrumentation).toHaveBeenCalled();

      expect(console.debug).toHaveBeenCalledWith('[OTEL] Edge runtime observability initialized');

      // Should not initialize Node.js metrics (Edge uses different approach)
      expect(mockInitializeMetrics).not.toHaveBeenCalled();
    });

    it('should handle Edge initialization errors', async () => {
      mockGetObservabilityConfig.mockReturnValue(mockEdgeConfig);
      mockDetectRuntime.mockReturnValue('edge');
      mockInitializeEdgeInstrumentation.mockImplementationOnce(() => {
        throw new Error('Edge init failed');
      });

      await expect(initializeObservability()).resolves.not.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        '[OTEL] Failed to initialize observability:',
        expect.any(Error)
      );
    });
  });

  describe('Production environment', () => {
    it('should initialize with production configuration', async () => {
      const prodConfig = {
        ...mockNodeConfig,
        environment: 'production',
        exporters: {
          console: false,
          otlp: {
            enabled: true,
            endpoint: 'https://collector.prod.example.com',
            protocol: 'http/protobuf' as const
          }
        },
        sampling: {
          traces: 0.1,
          metrics: 0.1
        }
      };
      mockGetObservabilityConfig.mockReturnValue(prodConfig);

      await initializeObservability();

      expect(console.debug).toHaveBeenCalledWith('[OTEL] Late initialization (runtime-based)', {
        environment: 'production',
        runtime: 'nodejs',
        service: 'test-service'
      });

      expect(mockInitializeMetrics).toHaveBeenCalled();

    });
  });

  describe('Test environment', () => {
    it('should skip initialization in test environment', async () => {
      const testConfig = {
        ...mockNodeConfig,
        enabled: false,
        environment: 'test'
      };
      mockGetObservabilityConfig.mockReturnValue(testConfig);

      await initializeObservability();

      expect(console.debug).toHaveBeenCalledWith('[OTEL] Observability disabled');
      expect(mockInitializeMetrics).not.toHaveBeenCalled();
    });
  });

  describe('Metrics initialization', () => {
    it('should initialize metrics when enabled', async () => {
      mockGetObservabilityConfig.mockReturnValue(mockNodeConfig);

      await initializeObservability();

      expect(mockInitializeMetrics).toHaveBeenCalled();
    });

    it('should handle metrics initialization errors', async () => {
      mockGetObservabilityConfig.mockReturnValue(mockNodeConfig);
      mockInitializeMetrics.mockImplementationOnce(() => {
        throw new Error('Metrics init failed');
      });

      await expect(initializeObservability()).resolves.not.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        '[OTEL] Failed to initialize observability:',
        expect.any(Error)
      );
    });
  });

  describe('Configuration edge cases', () => {
    it('should handle missing OTLP endpoint', async () => {
      const noOtlpConfig = {
        ...mockNodeConfig,
        exporters: {
          console: true,
          otlp: {
            enabled: false,
            endpoint: '',
            protocol: 'http/protobuf' as const
          }
        }
      };
      mockGetObservabilityConfig.mockReturnValue(noOtlpConfig);

      await initializeObservability();

      expect(mockInitializeMetrics).toHaveBeenCalled();
    });

    it('should handle console-only configuration', async () => {
      const consoleOnlyConfig = {
        ...mockNodeConfig,
        exporters: {
          console: true,
          otlp: {
            enabled: false,
            endpoint: '',
            protocol: 'http/protobuf' as const
          }
        }
      };
      mockGetObservabilityConfig.mockReturnValue(consoleOnlyConfig);

      await initializeObservability();

      expect(mockInitializeMetrics).toHaveBeenCalled();
      expect(console.debug).toHaveBeenCalledWith('[OTEL] Metrics initialized (tracing should be via register.ts)');
    });
  });
});