/**
 * OpenTelemetry instrumentation setup
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
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
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

    // Initialize SDK
    sdk = new NodeSDK({
      resource,
      spanProcessor: new BatchSpanProcessor(traceExporter),
      logRecordProcessor: new BatchLogRecordProcessor(logExporter),
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