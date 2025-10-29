/**
 * OCSF-OTEL Bridge
 *
 * Emits OCSF structured audit events as OpenTelemetry logs with automatic trace correlation.
 * This enables standards-based security audit logging with full observability integration.
 *
 * Features:
 * - Automatic trace context correlation (trace_id, span_id)
 * - OCSF severity → OTEL severity mapping
 * - Structured log attributes from OCSF events
 * - SIEM-compatible JSON output
 * - Zero-config integration with existing OTEL infrastructure
 */

import { logs, SeverityNumber, type Logger as OTELLogger, type AnyValue } from '@opentelemetry/api-logs';
import { trace } from '@opentelemetry/api';
import type { BaseEvent } from './types/base.js';
import { SeverityId } from './types/base.js';

/**
 * Map OCSF severity to OpenTelemetry severity
 */
function mapOCSFSeverityToOTEL(ocsfSeverity: SeverityId): SeverityNumber {
  switch (ocsfSeverity) {
    case SeverityId.Unknown:
      return SeverityNumber.UNSPECIFIED;
    case SeverityId.Informational:
      return SeverityNumber.INFO;
    case SeverityId.Low:
      return SeverityNumber.INFO2;
    case SeverityId.Medium:
      return SeverityNumber.WARN;
    case SeverityId.High:
      return SeverityNumber.ERROR;
    case SeverityId.Critical:
      return SeverityNumber.FATAL;
    case SeverityId.Fatal:
      return SeverityNumber.FATAL4;
    case SeverityId.Other:
      return SeverityNumber.UNSPECIFIED;
    default:
      return SeverityNumber.UNSPECIFIED;
  }
}

/**
 * OCSF-OTEL Bridge
 *
 * Emits OCSF events as OpenTelemetry logs with automatic trace correlation.
 */
export class OCSFOTELBridge {
  private readonly logger: OTELLogger;
  private readonly serviceName: string;

  /**
   * Create a new OCSF-OTEL bridge
   * @param serviceName - Service name for log attribution (default: 'mcp-server')
   * @throws Error if OTEL logger provider is not initialized
   */
  constructor(serviceName = 'mcp-server') {
    this.serviceName = serviceName;

    // Get OTEL logger provider and validate initialization (M4/M7)
    const loggerProvider = logs.getLoggerProvider();
    if (!loggerProvider) {
      const error =
        'OTEL logger provider not initialized. Ensure OpenTelemetry SDK is configured before creating OCSF bridge.';
      // Use console.error since we're in observability package (avoid circular dependency)
      console.error(`[OCSF-OTEL Bridge] ERROR: ${error}`);
      throw new Error(error);
    }

    this.logger = loggerProvider.getLogger(serviceName, '1.0.0');
    if (!this.logger) {
      const error = `Failed to create OTEL logger for service: ${serviceName}`;
      console.error(`[OCSF-OTEL Bridge] ERROR: ${error}`);
      throw new Error(error);
    }
  }

