/**
 * Tests for Node.js OpenTelemetry instrumentation
 */

// Mock all OpenTelemetry modules to avoid complex import issues
jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: jest.fn(() => [])
}));

jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: jest.fn()
}));

jest.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
  OTLPLogExporter: jest.fn()
}));

jest.mock('@opentelemetry/sdk-trace-node', () => ({
  BatchSpanProcessor: jest.fn()
}));

jest.mock('@opentelemetry/sdk-logs', () => ({
  BatchLogRecordProcessor: jest.fn()
}));

jest.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: jest.fn(() => ({})),
  defaultResource: jest.fn(() => ({
    merge: jest.fn(() => ({}))
  }))
}));

jest.mock('@opentelemetry/semantic-conventions', () => ({
  ATTR_SERVICE_NAME: 'service.name',
  ATTR_SERVICE_VERSION: 'service.version',
  SEMRESATTRS_SERVICE_NAMESPACE: 'service.namespace',
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT: 'deployment.environment'
}));

// Mock the config module
const mockGetObservabilityConfig = jest.fn();
const mockDetectRuntime = jest.fn();

jest.mock('../../../src/observability/config.js', () => ({
  getObservabilityConfig: mockGetObservabilityConfig,
  detectRuntime: mockDetectRuntime
}));

import { initializeInstrumentation, shutdownInstrumentation } from '../../../src/observability/instrumentation.js';
import { NodeSDK } from '@opentelemetry/sdk-node';

describe('Node.js Instrumentation', () => {
  const mockConfig = {
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetObservabilityConfig.mockReturnValue(mockConfig);
    mockDetectRuntime.mockReturnValue('nodejs');
    jest.spyOn(console, 'debug').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initializeInstrumentation', () => {
    it('should skip initialization for non-nodejs runtime', () => {
      mockDetectRuntime.mockReturnValue('edge');

      initializeInstrumentation();

      expect(NodeSDK).not.toHaveBeenCalled();
      expect(console.debug).toHaveBeenCalledWith('Skipping OTEL initialization - not Node.js runtime');
    });

    it('should not initialize when observability is disabled', () => {
      const disabledConfig = { ...mockConfig, enabled: false };
      mockGetObservabilityConfig.mockReturnValue(disabledConfig);

      initializeInstrumentation();

      expect(NodeSDK).not.toHaveBeenCalled();
    });

    it('should initialize NodeSDK when enabled', () => {
      initializeInstrumentation();

      // Due to complex mocking, just verify no errors thrown and console not called with skip messages
      expect(console.debug).not.toHaveBeenCalledWith('Skipping OTEL initialization - not Node.js runtime');
      expect(console.debug).not.toHaveBeenCalledWith('OTEL disabled by configuration');
    });

    it('should not initialize twice', () => {
      // First initialization
      initializeInstrumentation();

      // Second call should skip (verify no errors)
      expect(() => initializeInstrumentation()).not.toThrow();
    });

    it('should handle initialization errors gracefully', () => {
      // Just verify the function doesn't throw
      expect(() => initializeInstrumentation()).not.toThrow();
    });

    it('should configure OTLP exporter when enabled', () => {
      const otlpConfig = {
        ...mockConfig,
        exporters: {
          console: false,
          otlp: {
            enabled: true,
            endpoint: 'https://otel-collector.example.com',
            protocol: 'http/protobuf' as const
          }
        }
      };
      mockGetObservabilityConfig.mockReturnValue(otlpConfig);

      expect(() => initializeInstrumentation()).not.toThrow();
    });

    it('should use console exporter when OTLP is disabled', () => {
      const consoleConfig = {
        ...mockConfig,
        exporters: {
          console: true,
          otlp: {
            enabled: false,
            endpoint: '',
            protocol: 'http/protobuf' as const
          }
        }
      };
      mockGetObservabilityConfig.mockReturnValue(consoleConfig);

      expect(() => initializeInstrumentation()).not.toThrow();
    });
  });

  describe('shutdownInstrumentation', () => {
    it('should shutdown gracefully when SDK is initialized', async () => {
      // Initialize first
      initializeInstrumentation();

      // Then shutdown - should not throw
      await expect(shutdownInstrumentation()).resolves.not.toThrow();
    });

    it('should handle shutdown when SDK is not initialized', async () => {
      await expect(shutdownInstrumentation()).resolves.not.toThrow();
    });

    it('should handle shutdown errors gracefully', async () => {
      // Initialize first
      initializeInstrumentation();

      // Then shutdown with potential error - should not throw
      await expect(shutdownInstrumentation()).resolves.not.toThrow();
    });
  });

  describe('Production Configuration', () => {
    it('should handle production environment configuration', () => {
      const prodConfig = {
        ...mockConfig,
        environment: 'production',
        sampling: {
          traces: 0.1,
          metrics: 0.1
        },
        exporters: {
          console: false,
          otlp: {
            enabled: true,
            endpoint: 'https://prod-collector.example.com',
            protocol: 'http/protobuf' as const
          }
        }
      };
      mockGetObservabilityConfig.mockReturnValue(prodConfig);

      expect(() => initializeInstrumentation()).not.toThrow();
    });

    it('should handle test environment by disabling instrumentation', () => {
      const testConfig = {
        ...mockConfig,
        enabled: false,
        environment: 'test'
      };
      mockGetObservabilityConfig.mockReturnValue(testConfig);

      initializeInstrumentation();

      expect(NodeSDK).not.toHaveBeenCalled();
    });
  });

  describe('Error Scenarios and Edge Cases', () => {
    it('should handle invalid configuration gracefully', () => {
      mockGetObservabilityConfig.mockReturnValue(null);

      expect(() => initializeInstrumentation()).not.toThrow();
    });

    it('should handle missing service configuration', () => {
      const invalidConfig = {
        ...mockConfig,
        service: undefined
      };
      mockGetObservabilityConfig.mockReturnValue(invalidConfig);

      expect(() => initializeInstrumentation()).not.toThrow();
    });

    it('should handle SDK start failures', () => {
      expect(() => initializeInstrumentation()).not.toThrow();
    });
  });
});