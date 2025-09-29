/**
 * Main observability module initialization
 * Handles runtime detection and environment-specific setup
 */

import { getObservabilityConfig, detectRuntime } from './config.js';

/**
 * Initialize observability based on runtime environment
 * Must be called early in application startup
 */
export async function initializeObservability(): Promise<void> {
  const config = getObservabilityConfig();
  const runtime = detectRuntime();

  if (!config.enabled) {
    console.debug('Observability disabled');
    return;
  }

  console.debug('Initializing observability', {
    environment: config.environment,
    runtime,
    service: config.service.name
  });

  try {
    if (runtime === 'nodejs') {
      // Full Node.js instrumentation
      const { initializeInstrumentation } = await import('./instrumentation.js');
      initializeInstrumentation();

      // Initialize metrics
      const { initializeMetrics } = await import('./metrics.js');
      initializeMetrics();

      console.debug('Full Node.js observability initialized');
    } else {
      // Edge runtime - minimal instrumentation
      const { initializeEdgeInstrumentation } = await import('./instrumentation-edge.js');
      initializeEdgeInstrumentation();

      console.debug('Edge runtime observability initialized');
    }
  } catch (error) {
    console.error('Failed to initialize observability:', error);
    // Don't let observability failures break the application
  }
}

/**
 * Shutdown observability
 */
export async function shutdownObservability(): Promise<void> {
  const runtime = detectRuntime();

  if (runtime === 'nodejs') {
    try {
      const { shutdownInstrumentation } = await import('./instrumentation.js');
      await shutdownInstrumentation();
    } catch (error) {
      console.error('Error shutting down observability:', error);
    }
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