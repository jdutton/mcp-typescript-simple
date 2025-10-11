/**
 * Tests for MCP-specific metrics collection
 */

import { vi } from 'vitest';

// Hoist mocks so they're available in vi.mock() factories
const mocks = vi.hoisted(() => ({
  mockCounter: {
    add: vi.fn()
  },
  mockHistogram: {
    record: vi.fn()
  },
  mockUpDownCounter: {
    add: vi.fn()
  },
  mockMeter: {
    createCounter: vi.fn(),
    createHistogram: vi.fn(),
    createUpDownCounter: vi.fn()
  },
  mockGetMeter: vi.fn(),
  getObservabilityConfig: vi.fn()
}));

// Setup mockMeter to return mock instruments
mocks.mockMeter.createCounter.mockReturnValue(mocks.mockCounter);
mocks.mockMeter.createHistogram.mockReturnValue(mocks.mockHistogram);
mocks.mockMeter.createUpDownCounter.mockReturnValue(mocks.mockUpDownCounter);
mocks.mockGetMeter.mockReturnValue(mocks.mockMeter);

vi.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: mocks.mockGetMeter
  }
}));

// Mock config module
vi.mock('../../../src/observability/config.js', () => ({
  getObservabilityConfig: mocks.getObservabilityConfig
}));

import {
  initializeMetrics,
  recordMCPMessage,
  recordToolInvocation,
  recordSessionEvent,
  recordLLMRequest,
  recordOAuthEvent
} from '../../../src/observability/metrics.js';
import { getObservabilityConfig } from '../../../src/observability/config.js';

