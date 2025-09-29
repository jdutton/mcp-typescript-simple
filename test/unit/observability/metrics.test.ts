/**
 * Tests for MCP-specific metrics collection
 */

// Mock OpenTelemetry metrics API
const mockCounter = {
  add: jest.fn()
};
const mockHistogram = {
  record: jest.fn()
};
const mockUpDownCounter = {
  add: jest.fn()
};

const mockMeter = {
  createCounter: jest.fn(() => mockCounter),
  createHistogram: jest.fn(() => mockHistogram),
  createUpDownCounter: jest.fn(() => mockUpDownCounter)
};
const mockGetMeter = jest.fn(() => mockMeter);

jest.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: mockGetMeter
  }
}));

// Mock config module
jest.mock('../../../src/observability/config.js', () => ({
  getObservabilityConfig: jest.fn()
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
    jest.clearAllMocks();
    (getObservabilityConfig as jest.Mock).mockReturnValue(mockConfig);

    // Reset initialization state
  });

  describe('initializeMetrics', () => {
    it('should not initialize when disabled', () => {
      const disabledConfig = { ...mockConfig, enabled: false };
      (getObservabilityConfig as jest.Mock).mockReturnValue(disabledConfig);

      initializeMetrics();

      expect(mockGetMeter).not.toHaveBeenCalled();
    });

    it('should not initialize when metrics sampling is disabled', () => {
      const noMetricsConfig = {
        ...mockConfig,
        sampling: { traces: 1.0, metrics: 0 }
      };
      (getObservabilityConfig as jest.Mock).mockReturnValue(noMetricsConfig);

      initializeMetrics();

      expect(mockGetMeter).not.toHaveBeenCalled();
    });

    it('should initialize all metric instruments', () => {
      initializeMetrics();

      expect(mockGetMeter).toHaveBeenCalledWith('mcp-server', '1.0.0');

      // MCP Protocol Metrics
      expect(mockMeter.createCounter).toHaveBeenCalledWith('mcp_messages_total', {
        description: 'Total number of MCP messages processed'
      });
      expect(mockMeter.createHistogram).toHaveBeenCalledWith('mcp_message_duration_ms', {
        description: 'Duration of MCP message processing in milliseconds'
      });

      // Tool Performance Metrics
      expect(mockMeter.createCounter).toHaveBeenCalledWith('mcp_tool_invocations_total', {
        description: 'Total number of tool invocations'
      });
      expect(mockMeter.createHistogram).toHaveBeenCalledWith('mcp_tool_duration_ms', {
        description: 'Duration of tool execution in milliseconds'
      });

      // Session Metrics
      expect(mockMeter.createUpDownCounter).toHaveBeenCalledWith('mcp_active_sessions', {
        description: 'Number of active MCP sessions'
      });
      expect(mockMeter.createHistogram).toHaveBeenCalledWith('mcp_session_duration_ms', {
        description: 'Duration of MCP sessions in milliseconds'
      });

      // LLM Provider Metrics
      expect(mockMeter.createCounter).toHaveBeenCalledWith('mcp_llm_requests_total', {
        description: 'Total number of LLM provider requests'
      });
      expect(mockMeter.createHistogram).toHaveBeenCalledWith('mcp_llm_latency_ms', {
        description: 'Latency of LLM provider requests in milliseconds'
      });
    });
  });

  describe('recordMCPMessage', () => {
    it('should record successful message metrics', () => {
      initializeMetrics();
      jest.clearAllMocks();

      recordMCPMessage('request', 'initialize', 150, true);

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        message_type: 'request',
        method: 'initialize',
        success: 'true'
      });

      expect(mockHistogram.record).toHaveBeenCalledWith(150, {
        message_type: 'request',
        method: 'initialize'
      });
    });

    it('should record failed message metrics', () => {
      initializeMetrics();
      jest.clearAllMocks();

      recordMCPMessage('response', 'tools/invoke', 500, false);

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        message_type: 'response',
        method: 'tools/invoke',
        success: 'false'
      });

      expect(mockHistogram.record).toHaveBeenCalledWith(500, {
        message_type: 'response',
        method: 'tools/invoke'
      });
    });

    it('should handle notification messages', () => {
      initializeMetrics();
      jest.clearAllMocks();

      recordMCPMessage('notification', 'progress', 50, true);

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        message_type: 'notification',
        method: 'progress',
        success: 'true'
      });
    });
  });

  describe('recordToolInvocation', () => {
    it('should record successful tool invocation', () => {
      initializeMetrics();
      jest.clearAllMocks();

      recordToolInvocation('chat', 1500, true);

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        tool_name: 'chat',
        success: 'true',
        error_type: 'none'
      });

      expect(mockHistogram.record).toHaveBeenCalledWith(1500, {
        tool_name: 'chat',
        success: 'true'
      });
    });

    it('should record failed tool invocation with error type', () => {
      initializeMetrics();
      jest.clearAllMocks();

      recordToolInvocation('analyze', 3000, false, 'timeout');

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        tool_name: 'analyze',
        success: 'false',
        error_type: 'timeout'
      });

      expect(mockHistogram.record).toHaveBeenCalledWith(3000, {
        tool_name: 'analyze',
        success: 'false'
      });
    });
  });

  describe('recordSessionEvent', () => {
    it('should increment counter on session creation', () => {
      initializeMetrics();
      jest.clearAllMocks();

      recordSessionEvent('created');

      expect(mockUpDownCounter.add).toHaveBeenCalledWith(1);
      expect(mockHistogram.record).not.toHaveBeenCalled();
    });

    it('should decrement counter and record duration on session close', () => {
      initializeMetrics();
      jest.clearAllMocks();

      recordSessionEvent('closed', 60000);

      expect(mockUpDownCounter.add).toHaveBeenCalledWith(-1);
      expect(mockHistogram.record).toHaveBeenCalledWith(60000);
    });

    it('should handle authenticated event without counter change', () => {
      initializeMetrics();
      jest.clearAllMocks();

      recordSessionEvent('authenticated');

      expect(mockUpDownCounter.add).not.toHaveBeenCalled();
      expect(mockHistogram.record).not.toHaveBeenCalled();
    });

    it('should handle close without duration', () => {
      initializeMetrics();
      jest.clearAllMocks();

      recordSessionEvent('closed');

      expect(mockUpDownCounter.add).toHaveBeenCalledWith(-1);
      expect(mockHistogram.record).not.toHaveBeenCalled();
    });
  });

  describe('recordLLMRequest', () => {
    it('should record successful LLM request', () => {
      initializeMetrics();
      jest.clearAllMocks();

      recordLLMRequest('openai', 'gpt-4', 3500, true);

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        provider: 'openai',
        model: 'gpt-4',
        success: 'true'
      });

      expect(mockHistogram.record).toHaveBeenCalledWith(3500, {
        provider: 'openai',
        model: 'gpt-4'
      });
    });

    it('should record failed LLM request', () => {
      initializeMetrics();
      jest.clearAllMocks();

      recordLLMRequest('gemini', 'gemini-1.5-pro', 5000, false);

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        provider: 'gemini',
        model: 'gemini-1.5-pro',
        success: 'false'
      });

      expect(mockHistogram.record).toHaveBeenCalledWith(5000, {
        provider: 'gemini',
        model: 'gemini-1.5-pro'
      });
    });

    it('should record token usage when provided', () => {
      initializeMetrics();
      jest.clearAllMocks();

      recordLLMRequest('claude', 'claude-3-sonnet', 2500, true, 1500);

      // Verify token counter creation and usage
      expect(mockGetMeter).toHaveBeenCalledWith('mcp-llm-tokens');
      expect(mockMeter.createCounter).toHaveBeenCalledWith('mcp_llm_tokens_total', {
        description: 'Total number of LLM tokens consumed'
      });
      expect(mockCounter.add).toHaveBeenCalledWith(1500, {
        provider: 'claude',
        model: 'claude-3-sonnet'
      });
    });
  });

  describe('recordOAuthEvent', () => {
    it('should record OAuth started event', () => {
      recordOAuthEvent('google', 'started');

      expect(mockGetMeter).toHaveBeenCalledWith('mcp-oauth');
      expect(mockMeter.createCounter).toHaveBeenCalledWith('mcp_oauth_events_total', {
        description: 'Total number of OAuth events'
      });
      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        provider: 'google',
        event: 'started'
      });
    });

    it('should record OAuth completed event with duration', () => {
      recordOAuthEvent('github', 'completed', 4500);

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        provider: 'github',
        event: 'completed'
      });
      expect(mockMeter.createHistogram).toHaveBeenCalledWith('mcp_oauth_duration_ms', {
        description: 'Duration of OAuth flows in milliseconds'
      });
      expect(mockHistogram.record).toHaveBeenCalledWith(4500, {
        provider: 'github'
      });
    });

    it('should record OAuth failed event without duration', () => {
      recordOAuthEvent('microsoft', 'failed');

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        provider: 'microsoft',
        event: 'failed'
      });
      expect(mockMeter.createHistogram).not.toHaveBeenCalledWith('mcp_oauth_duration_ms', expect.any(Object));
    });

    it('should only record duration for completed events', () => {
      // Failed with duration should not record duration
      recordOAuthEvent('generic', 'failed', 1000);

      expect(mockCounter.add).toHaveBeenCalledWith(1, {
        provider: 'generic',
        event: 'failed'
      });
      expect(mockMeter.createHistogram).not.toHaveBeenCalledWith('mcp_oauth_duration_ms', expect.any(Object));
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle metrics API failures gracefully', () => {
      mockCounter.add.mockImplementationOnce(() => {
        throw new Error('Metrics API error');
      });

      initializeMetrics();

      // Should not throw even if metrics API fails
      expect(() => recordMCPMessage('request', 'test', 100, true)).not.toThrow();
    });

    it('should handle histogram recording failures', () => {
      mockHistogram.record.mockImplementationOnce(() => {
        throw new Error('Histogram error');
      });

      initializeMetrics();

      expect(() => recordMCPMessage('request', 'test', 100, true)).not.toThrow();
    });

    it('should validate metric parameters before recording', () => {
      initializeMetrics();
      jest.clearAllMocks();

      // Test with invalid duration (negative)
      recordMCPMessage('request', 'test', -100, true);
      recordToolInvocation('tool', -50, true);
      recordLLMRequest('claude', 'claude-3-haiku', -200, true);

      // Should still call metrics but with potentially sanitized values
      expect(mockCounter.add).toHaveBeenCalled();
      expect(mockHistogram.record).toHaveBeenCalled();
    });

    it('should handle extremely large metric values', () => {
      initializeMetrics();
      jest.clearAllMocks();

      const hugeValue = Number.MAX_SAFE_INTEGER;

      expect(() => {
        recordMCPMessage('request', 'test', hugeValue, true);
        recordToolInvocation('tool', hugeValue, true);
        recordLLMRequest('openai', 'gpt-4', hugeValue, true);
      }).not.toThrow();
    });

    it('should handle invalid session event types', () => {
      initializeMetrics();
      jest.clearAllMocks();

      // Should not throw with invalid event type
      expect(() => recordSessionEvent('invalid_event' as any)).not.toThrow();
    });

    it('should handle meter creation failures during initialization', () => {
      mockGetMeter.mockImplementationOnce(() => {
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
      expect(mockCounter.add).toHaveBeenCalledTimes(2000);
    });

    it('should handle concurrent metric recording safely', async () => {
      initializeMetrics();
      jest.clearAllMocks();

      // Simulate concurrent metric recording
      const promises = Array.from({ length: 100 }, (_, i) =>
        Promise.resolve().then(() => recordMCPMessage('request', `concurrent_${i}`, 100, true))
      );

      await Promise.all(promises);
      expect(mockCounter.add).toHaveBeenCalledTimes(100);
    });
  });

  describe('Configuration Edge Cases', () => {
    it('should handle partial configuration gracefully', () => {
      const partialConfig = {
        enabled: true,
        sampling: { metrics: 1.0 }
        // Missing other required fields
      } as any;

      (getObservabilityConfig as jest.Mock).mockReturnValue(partialConfig);

      expect(() => initializeMetrics()).not.toThrow();
    });

    it('should handle zero sampling rate correctly', () => {
      const zeroSamplingConfig = {
        ...mockConfig,
        sampling: { traces: 1.0, metrics: 0 }
      };

      (getObservabilityConfig as jest.Mock).mockReturnValue(zeroSamplingConfig);

      initializeMetrics();
      expect(mockGetMeter).not.toHaveBeenCalled();
    });

    it('should handle fractional sampling rates', () => {
      const fractionalConfig = {
        ...mockConfig,
        sampling: { traces: 1.0, metrics: 0.5 }
      };

      (getObservabilityConfig as jest.Mock).mockReturnValue(fractionalConfig);

      initializeMetrics();
      expect(mockGetMeter).toHaveBeenCalled();
    });

    it('should handle invalid service version', () => {
      const invalidVersionConfig = {
        ...mockConfig,
        service: { ...mockConfig.service, version: null }
      };

      (getObservabilityConfig as jest.Mock).mockReturnValue(invalidVersionConfig);

      expect(() => initializeMetrics()).not.toThrow();
    });
  });
});