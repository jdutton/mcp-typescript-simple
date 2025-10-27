/**
 * Main observability module exports
 *
 * NOTE: For Node.js applications, observability is now initialized via
 * src/observability/register.ts using the --import flag (see package.json).
 * This ensures auto-instrumentation hooks are registered before any modules load.
 *
 * The functions below are kept for:
 * - Vercel Edge runtime (which doesn't support --import)
 * - Manual initialization in special cases
 * - Backward compatibility
 */

import { getObservabilityConfig, detectRuntime } from './config.js';

/**
 * @deprecated For Node.js: Use --import ./src/observability/register.ts instead
 * Initialize observability based on runtime environment
 * Only needed for Edge runtime or special cases
 */
export async function initializeObservability(): Promise<void> {
  const config = getObservabilityConfig();
  const runtime = detectRuntime();

  if (!config.enabled) {
    console.debug('[OTEL] Observability disabled');
    return;
  }

  // For Node.js, warn that register.ts should be used instead
  if (runtime === 'nodejs') {
    console.warn('[OTEL] Warning: initializeObservability() called in Node.js runtime.');
    console.warn('[OTEL] For proper auto-instrumentation, use --import ./src/observability/register.ts');
    console.warn('[OTEL] See package.json dev:http script for example');
  }

  console.debug('[OTEL] Late initialization (runtime-based)', {
    environment: config.environment,
    runtime,
    service: config.service.name
  });

  try {
    if (runtime === 'nodejs') {
      // Initialize metrics only (tracing already initialized via register.ts if used correctly)
      const { initializeMetrics } = await import('./metrics.js');
      initializeMetrics();
      console.debug('[OTEL] Metrics initialized (tracing should be via register.ts)');
    } else {
      // Edge runtime - minimal instrumentation
      const { initializeEdgeInstrumentation } = await import('./instrumentation-edge.js');
      initializeEdgeInstrumentation();
      console.debug('[OTEL] Edge runtime observability initialized');
    }
  } catch (error) {
    console.error('[OTEL] Failed to initialize observability:', error);
    // Don't let observability failures break the application
  }
}

// Re-export all observability utilities
export { getObservabilityConfig, detectRuntime, detectEnvironment } from './config.js';
export { logger, getLogger, ObservabilityLogger } from './logger.js';
export {
  extractSessionContext,
  addSessionToSpan,
  createSessionSpan,
  type SessionContext
} from './session-correlation.js';
export {
  recordMCPMessage,
  recordToolInvocation,
  recordSessionEvent,
  recordLLMRequest,
  recordOAuthEvent
} from './metrics.js';
export {
  createMCPSpan,
  createToolSpan,
  createLLMSpan,
  createOAuthSpan,
  createTransportSpan,
  getCurrentTraceId,
  getCurrentSpanId,
  addAttributesToCurrentSpan,
  recordExceptionInCurrentSpan
} from './tracing.js';

// Vercel-specific exports
export { createEdgeSpan } from './instrumentation-edge.js';