  /**
   * Emit an OCSF event as an OpenTelemetry log
   *
   * @param event - OCSF event to emit
   * @param options - Additional options
   * @param options.observedTimestamp - Custom observed timestamp (default: now)
   * @param options.addTraceContext - Add trace context if available (default: true)
   */
  emitEvent(
    event: BaseEvent,
    options: {
      observedTimestamp?: number;
      addTraceContext?: boolean;
    } = {}
  ): void {
    const { observedTimestamp = Date.now(), addTraceContext = true } = options;

    // Map OCSF severity to OTEL severity
    const severityNumber = mapOCSFSeverityToOTEL(event.severity_id);

    // Build log attributes from OCSF event
    const attributes: Record<string, AnyValue> = {
      // OCSF base fields
      'ocsf.class_uid': event.class_uid,
      'ocsf.class_name': event.class_name,
      'ocsf.category_uid': event.category_uid,
      'ocsf.category_name': event.category_name,
      'ocsf.activity_id': event.activity_id,
      'ocsf.activity_name': event.activity_name,
      'ocsf.type_uid': event.type_uid,
      'ocsf.type_name': event.type_name,
      'ocsf.severity_id': event.severity_id,
      'ocsf.severity': event.severity,
      'ocsf.time': event.time,

      // Optional base fields
      ...(event.status_id !== undefined && { 'ocsf.status_id': event.status_id }),
      ...(event.status && { 'ocsf.status': event.status }),
      ...(event.status_code && { 'ocsf.status_code': event.status_code }),
      ...(event.status_detail && { 'ocsf.status_detail': event.status_detail }),

      // Metadata
      'ocsf.metadata.version': event.metadata.version,
      ...(event.metadata.product && {
        'ocsf.metadata.product.name': event.metadata.product.name,
        'ocsf.metadata.product.version': event.metadata.product.version,
        'ocsf.metadata.product.vendor_name': event.metadata.product.vendor_name,
      }),
      ...(event.metadata.uid && { 'ocsf.metadata.uid': event.metadata.uid }),
      ...(event.metadata.correlation_uid && { 'ocsf.metadata.correlation_uid': event.metadata.correlation_uid }),

      // Actor information
      ...(event.actor?.user && {
        'ocsf.actor.user.name': event.actor.user.name,
        'ocsf.actor.user.uid': event.actor.user.uid,
        'ocsf.actor.user.email_addr': event.actor.user.email_addr,
      }),
      ...(event.actor?.session && {
        'ocsf.actor.session.uid': event.actor.session.uid,
        'ocsf.actor.session.issuer': event.actor.session.issuer,
      }),

      // Network endpoints
      ...(event.src_endpoint && {
        'ocsf.src_endpoint.ip': event.src_endpoint.ip,
        'ocsf.src_endpoint.port': event.src_endpoint.port,
        'ocsf.src_endpoint.hostname': event.src_endpoint.hostname,
      }),
      ...(event.dst_endpoint && {
        'ocsf.dst_endpoint.ip': event.dst_endpoint.ip,
        'ocsf.dst_endpoint.port': event.dst_endpoint.port,
        'ocsf.dst_endpoint.hostname': event.dst_endpoint.hostname,
      }),

      // Cloud context
      ...(event.cloud && {
        'ocsf.cloud.provider': event.cloud.provider,
        'ocsf.cloud.region': event.cloud.region,
      }),

      // Device information
      ...(event.device && {
        'ocsf.device.name': event.device.name,
        'ocsf.device.type': event.device.type,
        'ocsf.device.hostname': event.device.hostname,
      }),

      // Performance metrics
      ...(event.duration !== undefined && { 'ocsf.duration': event.duration }),
      ...(event.count !== undefined && { 'ocsf.count': event.count }),

      // Full event as JSON for SIEM systems
      'ocsf.event': JSON.stringify(event),
    };

    // Add trace context if requested and available
    if (addTraceContext) {
      const activeSpan = trace.getActiveSpan();
      if (activeSpan) {
        const spanContext = activeSpan.spanContext();
        attributes['trace_id'] = spanContext.traceId;
        attributes['span_id'] = spanContext.spanId;
        attributes['trace_flags'] = spanContext.traceFlags;

        // Also add to OCSF metadata for consistency
        if (!event.metadata.correlation_uid) {
          attributes['ocsf.metadata.correlation_uid'] = spanContext.traceId;
        }
      }
    }

    // Emit log via OTEL
    this.logger.emit({
      severityNumber,
      severityText: event.severity || 'UNKNOWN',
      body: event.message || `${event.class_name || 'Event'}: ${event.activity_name || 'Activity'}`,
      attributes,
      timestamp: event.time,
      observedTimestamp,
    });
  }

  /**
   * Helper method to emit Authentication events
   */
  emitAuthenticationEvent(event: BaseEvent): void {
    this.emitEvent(event);
  }

  /**
   * Helper method to emit API Activity events
   */
  emitAPIActivityEvent(event: BaseEvent): void {
    this.emitEvent(event);
  }
}

/**
 * Singleton OCSF-OTEL bridge instance
 */
let bridgeInstance: OCSFOTELBridge | null = null;

/**
 * Get the singleton OCSF-OTEL bridge instance
 */
export function getOCSFOTELBridge(serviceName = 'mcp-server'): OCSFOTELBridge {
  if (!bridgeInstance) {
    bridgeInstance = new OCSFOTELBridge(serviceName);
  }
  return bridgeInstance;
}

/**
 * Convenience function to emit an OCSF event
 */
export function emitOCSFEvent(event: BaseEvent): void {
  const bridge = getOCSFOTELBridge();
  bridge.emitEvent(event);
}
