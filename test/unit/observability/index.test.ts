/**
 * Tests for observability initialization
 */

import { vi } from 'vitest';

// Hoist mocks so they're available in vi.mock() factories
const mocks = vi.hoisted(() => ({
  mockGetObservabilityConfig: vi.fn(),
  mockDetectRuntime: vi.fn(),
  mockInitializeInstrumentation: vi.fn(),
  mockInitializeEdgeInstrumentation: vi.fn(),
  mockShutdownInstrumentation: vi.fn(),
  mockInitializeMetrics: vi.fn(),
  mockGetLogger: vi.fn()
}));

// Mock config module
vi.mock('../../../src/observability/config.js', () => ({
  getObservabilityConfig: mocks.mockGetObservabilityConfig,
  detectRuntime: mocks.mockDetectRuntime
}));

// Mock instrumentation modules
vi.mock('../../../src/observability/instrumentation.js', () => ({
  initializeInstrumentation: mocks.mockInitializeInstrumentation,
  shutdownInstrumentation: mocks.mockShutdownInstrumentation
}));

vi.mock('../../../src/observability/instrumentation-edge.js', () => ({
  initializeEdgeInstrumentation: mocks.mockInitializeEdgeInstrumentation
}));

// Mock metrics
vi.mock('../../../src/observability/metrics.js', () => ({
  initializeMetrics: mocks.mockInitializeMetrics
}));

// Mock logger
vi.mock('../../../src/observability/logger.js', () => ({
  getLogger: mocks.mockGetLogger
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
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.mockDetectRuntime.mockReturnValue('nodejs');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Node.js runtime', () => {
    it('should initialize Node.js instrumentation when enabled', async () => {
      mocks.mockGetObservabilityConfig.mockReturnValue(mockNodeConfig);

      await initializeObservability();

      // Check for warning about using register.ts instead
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[OTEL] Warning: initializeObservability() called in Node.js runtime'));

      expect(console.debug).toHaveBeenCalledWith('[OTEL] Late initialization (runtime-based)', {
        environment: 'development',
        runtime: 'nodejs',
        service: 'test-service'
      });

      expect(mocks.mockInitializeMetrics).toHaveBeenCalled();
      expect(console.debug).toHaveBeenCalledWith('[OTEL] Metrics initialized (tracing should be via register.ts)');

      // Should not initialize edge instrumentation
      expect(mocks.mockInitializeEdgeInstrumentation).not.toHaveBeenCalled();
    });

    it('should skip initialization when disabled', async () => {
      const disabledConfig = { ...mockNodeConfig, enabled: false };
      mocks.mockGetObservabilityConfig.mockReturnValue(disabledConfig);

      await initializeObservability();

      expect(console.debug).toHaveBeenCalledWith('[OTEL] Observability disabled');
      expect(mocks.mockInitializeMetrics).not.toHaveBeenCalled();
      expect(mocks.mockInitializeEdgeInstrumentation).not.toHaveBeenCalled();
    });

    it('should handle initialization errors gracefully', async () => {
      mocks.mockGetObservabilityConfig.mockReturnValue(mockNodeConfig);
      mocks.mockInitializeMetrics.mockImplementationOnce(() => {
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
      mocks.mockGetObservabilityConfig.mockReturnValue(mockEdgeConfig);
      mocks.mockDetectRuntime.mockReturnValue('edge');

      await initializeObservability();

      expect(console.debug).toHaveBeenCalledWith('[OTEL] Late initialization (runtime-based)', {
        environment: 'development',
        runtime: 'edge',
        service: 'test-service'
      });

      expect(mocks.mockInitializeEdgeInstrumentation).toHaveBeenCalled();

      expect(console.debug).toHaveBeenCalledWith('[OTEL] Edge runtime observability initialized');

      // Should not initialize Node.js metrics (Edge uses different approach)
      expect(mocks.mockInitializeMetrics).not.toHaveBeenCalled();
    });

    it('should handle Edge initialization errors', async () => {
      mocks.mockGetObservabilityConfig.mockReturnValue(mockEdgeConfig);
      mocks.mockDetectRuntime.mockReturnValue('edge');
      mocks.mockInitializeEdgeInstrumentation.mockImplementationOnce(() => {
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
      mocks.mockGetObservabilityConfig.mockReturnValue(prodConfig);

      await initializeObservability();

      expect(console.debug).toHaveBeenCalledWith('[OTEL] Late initialization (runtime-based)', {
        environment: 'production',
        runtime: 'nodejs',
        service: 'test-service'
      });

      expect(mocks.mockInitializeMetrics).toHaveBeenCalled();

    });
  });

  describe('Test environment', () => {
    it('should skip initialization in test environment', async () => {
      const testConfig = {
        ...mockNodeConfig,
        enabled: false,
        environment: 'test'
      };
      mocks.mockGetObservabilityConfig.mockReturnValue(testConfig);

      await initializeObservability();

      expect(console.debug).toHaveBeenCalledWith('[OTEL] Observability disabled');
      expect(mocks.mockInitializeMetrics).not.toHaveBeenCalled();
    });
  });

  describe('Metrics initialization', () => {
    it('should initialize metrics when enabled', async () => {
      mocks.mockGetObservabilityConfig.mockReturnValue(mockNodeConfig);

      await initializeObservability();

      expect(mocks.mockInitializeMetrics).toHaveBeenCalled();
    });

    it('should handle metrics initialization errors', async () => {
      mocks.mockGetObservabilityConfig.mockReturnValue(mockNodeConfig);
      mocks.mockInitializeMetrics.mockImplementationOnce(() => {
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
      mocks.mockGetObservabilityConfig.mockReturnValue(noOtlpConfig);

      await initializeObservability();

      expect(mocks.mockInitializeMetrics).toHaveBeenCalled();
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
      mocks.mockGetObservabilityConfig.mockReturnValue(consoleOnlyConfig);

      await initializeObservability();

      expect(mocks.mockInitializeMetrics).toHaveBeenCalled();
      expect(console.debug).toHaveBeenCalledWith('[OTEL] Metrics initialized (tracing should be via register.ts)');
    });
  });
});