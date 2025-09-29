/**
 * OpenTelemetry instrumentation setup (LEGACY)
 *
 * @deprecated This file is kept for backward compatibility and edge cases only.
 *
 * For Node.js applications, use src/observability/register.ts with --import flag instead.
 * This ensures auto-instrumentation hooks are registered BEFORE any modules load.
 *
 * See package.json scripts (dev:http, dev:oauth, etc.) for correct usage.
 *
 * Node.js runtime only - conditional loading for Vercel compatibility
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
import { getObservabilityConfig, detectRuntime } from './config.js';

let sdk: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry instrumentation for Node.js runtime
 * Must be called before any other imports to ensure auto-instrumentation works
 */
export function initializeInstrumentation(): void {
  // Only initialize in Node.js runtime
  if (detectRuntime() !== 'nodejs') {
    console.debug('Skipping OTEL initialization - not Node.js runtime');
    return;
  }

  if (sdk) {
    console.debug('OTEL already initialized');
    return;
  }

  const config = getObservabilityConfig();

  if (!config.enabled) {
    console.debug('OTEL disabled by configuration');
    return;
  }

  try {
    // Create resource with service information
    const resource = defaultResource().merge(resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.service.name,
      [ATTR_SERVICE_VERSION]: config.service.version,
      [SEMRESATTRS_SERVICE_NAMESPACE]: config.service.namespace || '',
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: config.environment
    }));

    // Configure trace exporter
    const traceExporter = new OTLPTraceExporter({
      url: `${config.exporters.otlp.endpoint}/v1/traces`,
      headers: {}
    });

    // Configure log exporter
    const logExporter = new OTLPLogExporter({
      url: `${config.exporters.otlp.endpoint}/v1/logs`,
      headers: {}
    });

    // Configure metric exporter
    const metricExporter = new OTLPMetricExporter({
      url: `${config.exporters.otlp.endpoint}/v1/metrics`,
      headers: {}
    });

    // Initialize SDK
    sdk = new NodeSDK({
      resource,
      spanProcessor: new BatchSpanProcessor(traceExporter, {
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        scheduledDelayMillis: config.environment === 'development' ? 5000 : 30000
      }),
      logRecordProcessor: new BatchLogRecordProcessor(logExporter),
      metricReader: new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: config.environment === 'development' ? 10000 : 60000
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          // Disable some instrumentations to reduce overhead
          '@opentelemetry/instrumentation-fs': {
            enabled: false // Too noisy for file operations
          },
          '@opentelemetry/instrumentation-http': {
            enabled: true,
            requestHook: (span: unknown) => {
              // Add custom attributes for HTTP requests
              if (span && typeof span === 'object' && 'setAttributes' in span) {
                (span as { setAttributes: (attrs: Record<string, string>) => void }).setAttributes({
                  'mcp.component': 'http-server'
                });
              }
            }
          },
          '@opentelemetry/instrumentation-express': {
            enabled: true
          }
        })
      ]
    });

    sdk.start();

    console.debug('OpenTelemetry instrumentation initialized', {
      service: config.service.name,
      environment: config.environment,
      endpoint: config.exporters.otlp.endpoint
    });

  } catch (error) {
    console.error('Failed to initialize OpenTelemetry:', error);
  }
}

/**
 * Shutdown OpenTelemetry instrumentation
 */
export async function shutdownInstrumentation(): Promise<void> {
  if (sdk) {
    try {
      await sdk.shutdown();
      sdk = null;
      console.debug('OpenTelemetry instrumentation shutdown');
    } catch (error) {
      console.error('Error shutting down OpenTelemetry:', error);
    }
  }
}

// Graceful shutdown on process termination
process.on('SIGTERM', () => {
  shutdownInstrumentation().finally(() => process.exit(0));
});

process.on('SIGINT', () => {
  shutdownInstrumentation().finally(() => process.exit(0));
});