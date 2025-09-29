/**
 * Early OpenTelemetry registration
 * MUST be loaded BEFORE any other application code to enable auto-instrumentation
 *
 * Usage: node --require ./build/observability/register.js ./build/index.js
 * Or: Import this file FIRST in your entry point
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes, defaultResource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_SERVICE_NAMESPACE,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT
} from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

// Detect environment
function detectEnvironment(): 'development' | 'production' | 'test' {
  if (process.env.NODE_ENV === 'test') {
    return 'test';
  }
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
    return 'production';
  }
  return 'development';
}

const environment = detectEnvironment();

// Skip OTEL in test environment
if (environment === 'test') {
  console.debug('[OTEL] Skipping initialization in test environment');
} else {
  try {
    const serviceName = 'mcp-typescript-simple';
    const serviceVersion = process.env.npm_package_version || '1.0.0';
    const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

    console.debug('[OTEL] Early initialization starting', {
      service: serviceName,
      environment,
      endpoint: otlpEndpoint
    });

    // Create resource with service information
    const resource = defaultResource().merge(resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      [SEMRESATTRS_SERVICE_NAMESPACE]: environment === 'production' ? 'prod' : 'dev',
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment
    }));

    // Configure exporters
    const traceExporter = new OTLPTraceExporter({
      url: `${otlpEndpoint}/v1/traces`,
      headers: {}
    });

    const logExporter = new OTLPLogExporter({
      url: `${otlpEndpoint}/v1/logs`,
      headers: {}
    });

    const metricExporter = new OTLPMetricExporter({
      url: `${otlpEndpoint}/v1/metrics`,
      headers: {}
    });

    // Initialize SDK with all exporters
    const sdk = new NodeSDK({
      resource,
      spanProcessor: new BatchSpanProcessor(traceExporter, {
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        scheduledDelayMillis: 5000 // Export every 5 seconds in dev
      }),
      logRecordProcessor: new BatchLogRecordProcessor(logExporter),
      metricReader: new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 10000 // Export metrics every 10 seconds
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          // Disable noisy instrumentations
          '@opentelemetry/instrumentation-fs': {
            enabled: false
          },
          // Enable HTTP instrumentation
          '@opentelemetry/instrumentation-http': {
            enabled: true,
            requestHook: (span, request) => {
              // Add custom attributes for HTTP requests
              span.setAttributes({
                'mcp.component': 'http-server',
                'http.target': (request as any).url || ''
              });
            }
          },
          // Enable Express instrumentation (best effort for Express 5.x)
          '@opentelemetry/instrumentation-express': {
            enabled: true,
            requestHook: (span, info) => {
              // Add Express-specific attributes
              span.setAttributes({
                'mcp.component': 'express-middleware'
              });
            }
          }
        })
      ]
    });

    sdk.start();

    console.debug('[OTEL] Early initialization complete', {
      service: serviceName,
      environment,
      tracing: 'enabled',
      metrics: 'enabled',
      logs: 'enabled'
    });

    // Graceful shutdown
    const shutdown = async () => {
      try {
        await sdk.shutdown();
        console.debug('[OTEL] SDK shutdown complete');
      } catch (error) {
        console.error('[OTEL] Error during shutdown:', error);
      }
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    process.on('beforeExit', shutdown);

  } catch (error) {
    console.error('[OTEL] Failed to initialize:', error);
    // Don't crash the application if OTEL fails
  }
}