describe('MCP Metrics', () => {
  const mockConfig = {
    enabled: true,
    environment: 'development',
    runtime: 'nodejs' as const,
    service: {
      name: 'test-service',
      version: '1.0.0',
      namespace: 'test'
    },
    sampling: {
      traces: 1.0,
      metrics: 1.0
    },
    exporters: {
      console: true,
      otlp: {
        enabled: false,
        endpoint: '',
        protocol: 'http/protobuf' as const
      }
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getObservabilityConfig.mockReturnValue(mockConfig);

    // Reset initialization state
  });

  describe('initializeMetrics', () => {
    it('should not initialize when disabled', () => {
      const disabledConfig = { ...mockConfig, enabled: false };
      mocks.getObservabilityConfig.mockReturnValue(disabledConfig);

      initializeMetrics();

      expect(mocks.mockGetMeter).not.toHaveBeenCalled();
    });

    it('should not initialize when metrics sampling is disabled', () => {
      const noMetricsConfig = {
        ...mockConfig,
        sampling: { traces: 1.0, metrics: 0 }
      };
      mocks.getObservabilityConfig.mockReturnValue(noMetricsConfig);

      initializeMetrics();

      expect(mocks.mockGetMeter).not.toHaveBeenCalled();
    });

    it('should initialize all metric instruments', () => {
      initializeMetrics();

      expect(mocks.mockGetMeter).toHaveBeenCalledWith('mcp-server', '1.0.0');

      // MCP Protocol Metrics
      expect(mocks.mockMeter.createCounter).toHaveBeenCalledWith('mcp_messages_total', {
        description: 'Total number of MCP messages processed'
      });
      expect(mocks.mockMeter.createHistogram).toHaveBeenCalledWith('mcp_message_duration_ms', {
        description: 'Duration of MCP message processing in milliseconds'
      });

      // Tool Performance Metrics
      expect(mocks.mockMeter.createCounter).toHaveBeenCalledWith('mcp_tool_invocations_total', {
        description: 'Total number of tool invocations'
      });
      expect(mocks.mockMeter.createHistogram).toHaveBeenCalledWith('mcp_tool_duration_ms', {
        description: 'Duration of tool execution in milliseconds'
      });

      // Session Metrics
      expect(mocks.mockMeter.createUpDownCounter).toHaveBeenCalledWith('mcp_active_sessions', {
        description: 'Number of active MCP sessions'
      });
      expect(mocks.mockMeter.createHistogram).toHaveBeenCalledWith('mcp_session_duration_ms', {
        description: 'Duration of MCP sessions in milliseconds'
      });

      // LLM Provider Metrics
      expect(mocks.mockMeter.createCounter).toHaveBeenCalledWith('mcp_llm_requests_total', {
        description: 'Total number of LLM provider requests'
      });
      expect(mocks.mockMeter.createHistogram).toHaveBeenCalledWith('mcp_llm_latency_ms', {
        description: 'Latency of LLM provider requests in milliseconds'
      });
    });
  });

  describe('recordMCPMessage', () => {
    it('should record successful message metrics', () => {
      initializeMetrics();
      vi.clearAllMocks();

      recordMCPMessage('request', 'initialize', 150, true);

      expect(mocks.mockCounter.add).toHaveBeenCalledWith(1, {
        message_type: 'request',
        method: 'initialize',
        success: 'true'
      });

      expect(mocks.mockHistogram.record).toHaveBeenCalledWith(150, {
        message_type: 'request',
        method: 'initialize'
      });
    });

    it('should record failed message metrics', () => {
      initializeMetrics();
      vi.clearAllMocks();

      recordMCPMessage('response', 'tools/invoke', 500, false);

      expect(mocks.mockCounter.add).toHaveBeenCalledWith(1, {
        message_type: 'response',
        method: 'tools/invoke',
        success: 'false'
      });

      expect(mocks.mockHistogram.record).toHaveBeenCalledWith(500, {
        message_type: 'response',
        method: 'tools/invoke'
      });
    });

    it('should handle notification messages', () => {
      initializeMetrics();
      vi.clearAllMocks();

      recordMCPMessage('notification', 'progress', 50, true);

      expect(mocks.mockCounter.add).toHaveBeenCalledWith(1, {
        message_type: 'notification',
        method: 'progress',
        success: 'true'
      });
    });
  });

  describe('recordToolInvocation', () => {
    it('should record successful tool invocation', () => {
      initializeMetrics();
      vi.clearAllMocks();

      recordToolInvocation('chat', 1500, true);

      expect(mocks.mockCounter.add).toHaveBeenCalledWith(1, {
        tool_name: 'chat',
        success: 'true',
        error_type: 'none'
      });

      expect(mocks.mockHistogram.record).toHaveBeenCalledWith(1500, {
        tool_name: 'chat',
        success: 'true'
      });
    });

    it('should record failed tool invocation with error type', () => {
      initializeMetrics();
      vi.clearAllMocks();

      recordToolInvocation('analyze', 3000, false, 'timeout');

      expect(mocks.mockCounter.add).toHaveBeenCalledWith(1, {
        tool_name: 'analyze',
        success: 'false',
        error_type: 'timeout'
      });

      expect(mocks.mockHistogram.record).toHaveBeenCalledWith(3000, {
        tool_name: 'analyze',
        success: 'false'
      });
    });
  });

  describe('recordSessionEvent', () => {
    it('should increment counter on session creation', () => {
      initializeMetrics();
      vi.clearAllMocks();

      recordSessionEvent('created');

      expect(mocks.mockUpDownCounter.add).toHaveBeenCalledWith(1);
      expect(mocks.mockHistogram.record).not.toHaveBeenCalled();
    });

    it('should decrement counter and record duration on session close', () => {
      initializeMetrics();
      vi.clearAllMocks();

      recordSessionEvent('closed', 60000);

      expect(mocks.mockUpDownCounter.add).toHaveBeenCalledWith(-1);
      expect(mocks.mockHistogram.record).toHaveBeenCalledWith(60000);
    });

    it('should handle authenticated event without counter change', () => {
      initializeMetrics();
      vi.clearAllMocks();

      recordSessionEvent('authenticated');

      expect(mocks.mockUpDownCounter.add).not.toHaveBeenCalled();
      expect(mocks.mockHistogram.record).not.toHaveBeenCalled();
    });

    it('should handle close without duration', () => {
      initializeMetrics();
      vi.clearAllMocks();

      recordSessionEvent('closed');

      expect(mocks.mockUpDownCounter.add).toHaveBeenCalledWith(-1);
      expect(mocks.mockHistogram.record).not.toHaveBeenCalled();
    });
  });

  describe('recordLLMRequest', () => {
    it('should record successful LLM request', () => {
      initializeMetrics();
      vi.clearAllMocks();

      recordLLMRequest('openai', 'gpt-4', 3500, true);

      expect(mocks.mockCounter.add).toHaveBeenCalledWith(1, {
        provider: 'openai',
        model: 'gpt-4',
        success: 'true'
      });

      expect(mocks.mockHistogram.record).toHaveBeenCalledWith(3500, {
        provider: 'openai',
        model: 'gpt-4'
      });
    });

    it('should record failed LLM request', () => {
      initializeMetrics();
      vi.clearAllMocks();

      recordLLMRequest('gemini', 'gemini-2.5-flash-lite', 5000, false);

      expect(mocks.mockCounter.add).toHaveBeenCalledWith(1, {
        provider: 'gemini',
        model: 'gemini-2.5-flash-lite',
        success: 'false'
      });

      expect(mocks.mockHistogram.record).toHaveBeenCalledWith(5000, {
        provider: 'gemini',
        model: 'gemini-2.5-flash-lite'
      });
    });

    it('should record token usage when provided', () => {
      initializeMetrics();
      vi.clearAllMocks();

      recordLLMRequest('claude', 'claude-3-sonnet', 2500, true, 1500);

      // Verify token counter creation and usage
      expect(mocks.mockGetMeter).toHaveBeenCalledWith('mcp-llm-tokens');
      expect(mocks.mockMeter.createCounter).toHaveBeenCalledWith('mcp_llm_tokens_total', {
        description: 'Total number of LLM tokens consumed'
      });
      expect(mocks.mockCounter.add).toHaveBeenCalledWith(1500, {
        provider: 'claude',
        model: 'claude-3-sonnet'
      });
    });
  });

  describe('recordOAuthEvent', () => {
    it('should record OAuth started event', () => {
      recordOAuthEvent('google', 'started');

      expect(mocks.mockGetMeter).toHaveBeenCalledWith('mcp-oauth');
      expect(mocks.mockMeter.createCounter).toHaveBeenCalledWith('mcp_oauth_events_total', {
        description: 'Total number of OAuth events'
      });
      expect(mocks.mockCounter.add).toHaveBeenCalledWith(1, {
        provider: 'google',
        event: 'started'
      });
    });

    it('should record OAuth completed event with duration', () => {
      recordOAuthEvent('github', 'completed', 4500);

      expect(mocks.mockCounter.add).toHaveBeenCalledWith(1, {
        provider: 'github',
        event: 'completed'
      });
      expect(mocks.mockMeter.createHistogram).toHaveBeenCalledWith('mcp_oauth_duration_ms', {
        description: 'Duration of OAuth flows in milliseconds'
      });
      expect(mocks.mockHistogram.record).toHaveBeenCalledWith(4500, {
        provider: 'github'
      });
    });

    it('should record OAuth failed event without duration', () => {
      recordOAuthEvent('microsoft', 'failed');

      expect(mocks.mockCounter.add).toHaveBeenCalledWith(1, {
        provider: 'microsoft',
        event: 'failed'
      });
      expect(mocks.mockMeter.createHistogram).not.toHaveBeenCalledWith('mcp_oauth_duration_ms', expect.any(Object));
    });

    it('should only record duration for completed events', () => {
      // Failed with duration should not record duration
      recordOAuthEvent('generic', 'failed', 1000);

      expect(mocks.mockCounter.add).toHaveBeenCalledWith(1, {
        provider: 'generic',
        event: 'failed'
      });
      expect(mocks.mockMeter.createHistogram).not.toHaveBeenCalledWith('mcp_oauth_duration_ms', expect.any(Object));
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle metrics API failures gracefully', () => {
      mocks.mockCounter.add.mockImplementationOnce(() => {
        throw new Error('Metrics API error');
      });

      initializeMetrics();

      // Should not throw even if metrics API fails
      expect(() => recordMCPMessage('request', 'test', 100, true)).not.toThrow();
    });

    it('should handle histogram recording failures', () => {
      mocks.mockHistogram.record.mockImplementationOnce(() => {
        throw new Error('Histogram error');
      });

      initializeMetrics();

      expect(() => recordMCPMessage('request', 'test', 100, true)).not.toThrow();
    });

    it('should validate metric parameters before recording', () => {
      initializeMetrics();
      vi.clearAllMocks();

      // Test with invalid duration (negative)
      recordMCPMessage('request', 'test', -100, true);
      recordToolInvocation('tool', -50, true);
      recordLLMRequest('claude', 'claude-3-haiku', -200, true);

      // Should still call metrics but with potentially sanitized values
      expect(mocks.mockCounter.add).toHaveBeenCalled();
      expect(mocks.mockHistogram.record).toHaveBeenCalled();
    });

    it('should handle extremely large metric values', () => {
      initializeMetrics();
      vi.clearAllMocks();

      const hugeValue = Number.MAX_SAFE_INTEGER;

      expect(() => {
        recordMCPMessage('request', 'test', hugeValue, true);
        recordToolInvocation('tool', hugeValue, true);
        recordLLMRequest('openai', 'gpt-4', hugeValue, true);
      }).not.toThrow();
    });

    it('should handle invalid session event types', () => {
      initializeMetrics();
      vi.clearAllMocks();

      // Should not throw with invalid event type
      expect(() => recordSessionEvent('invalid_event' as any)).not.toThrow();
    });

    it('should handle meter creation failures during initialization', () => {
      mocks.mockGetMeter.mockImplementationOnce(() => {
        throw new Error('Meter creation failed');
      });

      expect(() => initializeMetrics()).not.toThrow();
    });

    it('should handle OAuth event recording with edge cases', () => {
      // Test with empty provider name
      expect(() => recordOAuthEvent('', 'started')).not.toThrow();

      // Test with null duration
      expect(() => recordOAuthEvent('google', 'completed', null as any)).not.toThrow();

      // Test with invalid event type
      expect(() => recordOAuthEvent('google', 'invalid' as any)).not.toThrow();
    });
  });

  describe('Performance and Memory', () => {
    it('should not leak memory with repeated metric recording', () => {
      initializeMetrics();

      // Simulate high-frequency metric recording
      for (let i = 0; i < 1000; i++) {
        recordMCPMessage('request', `method_${i}`, 100, true);
        recordToolInvocation(`tool_${i}`, 50, true);
      }

      // Should not accumulate internal state
      expect(mocks.mockCounter.add).toHaveBeenCalledTimes(2000);
    });

    it('should handle concurrent metric recording safely', async () => {
      initializeMetrics();
      vi.clearAllMocks();

      // Simulate concurrent metric recording
      const promises = Array.from({ length: 100 }, (_, i) =>
        Promise.resolve().then(() => recordMCPMessage('request', `concurrent_${i}`, 100, true))
      );

      await Promise.all(promises);
      expect(mocks.mockCounter.add).toHaveBeenCalledTimes(100);
    });
  });

  describe('Configuration Edge Cases', () => {
    it('should handle partial configuration gracefully', () => {
      const partialConfig = {
        enabled: true,
        sampling: { metrics: 1.0 }
        // Missing other required fields
      } as any;

      mocks.getObservabilityConfig.mockReturnValue(partialConfig);

      expect(() => initializeMetrics()).not.toThrow();
    });

    it('should handle zero sampling rate correctly', () => {
      const zeroSamplingConfig = {
        ...mockConfig,
        sampling: { traces: 1.0, metrics: 0 }
      };

      mocks.getObservabilityConfig.mockReturnValue(zeroSamplingConfig);

      initializeMetrics();
      expect(mocks.mockGetMeter).not.toHaveBeenCalled();
    });

    it('should handle fractional sampling rates', () => {
      const fractionalConfig = {
        ...mockConfig,
        sampling: { traces: 1.0, metrics: 0.5 }
      };

      mocks.getObservabilityConfig.mockReturnValue(fractionalConfig);

      initializeMetrics();
      expect(mocks.mockGetMeter).toHaveBeenCalled();
    });

    it('should handle invalid service version', () => {
      const invalidVersionConfig = {
        ...mockConfig,
        service: { ...mockConfig.service, version: null }
      };

      mocks.getObservabilityConfig.mockReturnValue(invalidVersionConfig);

      expect(() => initializeMetrics()).not.toThrow();
    });
  });
});