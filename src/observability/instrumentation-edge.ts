/**
 * Lightweight OpenTelemetry setup for Edge runtime
 * Vercel Edge runtime has limitations - minimal instrumentation only
 */

import { trace } from '@opentelemetry/api';
import { getObservabilityConfig } from './config.js';

/**
 * Initialize minimal observability for Edge runtime
 * Edge runtime doesn't support full NodeSDK
 */
export function initializeEdgeInstrumentation(): void {
  const config = getObservabilityConfig();

  if (!config.enabled || config.runtime !== 'edge') {
    return;
  }

  console.debug('Edge runtime detected - using minimal observability');

  // For Edge runtime, we can only do basic tracing
  // Most OTEL features are not available
  try {
    // Basic tracer setup - very limited functionality
    trace.getTracer(config.service.name, config.service.version);

    console.debug('Edge observability initialized', {
      service: config.service.name,
      runtime: 'edge'
    });
  } catch (error) {
    console.error('Failed to initialize edge observability:', error);
  }
}

/**
 * Create a simple span for Edge runtime
 * Limited functionality compared to full Node.js instrumentation
 */
export function createEdgeSpan(name: string, fn: () => Promise<unknown> | unknown): Promise<unknown> {
  const config = getObservabilityConfig();

  if (!config.enabled || config.runtime !== 'edge') {
    return Promise.resolve(fn());
  }

  const tracer = trace.getTracer(config.service.name);

  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: 1 }); // OK
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: 2 }); // ERROR
      throw error;
    } finally {
      span.end();
    }
  });
}