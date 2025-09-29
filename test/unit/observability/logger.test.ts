/**
 * Tests for observability logger
 */

import { ObservabilityLogger, logger } from '../../../src/observability/logger.js';
import { getObservabilityConfig } from '../../../src/observability/config.js';

describe('ObservabilityLogger', () => {
  let testLogger: ObservabilityLogger;

  beforeEach(() => {
    // Create logger with test configuration
    const testConfig = getObservabilityConfig();
    testConfig.enabled = false; // Disable OTEL for tests
    testConfig.exporters.console = false; // Disable console output for tests
    testLogger = new ObservabilityLogger(testConfig);
  });

  describe('basic logging functionality', () => {
    it('should provide debug method', () => {
      expect(typeof testLogger.debug).toBe('function');
      // Should not throw
      testLogger.debug('Test debug message', { key: 'value' });
    });

    it('should provide info method', () => {
      expect(typeof testLogger.info).toBe('function');
      testLogger.info('Test info message', { key: 'value' });
    });

    it('should provide warn method', () => {
      expect(typeof testLogger.warn).toBe('function');
      testLogger.warn('Test warn message', { key: 'value' });
    });

    it('should provide error method', () => {
      expect(typeof testLogger.error).toBe('function');
      testLogger.error('Test error message', new Error('Test error'));
    });
  });

  describe('OAuth-specific logging methods', () => {
    it('should provide OAuth debug method', () => {
      expect(typeof testLogger.oauthDebug).toBe('function');
      testLogger.oauthDebug('OAuth debug message');
    });

    it('should provide OAuth info method', () => {
      expect(typeof testLogger.oauthInfo).toBe('function');
      testLogger.oauthInfo('OAuth info message');
    });

    it('should provide OAuth warn method', () => {
      expect(typeof testLogger.oauthWarn).toBe('function');
      testLogger.oauthWarn('OAuth warn message');
    });

    it('should provide OAuth error method', () => {
      expect(typeof testLogger.oauthError).toBe('function');
      testLogger.oauthError('OAuth error message', new Error('OAuth error'));
    });
  });

  describe('singleton logger', () => {
    it('should export singleton logger instance', () => {
      expect(logger).toBeDefined();
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('should not throw when logging without data', () => {
      expect(() => logger.debug('Debug message')).not.toThrow();
      expect(() => logger.info('Info message')).not.toThrow();
      expect(() => logger.warn('Warn message')).not.toThrow();
      expect(() => logger.error('Error message')).not.toThrow();
    });

    it('should not throw when logging with data', () => {
      expect(() => logger.debug('Debug message', { test: true })).not.toThrow();
      expect(() => logger.info('Info message', { test: true })).not.toThrow();
      expect(() => logger.warn('Warn message', { test: true })).not.toThrow();
      expect(() => logger.error('Error message', new Error('Test'))).not.toThrow();
    });
  });
});