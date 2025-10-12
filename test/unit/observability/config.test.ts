/**
 * Tests for observability configuration
 */

import {
  detectRuntime,
  detectEnvironment,
  getObservabilityConfig
} from '../../../src/observability/config.js';
import { preserveEnv } from '../../helpers/env-helper.js';

describe('Observability Config', () => {
  let restoreEnv: () => void;

  beforeEach(() => {
    restoreEnv = preserveEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  describe('detectRuntime', () => {
    it('should default to nodejs runtime', () => {
      const runtime = detectRuntime();
      expect(runtime).toBe('nodejs');
    });
  });

  describe('detectEnvironment', () => {

    it('should detect test environment', () => {
      process.env.NODE_ENV = 'test';
      const environment = detectEnvironment();
      expect(environment).toBe('test');
    });

    it('should detect production environment', () => {
      process.env.NODE_ENV = 'production';
      const environment = detectEnvironment();
      expect(environment).toBe('production');
    });

    it('should default to development environment', () => {
      process.env.NODE_ENV = 'development';
      const environment = detectEnvironment();
      expect(environment).toBe('development');
    });
  });

  describe('getObservabilityConfig', () => {
    it('should return valid configuration for development', () => {
      process.env.NODE_ENV = 'development';
      const config = getObservabilityConfig();

      expect(config.enabled).toBe(true);
      expect(config.environment).toBe('development');
      expect(config.runtime).toBe('nodejs');
      expect(config.sampling.traces).toBe(1.0); // 100% in development
      expect(config.exporters.console).toBe(true);
      expect(config.service.name).toBe('mcp-typescript-simple');
    });

    it('should return valid configuration for production', () => {
      process.env.NODE_ENV = 'production';
      const config = getObservabilityConfig();

      expect(config.enabled).toBe(true);
      expect(config.environment).toBe('production');
      expect(config.sampling.traces).toBe(0.1); // 10% in production
      expect(config.exporters.console).toBe(false);
    });

    it('should disable observability for test environment', () => {
      process.env.NODE_ENV = 'test';
      const config = getObservabilityConfig();

      expect(config.enabled).toBe(false);
      expect(config.environment).toBe('test');
      expect(config.exporters.console).toBe(false);
      // OTLP config still available, but observability disabled
    });

    it('should have required service configuration', () => {
      const config = getObservabilityConfig();

      expect(config.service.name).toBe('mcp-typescript-simple');
      expect(config.service.version).toBeDefined();
      expect(config.service.namespace).toBeDefined();
    });

    it('should have OTLP exporter configuration in non-test environments', () => {
      process.env.NODE_ENV = 'development';

      const config = getObservabilityConfig();

      expect(config.exporters.otlp.enabled).toBe(true);
      expect(config.exporters.otlp.endpoint).toBeDefined();
      expect(config.exporters.otlp.protocol).toBe('http/protobuf');
    });
  });
});