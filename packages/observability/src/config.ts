/**
 * Observability configuration with environment detection
 */

export interface ObservabilityConfig {
  enabled: boolean;
  environment: 'development' | 'production' | 'test';
  runtime: 'nodejs' | 'edge';
  sampling: {
    traces: number;
    metrics: boolean;
    logs: boolean;
  };
  exporters: {
    console: boolean;
    otlp: {
      enabled: boolean;
      endpoint: string;
      protocol: 'http/protobuf' | 'grpc';
    };
  };
  service: {
    name: string;
    version: string;
    namespace?: string;
  };
}

/**
 * Detect runtime environment
 */
export function detectRuntime(): 'nodejs' | 'edge' {
  return process.env.NEXT_RUNTIME === 'edge' ? 'edge' : 'nodejs';
}

/**
 * Detect if running in Vercel serverless environment
 * Vercel serverless functions don't support Pino transports (worker threads)
 */
export function isVercelServerless(): boolean {
  return Boolean(
    process.env.VERCEL &&
    process.env.AWS_LAMBDA_FUNCTION_NAME // Vercel uses AWS Lambda
  );
}

/**
 * Detect deployment environment
 */
export function detectEnvironment(): 'development' | 'production' | 'test' {
  if (process.env.NODE_ENV === 'test') {
    return 'test';
  }
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
    return 'production';
  }
  return 'development';
}

/**
 * Get observability configuration based on environment
 */
export function getObservabilityConfig(): ObservabilityConfig {
  const environment = detectEnvironment();
  const runtime = detectRuntime();

  // Base configuration
  const config: ObservabilityConfig = {
    enabled: environment !== 'test',
    environment,
    runtime,
    service: {
      name: 'mcp-typescript-simple',
      version: process.env.npm_package_version ?? '1.0.0',
      namespace: environment === 'production' ? 'prod' : 'dev'
    },
    sampling: {
      traces: environment === 'development' ? 1.0 : 0.1, // 100% dev, 10% prod
      metrics: true,
      logs: true
    },
    exporters: {
      console: environment === 'development',
      otlp: {
        enabled: true,
        endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
        protocol: 'http/protobuf'
      }
    }
  };

  // Disable transports in Vercel serverless (they require worker threads)
  if (isVercelServerless()) {
    config.exporters.console = false;
    config.exporters.otlp.enabled = false;
    config.runtime = 'nodejs'; // Mark as nodejs but without transports
  }

  // Environment-specific overrides
  switch (environment) {
    case 'development':
      config.exporters.console = true;
      config.sampling.traces = 1.0; // 100% sampling for debugging
      break;

    case 'production':
      config.exporters.console = false;
      config.sampling.traces = 0.1; // 10% sampling for performance
      if (process.env.VERCEL) {
        // Vercel-specific configuration
        config.exporters.otlp.endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '';
      }
      break;

    case 'test':
      config.enabled = false;
      config.exporters.console = false;
      config.exporters.otlp.enabled = false;
      break;
  }

  return config;
}