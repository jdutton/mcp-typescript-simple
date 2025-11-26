/**
 * Structured logging with Pino and OpenTelemetry integration
 * Replaces existing logger with backward compatibility
 */

import pino from 'pino';
import { trace } from '@opentelemetry/api';
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { logs } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  SEMRESATTRS_SERVICE_NAMESPACE,
  SEMRESATTRS_DEPLOYMENT_ENVIRONMENT
} from '@opentelemetry/semantic-conventions';
import { getObservabilityConfig, type ObservabilityConfig } from './config.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Enhanced logger with Pino and OTEL integration
 * Maintains backward compatibility with existing Logger interface
 */
export class ObservabilityLogger {
  private pino: pino.Logger;
  private config: ObservabilityConfig;
  private isProduction: boolean;
  private hasTransports: boolean;

  constructor(config?: ObservabilityConfig) {
    this.config = config || getObservabilityConfig();
    this.isProduction = this.config.environment === 'production';
    this.hasTransports = false; // Will be set in createPinoLogger

    // Create Pino logger with environment-specific configuration
    this.pino = this.createPinoLogger();
  }

  private createPinoLogger(): pino.Logger {
    const transports: pino.TransportSingleOptions[] = [];

    // Redirect all logs to /dev/null for concise test output
    // Only applies when running tests (NODE_ENV=test), not when spawning servers
    // during integration tests
    if (process.env.NODE_ENV === 'test') {
      return pino(
        { level: 'silent' },
        pino.destination('/dev/null')
      );
    }

    // CRITICAL: Transports (worker threads) are NEVER supported in Vercel serverless
    // Detect Vercel environment and skip ALL transports to prevent crashes
    const isVercel = Boolean(process.env.VERCEL);

    if (isVercel) {
      // In Vercel, use basic Pino without transports
      // This prevents "unable to determine transport target" errors
      return pino({
        level: this.config.environment === 'development' ? 'debug' : 'info',
        formatters: {
          level: (label) => ({ level: label }),
          log: (object) => this.addTraceContext(object)
        }
      });
    }

    // Note: Transports are disabled in Vercel serverless (worker threads not supported)
    // The config detects this and disables exporters automatically

    // Console transport for development
    if (this.config.exporters.console) {
      transports.push({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
          destination: 2 // Output to stderr (fd 2) instead of stdout
        }
      });
    }

    // OpenTelemetry transport for structured observability
    if (this.config.exporters.otlp.enabled && this.config.runtime === 'nodejs') {
      transports.push({
        target: 'pino-opentelemetry-transport',
        options: {
          resourceAttributes: {
            'service.name': this.config.service.name,
            'service.version': this.config.service.version,
            'service.namespace': this.config.service.namespace
          },
          logRecordProcessorOptions: {
            recordProcessorType: 'batch',
            exporterOptions: {
              url: this.config.exporters.otlp.endpoint
            }
          }
        }
      });
    }

    this.hasTransports = transports.length > 0;

