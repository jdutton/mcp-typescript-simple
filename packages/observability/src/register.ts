/**
 * Early OpenTelemetry registration
 * MUST be loaded BEFORE any other application code to enable auto-instrumentation
 *
 * Usage: node --require ./build/observability/register.js ./build/index.js
 * Or: Import this file FIRST in your entry point
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  // eslint-disable-next-line sonarjs/deprecation -- No non-deprecated alternative available yet
  SEMRESATTRS_SERVICE_NAMESPACE,
  // eslint-disable-next-line sonarjs/deprecation -- No non-deprecated alternative available yet
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT
} from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { LoggerProvider, BatchLogRecordProcessor, ConsoleLogRecordExporter, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { logs } from '@opentelemetry/api-logs';
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
    const serviceName = process.env.OTEL_SERVICE_NAME ?? 'mcp-typescript-simple';
    const serviceVersion = process.env.npm_package_version ?? '1.0.0';
    const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT; // No default!

    // Determine log exporter based on OTLP endpoint configuration
    const useOTLP = !!otlpEndpoint;
    const exporterType = useOTLP ? 'OTLP' : 'console';

    console.debug('[OTEL] Early initialization starting', {
      service: serviceName,
      environment,
      exporter: exporterType,
      endpoint: otlpEndpoint ?? 'N/A (using console)'
    });

    // Create resource with service information
    // Use resourceFromAttributes() directly to ensure our service name takes precedence over defaults
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      // eslint-disable-next-line sonarjs/deprecation -- No non-deprecated alternative available yet
      [SEMRESATTRS_SERVICE_NAMESPACE]: environment === 'production' ? 'prod' : 'dev',
      // eslint-disable-next-line sonarjs/deprecation -- No non-deprecated alternative available yet
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment
    });

    // Configure trace and metric exporters (OTLP only if endpoint configured)
    const traceExporter = useOTLP
      ? new OTLPTraceExporter({
          url: `${otlpEndpoint}/v1/traces`,
          headers: {}
        })
      : undefined;

    const metricExporter = useOTLP
      ? new OTLPMetricExporter({
          url: `${otlpEndpoint}/v1/metrics`,
          headers: {}
        })
      : undefined;

    // Configure log exporter: OTLP if endpoint configured, otherwise console
    // Console exporter emits OCSF events to stdout (visible in Vercel logs, Docker logs, terminal, etc.)
    const logExporter = useOTLP
      ? new OTLPLogExporter({
          url: `${otlpEndpoint}/v1/logs`,
          headers: {}
        })
      : new ConsoleLogRecordExporter();

    // Create and register LoggerProvider explicitly
    // CRITICAL: NodeSDK does NOT automatically set global LoggerProvider
    // We must set it explicitly for OCSF events to be captured
    const logProcessor = useOTLP
      ? new BatchLogRecordProcessor(logExporter)
      : new SimpleLogRecordProcessor(logExporter); // Console uses SimpleLogRecordProcessor for immediate output

    const loggerProvider = new LoggerProvider({
      resource,
      processors: [logProcessor]
    });
    logs.setGlobalLoggerProvider(loggerProvider);

    // Initialize SDK with exporters (traces and metrics only if OTLP configured)
    const sdkConfig: {
      resource: ReturnType<typeof resourceFromAttributes>;
      instrumentations: ReturnType<typeof getNodeAutoInstrumentations>[];
      traceExporter?: OTLPTraceExporter;
      metricReader?: PeriodicExportingMetricReader;
      spanProcessor?: BatchSpanProcessor;
    } = {
      resource,
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
                'http.target': (request as { url?: string }).url ?? ''
              });
            }
          },
          // Enable Express instrumentation (best effort for Express 5.x)
          '@opentelemetry/instrumentation-express': {
            enabled: true,
            requestHook: (span, _info: unknown) => {
              // Add Express-specific attributes
              span.setAttributes({
                'mcp.component': 'express-middleware'
              });
            }
          }
        })
      ]
    };

    // Add trace processor if OTLP configured
    if (traceExporter) {
      sdkConfig.spanProcessor = new BatchSpanProcessor(traceExporter, {
        maxQueueSize: 2048,
        maxExportBatchSize: 512,
        scheduledDelayMillis: 5000 // Export every 5 seconds in dev
      });
    }

    // Add metric reader if OTLP configured
    if (metricExporter) {
      sdkConfig.metricReader = new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 10000 // Export metrics every 10 seconds
      });
    }

    const sdk = new NodeSDK(sdkConfig);
    sdk.start();

    console.debug('[OTEL] Early initialization complete', {
      service: serviceName,
      environment,
      exporter: exporterType,
      tracing: useOTLP ? 'OTLP enabled' : 'disabled',
      metrics: useOTLP ? 'OTLP enabled' : 'disabled',
      logs: useOTLP ? 'OTLP enabled' : 'console enabled'
    });

    // Graceful shutdown
    // IMPORTANT: Signal handling is done by the main application (index.ts)
    // This prevents duplicate signal handlers and race conditions
    // The SDK will auto-shutdown on beforeExit, or the app can call shutdown manually
    const shutdown = async () => {
      try {
        await sdk.shutdown();
        console.debug('[OTEL] SDK shutdown complete');
      } catch (error) {
        console.error('[OTEL] Error during shutdown:', error);
      }
    };

    // Only register beforeExit (automatic cleanup) - let main app handle SIGINT/SIGTERM
    process.on('beforeExit', () => { void shutdown(); });

  } catch (error) {
    console.error('[OTEL] Failed to initialize:', error);
    // Don't crash the application if OTEL fails
  }
}