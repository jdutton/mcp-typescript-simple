/**
 * Distributed tracing utilities for MCP operations
 */

import { trace, SpanStatusCode } from '@opentelemetry/api';
import { getObservabilityConfig } from './config.js';
import { addSessionToSpan, type SessionContext } from './session-correlation.js';

/**
 * Create a span for MCP operations with session correlation
 */
export function createMCPSpan<T>(
  name: string,
  operation: () => Promise<T> | T,
  sessionContext?: SessionContext,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  const config = getObservabilityConfig();

  if (!config.enabled) {
    return Promise.resolve(operation());
  }

  const tracer = trace.getTracer('mcp-server', config.service.version);

  return tracer.startActiveSpan(name, async (span) => {
    try {
      // Add session correlation if provided
      if (sessionContext) {
        addSessionToSpan(sessionContext);
      }

      // Add additional attributes
      if (attributes) {
        span.setAttributes(attributes);
      }

      // Add component tag
      span.setAttributes({
        'mcp.component': 'server'
      });

      const result = await operation();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Create a span for tool invocations
 */
export function createToolSpan<T>(
  toolName: string,
  operation: () => Promise<T> | T,
  sessionContext?: SessionContext,
  parameters?: Record<string, unknown>
): Promise<T> {
  return createMCPSpan(
    `tool.${toolName}`,
    operation,
    sessionContext,
    {
      'mcp.tool.name': toolName,
      'mcp.operation': 'tool_invocation',
      'mcp.tool.parameters_count': parameters ? Object.keys(parameters).length : 0
    }
  );
}

/**
 * Create a span for LLM provider calls
 */
export function createLLMSpan<T>(
  provider: string,
  model: string,
  operation: () => Promise<T> | T,
  sessionContext?: SessionContext
): Promise<T> {
  return createMCPSpan(
    `llm.${provider}.${model}`,
    operation,
    sessionContext,
    {
      'mcp.llm.provider': provider,
      'mcp.llm.model': model,
      'mcp.operation': 'llm_request'
    }
  );
}

/**
 * Create a span for OAuth operations
 */
export function createOAuthSpan<T>(
  provider: string,
  operation: string,
  callback: () => Promise<T> | T,
  sessionContext?: SessionContext
): Promise<T> {
  return createMCPSpan(
    `oauth.${provider}.${operation}`,
    callback,
    sessionContext,
    {
      'mcp.oauth.provider': provider,
      'mcp.oauth.operation': operation,
      'mcp.operation': 'oauth'
    }
  );
}

/**
 * Create a span for transport operations (STDIO/HTTP)
 */
export function createTransportSpan<T>(
  transport: 'stdio' | 'http',
  operation: string,
  callback: () => Promise<T> | T,
  sessionContext?: SessionContext
): Promise<T> {
  return createMCPSpan(
    `transport.${transport}.${operation}`,
    callback,
    sessionContext,
    {
      'mcp.transport': transport,
      'mcp.transport.operation': operation,
      'mcp.operation': 'transport'
    }
  );
}

/**
 * Get current trace ID for correlation
 */
export function getCurrentTraceId(): string | undefined {
  const span = trace.getActiveSpan();
  return span?.spanContext().traceId;
}

/**
 * Get current span ID for correlation
 */
export function getCurrentSpanId(): string | undefined {
  const span = trace.getActiveSpan();
  return span?.spanContext().spanId;
}

/**
 * Add attributes to current span
 */
export function addAttributesToCurrentSpan(attributes: Record<string, string | number | boolean>): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttributes(attributes);
  }
}

/**
 * Record an exception in the current span
 */
export function recordExceptionInCurrentSpan(error: Error): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message
    });
  }
}