    if (this.hasTransports) {
      // When using transports, we can't use custom formatters
      return pino({
        level: this.config.environment === 'development' ? 'debug' : 'info',
        transport: { targets: transports }
      });
    } else {
      // When not using transports, we can use custom formatters
      return pino({
        level: this.config.environment === 'development' ? 'debug' : 'info',
        formatters: {
          level: (label) => ({ level: label }),
          log: (object) => this.addTraceContext(object)
        }
      });
    }
  }

  /**
   * Add OpenTelemetry trace context to log entries
   */
  private addTraceContext(logObject: Record<string, unknown>): Record<string, unknown> {
    const span = trace.getActiveSpan();
    if (span) {
      const spanContext = span.spanContext();
      return {
        ...logObject,
        trace_id: spanContext.traceId,
        span_id: spanContext.spanId,
        trace_flags: spanContext.traceFlags
      };
    }
    return logObject;
  }

  /**
   * Sanitize sensitive information for production
   * Maintains compatibility with existing sanitization logic
   */
  private sanitizeForProduction(message: string, data?: unknown): { message: string; data?: unknown } {
    if (!this.isProduction) {
      return { message, data };
    }

    // Production sanitization - same logic as existing logger
    const sanitizedMessage = message
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]')
      .replace(/\b\d{4,}\b/g, '[NUMBER]')
      .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [TOKEN]')
      .replace(/[A-Za-z0-9\-._~+/]{32,}/g, '[TOKEN]');

    let sanitizedData = data;
    if (data && typeof data === 'object') {
      sanitizedData = this.sanitizeObject(data);
    }

    return { message: sanitizedMessage, data: sanitizedData };
  }

  private sanitizeObject(obj: unknown, visited?: WeakSet<object>): unknown {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (!visited) {
      visited = new WeakSet();
    }

    if (visited.has(obj as object)) {
      return '[Circular Reference]';
    }

    visited.add(obj as object);

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item, visited));
    }

    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = ['password', 'secret', 'token', 'key', 'auth', 'credential'];

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();

      if (sensitiveKeys.some(sensitiveKey => lowerKey.includes(sensitiveKey))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeObject(value, visited);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  // Helper method to add trace context when using transports
  private addTraceContextToData(data?: unknown): unknown {
    if (this.hasTransports) {
      // When using transports, manually add trace context
      const traceData = this.addTraceContext(data as Record<string, unknown> ?? {});
      return traceData;
    }
    return data;
  }

  // Backward compatible logging methods
  debug(message: string, data?: unknown): void {
    const { message: sanitizedMessage, data: sanitizedData } = this.sanitizeForProduction(message, data);
    const dataWithTrace = this.addTraceContextToData(sanitizedData);
    this.pino.debug(dataWithTrace ?? {}, sanitizedMessage);
  }

  info(message: string, data?: unknown): void {
    const { message: sanitizedMessage, data: sanitizedData } = this.sanitizeForProduction(message, data);
    const dataWithTrace = this.addTraceContextToData(sanitizedData);
    this.pino.info(dataWithTrace ?? {}, sanitizedMessage);
  }

  warn(message: string, data?: unknown): void {
    const { message: sanitizedMessage, data: sanitizedData } = this.sanitizeForProduction(message, data);
    const dataWithTrace = this.addTraceContextToData(sanitizedData);
    this.pino.warn(dataWithTrace ?? {}, sanitizedMessage);
  }

  error(message: string, error?: Error | unknown): void {
    const { message: sanitizedMessage } = this.sanitizeForProduction(message);

    if (error instanceof Error) {
      const errorInfo = this.isProduction
        ? { name: error.name, message: 'Internal server error' }
        : { name: error.name, message: error.message, stack: error.stack };

      const errorWithTrace = this.addTraceContextToData(errorInfo);
      this.pino.error(errorWithTrace, sanitizedMessage);
    } else if (error) {
      const { data: sanitizedError } = this.sanitizeForProduction('', error);
      const dataWithTrace = this.addTraceContextToData(sanitizedError);
      this.pino.error(dataWithTrace ?? {}, sanitizedMessage);
    } else {
      const dataWithTrace = this.addTraceContextToData({});
      this.pino.error(dataWithTrace, sanitizedMessage);
    }
  }

  // OAuth-specific logging methods (backward compatibility)
  oauthDebug(message: string, data?: unknown): void {
    this.debug(`[OAuth] ${message}`, data);
  }

  oauthInfo(message: string, data?: unknown): void {
    this.info(`[OAuth] ${message}`, data);
  }

  oauthWarn(message: string, data?: unknown): void {
    this.warn(`[OAuth] ${message}`, data);
  }

  oauthError(message: string, error?: Error | unknown): void {
    this.error(`[OAuth] ${message}`, error);
  }

  /**
   * Get underlying Pino logger for advanced usage
   */
  getPino(): pino.Logger {
    return this.pino;
  }
}

// Singleton instance for backward compatibility
let loggerInstance: ObservabilityLogger | null = null;

export function getLogger(): ObservabilityLogger {
  if (!loggerInstance) {
    loggerInstance = new ObservabilityLogger();
  }
  return loggerInstance;
}

// Export singleton instance with same interface as existing logger
export const logger = getLogger();

/**
 * OpenTelemetry LoggerProvider initialization
 *
 * This function provides explicit LoggerProvider initialization to avoid
 * timing issues with Node.js --import flag and ES modules.
 *
 * CRITICAL: Must be called early in application entry point (index.ts)
 * BEFORE any OCSF events are emitted.
 */

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

/**
 * Initialize OpenTelemetry LoggerProvider
 *
 * Call this function ONCE at application startup, BEFORE any OCSF events
 * are emitted. This avoids ProxyLoggerProvider (no-op) issues caused by
 * --import timing with ES modules.
 */
export function initializeLoggerProvider(): void {
  const environment = detectEnvironment();

  // Skip OTEL in test environment
  if (environment === 'test') {
    console.debug('[LoggerProvider] Skipping initialization in test environment');
    return;
  }

  try {
    const serviceName = process.env.OTEL_SERVICE_NAME || 'mcp-typescript-simple';
    const serviceVersion = process.env.npm_package_version || '1.0.0';
    const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';

    console.debug('[LoggerProvider] Initializing', {
      service: serviceName,
      environment,
      endpoint: otlpEndpoint
    });

    // Create resource with service information
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      [SEMRESATTRS_SERVICE_NAMESPACE]: environment === 'production' ? 'prod' : 'dev',
      [SEMRESATTRS_DEPLOYMENT_ENVIRONMENT]: environment
    });

    // Configure log exporter
    const logExporter = new OTLPLogExporter({
      url: `${otlpEndpoint}/v1/logs`,
      headers: {}
    });

    // Create and register LoggerProvider explicitly
    // CRITICAL: NodeSDK does NOT automatically set global LoggerProvider
    // We must set it explicitly for OCSF events to be captured
    const loggerProvider = new LoggerProvider({
      resource,
      processors: [new BatchLogRecordProcessor(logExporter)]
    });

    // Register as global LoggerProvider
    logs.setGlobalLoggerProvider(loggerProvider);

    console.debug('[LoggerProvider] Initialization complete', {
      service: serviceName,
      environment,
      logs: 'enabled'
    });
  } catch (error) {
    console.error('[LoggerProvider] Failed to initialize:', error);
    // Don't crash the application if OTEL fails
  }
}