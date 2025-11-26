/**
 * MCP-specific metrics collection
 * Tracks protocol performance, tool usage, and session metrics
 */

import { metrics, Counter, Histogram, UpDownCounter } from '@opentelemetry/api';
import { getObservabilityConfig } from './config.js';

// Metric instruments
let mcpMessageCounter: Counter | undefined;
let mcpMessageDuration: Histogram | undefined;
let toolInvocationCounter: Counter | undefined;
let toolDuration: Histogram | undefined;
let sessionCounter: UpDownCounter | undefined;
let sessionDuration: Histogram | undefined;
let llmProviderCounter: Counter | undefined;
let llmLatency: Histogram | undefined;

/**
 * Initialize MCP-specific metrics
 */
export function initializeMetrics(): void {
  try {
    const config = getObservabilityConfig();

    if (!config.enabled || !config.sampling.metrics) {
      return;
    }

    const meter = metrics.getMeter('mcp-server', config.service?.version || '1.0.0');

  // MCP Protocol Metrics
  mcpMessageCounter = meter.createCounter('mcp_messages_total', {
    description: 'Total number of MCP messages processed'
  });

  mcpMessageDuration = meter.createHistogram('mcp_message_duration_ms', {
    description: 'Duration of MCP message processing in milliseconds'
  });

  // Tool Performance Metrics
  toolInvocationCounter = meter.createCounter('mcp_tool_invocations_total', {
    description: 'Total number of tool invocations'
  });

  toolDuration = meter.createHistogram('mcp_tool_duration_ms', {
    description: 'Duration of tool execution in milliseconds'
  });

  // Session Metrics
  sessionCounter = meter.createUpDownCounter('mcp_active_sessions', {
    description: 'Number of active MCP sessions'
  });

  sessionDuration = meter.createHistogram('mcp_session_duration_ms', {
    description: 'Duration of MCP sessions in milliseconds'
  });

  // LLM Provider Metrics
  llmProviderCounter = meter.createCounter('mcp_llm_requests_total', {
    description: 'Total number of LLM provider requests'
  });

  llmLatency = meter.createHistogram('mcp_llm_latency_ms', {
    description: 'Latency of LLM provider requests in milliseconds'
  });
  } catch (error) {
    // Silently fail if metrics initialization fails
    console.error('Failed to initialize metrics:', error);
  }
}

/**
 * Record MCP message metrics
 */
export function recordMCPMessage(
  messageType: 'request' | 'response' | 'notification',
  method: string,
  duration: number,
  success: boolean
): void {
  if (!mcpMessageCounter || !mcpMessageDuration) return;

  try {
    mcpMessageCounter.add(1, {
      message_type: messageType,
      method,
      success: success.toString()
    });

    mcpMessageDuration.record(duration, {
      message_type: messageType,
      method
    });
  } catch {
    // Silently fail if metrics recording fails
  }
}

/**
 * Record tool invocation metrics
 */
export function recordToolInvocation(
  toolName: string,
  duration: number,
  success: boolean,
  errorType?: string
): void {
  if (!toolInvocationCounter || !toolDuration) return;

  try {
    toolInvocationCounter.add(1, {
      tool_name: toolName,
      success: success.toString(),
      error_type: errorType ?? 'none'
    });

    toolDuration.record(duration, {
      tool_name: toolName,
      success: success.toString()
    });
  } catch {
    // Silently fail if metrics recording fails
  }
}

/**
 * Record session lifecycle metrics
 */
export function recordSessionEvent(
  event: 'created' | 'authenticated' | 'closed',
  sessionDurationMs?: number
): void {
  if (!sessionCounter) return;

  try {
    switch (event) {
      case 'created':
        sessionCounter.add(1);
        break;
      case 'closed':
        sessionCounter.add(-1);
        if (sessionDurationMs && sessionDuration) {
          sessionDuration.record(sessionDurationMs);
        }
        break;
    }
  } catch {
    // Silently fail if metrics recording fails
  }
}

/**
 * Record LLM provider metrics
 */
export function recordLLMRequest(
  provider: 'claude' | 'openai' | 'gemini',
  model: string,
  duration: number,
  success: boolean,
  tokenCount?: number
): void {
  if (!llmProviderCounter || !llmLatency) return;

  try {
    llmProviderCounter.add(1, {
      provider,
      model,
      success: success.toString()
    });

    llmLatency.record(duration, {
      provider,
      model
    });

    // Track token usage if available
    if (tokenCount) {
      const tokenMeter = metrics.getMeter('mcp-llm-tokens');
      const tokenCounter = tokenMeter.createCounter('mcp_llm_tokens_total', {
        description: 'Total number of LLM tokens consumed'
      });

      tokenCounter.add(tokenCount, {
        provider,
        model
      });
    }
  } catch {
    // Silently fail if metrics recording fails
  }
}

/**
 * Record OAuth authentication metrics
 */
export function recordOAuthEvent(
  provider: string,
  event: 'started' | 'completed' | 'failed',
  duration?: number
): void {
  try {
    const meter = metrics.getMeter('mcp-oauth');
    const oauthCounter = meter.createCounter('mcp_oauth_events_total', {
      description: 'Total number of OAuth events'
    });

    oauthCounter.add(1, {
      provider,
      event
    });

    if (duration && event === 'completed') {
      const oauthDuration = meter.createHistogram('mcp_oauth_duration_ms', {
        description: 'Duration of OAuth flows in milliseconds'
      });

      oauthDuration.record(duration, {
        provider
      });
    }
  } catch {
    // Silently fail if metrics recording fails
  }
}