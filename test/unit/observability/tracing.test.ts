/**
 * Tests for distributed tracing utilities
 */

// Mock OpenTelemetry API
const mockSpan = {
  setAttributes: jest.fn(),
  setStatus: jest.fn(),
  recordException: jest.fn(),
  end: jest.fn(),
  spanContext: jest.fn(() => ({
    traceId: 'test-trace-id',
    spanId: 'test-span-id'
  }))
};

const mockTracer = {
  startActiveSpan: jest.fn()
};

const mockGetTracer = jest.fn(() => mockTracer);
const mockGetActiveSpan = jest.fn();

jest.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: mockGetTracer,
    getActiveSpan: mockGetActiveSpan
  },
  SpanStatusCode: {
    OK: 1,
    ERROR: 2
  }
}));

// Mock session correlation
jest.mock('../../../src/observability/session-correlation.js', () => ({
  addSessionToSpan: jest.fn()
}));

// Mock config
jest.mock('../../../src/observability/config.js', () => ({
  getObservabilityConfig: jest.fn()
}));

import {
  createMCPSpan,
  createToolSpan,
  createLLMSpan,
  createOAuthSpan,
  createTransportSpan,
  getCurrentTraceId,
  getCurrentSpanId,
  addAttributesToCurrentSpan,
  recordExceptionInCurrentSpan
} from '../../../src/observability/tracing.js';
import { addSessionToSpan } from '../../../src/observability/session-correlation.js';
import { getObservabilityConfig } from '../../../src/observability/config.js';

describe('Distributed Tracing', () => {
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

  const mockSessionContext = {
    sessionId: 'session-123',
    createdAt: Date.now(),
    lastActivity: Date.now(),
    authenticated: true
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getObservabilityConfig as jest.Mock).mockReturnValue(mockConfig);

    mockTracer.startActiveSpan.mockImplementation((_name, callback) => {
      return callback(mockSpan);
    });

    mockGetActiveSpan.mockReturnValue(mockSpan);
  });

  describe('createMCPSpan', () => {
    it('should bypass tracing when disabled', async () => {
      const disabledConfig = { ...mockConfig, enabled: false };
      (getObservabilityConfig as jest.Mock).mockReturnValue(disabledConfig);

      const operation = jest.fn().mockResolvedValue('result');
      const result = await createMCPSpan('test-span', operation);

      expect(result).toBe('result');
      expect(operation).toHaveBeenCalled();
      expect(mockGetTracer).not.toHaveBeenCalled();
    });

    it('should create span for successful operation', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      const result = await createMCPSpan('test-operation', operation);

      expect(result).toBe('success');
      expect(mockGetTracer).toHaveBeenCalledWith('mcp-server', '1.0.0');
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith('test-operation', expect.any(Function));
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'mcp.component': 'server'
      });
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // OK
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should add session context when provided', async () => {
      const operation = jest.fn().mockResolvedValue('ok');
      await createMCPSpan('with-session', operation, mockSessionContext);

      expect(addSessionToSpan).toHaveBeenCalledWith(mockSessionContext);
    });

    it('should add custom attributes', async () => {
      const operation = jest.fn().mockResolvedValue('ok');
      const attributes = {
        'custom.attr1': 'value1',
        'custom.attr2': 42,
        'custom.attr3': true
      };

      await createMCPSpan('with-attributes', operation, undefined, attributes);

      expect(mockSpan.setAttributes).toHaveBeenCalledWith(attributes);
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'mcp.component': 'server'
      });
    });

    it('should handle synchronous operations', async () => {
      const operation = jest.fn().mockReturnValue('sync-result');
      const result = await createMCPSpan('sync-op', operation);

      expect(result).toBe('sync-result');
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // OK
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should handle and rethrow errors', async () => {
      const error = new Error('Test error');
      const operation = jest.fn().mockRejectedValue(error);

      await expect(createMCPSpan('failing-op', operation)).rejects.toThrow('Test error');

      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: 2, // ERROR
        message: 'Test error'
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should handle non-Error exceptions', async () => {
      const operation = jest.fn().mockRejectedValue('string error');

      await expect(createMCPSpan('string-error', operation)).rejects.toBe('string error');

      expect(mockSpan.recordException).toHaveBeenCalledWith('string error');
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: 2, // ERROR
        message: 'Unknown error'
      });
    });
  });

  describe('createToolSpan', () => {
    it('should create span with tool-specific attributes', async () => {
      const operation = jest.fn().mockResolvedValue('tool-result');
      const parameters = { param1: 'value1', param2: 'value2' };

      const result = await createToolSpan('hello', operation, mockSessionContext, parameters);

      expect(result).toBe('tool-result');
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith('tool.hello', expect.any(Function));
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'mcp.tool.name': 'hello',
        'mcp.operation': 'tool_invocation',
        'mcp.tool.parameters_count': 2
      });
      expect(addSessionToSpan).toHaveBeenCalledWith(mockSessionContext);
    });

    it('should handle tools without parameters', async () => {
      const operation = jest.fn().mockResolvedValue('no-params');
      await createToolSpan('current-time', operation);

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'mcp.tool.name': 'current-time',
        'mcp.operation': 'tool_invocation',
        'mcp.tool.parameters_count': 0
      });
    });
  });

  describe('createLLMSpan', () => {
    it('should create span with LLM-specific attributes', async () => {
      const operation = jest.fn().mockResolvedValue('llm-response');
      const result = await createLLMSpan('claude', 'claude-3-haiku', operation, mockSessionContext);

      expect(result).toBe('llm-response');
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'llm.claude.claude-3-haiku',
        expect.any(Function)
      );
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'mcp.llm.provider': 'claude',
        'mcp.llm.model': 'claude-3-haiku',
        'mcp.operation': 'llm_request'
      });
      expect(addSessionToSpan).toHaveBeenCalledWith(mockSessionContext);
    });

    it('should work with different providers', async () => {
      const operation = jest.fn().mockResolvedValue('ok');

      await createLLMSpan('openai', 'gpt-4', operation);
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith('llm.openai.gpt-4', expect.any(Function));

      jest.clearAllMocks();

      await createLLMSpan('gemini', 'gemini-2.5-flash-lite', operation);
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith('llm.gemini.gemini-2.5-flash-lite', expect.any(Function));
    });
  });

  describe('createOAuthSpan', () => {
    it('should create span with OAuth-specific attributes', async () => {
      const callback = jest.fn().mockResolvedValue('auth-result');
      const result = await createOAuthSpan('google', 'login', callback, mockSessionContext);

      expect(result).toBe('auth-result');
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'oauth.google.login',
        expect.any(Function)
      );
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'mcp.oauth.provider': 'google',
        'mcp.oauth.operation': 'login',
        'mcp.operation': 'oauth'
      });
    });

    it('should handle different OAuth operations', async () => {
      const callback = jest.fn().mockResolvedValue('ok');

      await createOAuthSpan('github', 'callback', callback);
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith('oauth.github.callback', expect.any(Function));

      jest.clearAllMocks();

      await createOAuthSpan('microsoft', 'refresh', callback);
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith('oauth.microsoft.refresh', expect.any(Function));
    });
  });

  describe('createTransportSpan', () => {
    it('should create span with transport-specific attributes', async () => {
      const callback = jest.fn().mockResolvedValue('transport-result');
      const result = await createTransportSpan('stdio', 'read', callback, mockSessionContext);

      expect(result).toBe('transport-result');
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'transport.stdio.read',
        expect.any(Function)
      );
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'mcp.transport': 'stdio',
        'mcp.transport.operation': 'read',
        'mcp.operation': 'transport'
      });
    });

    it('should handle HTTP transport operations', async () => {
      const callback = jest.fn().mockResolvedValue('http-result');
      await createTransportSpan('http', 'stream', callback);

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'transport.http.stream',
        expect.any(Function)
      );
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'mcp.transport': 'http',
        'mcp.transport.operation': 'stream',
        'mcp.operation': 'transport'
      });
    });
  });

  describe('Trace Context Utilities', () => {
    describe('getCurrentTraceId', () => {
      it('should return trace ID from active span', () => {
        const traceId = getCurrentTraceId();
        expect(traceId).toBe('test-trace-id');
        expect(mockGetActiveSpan).toHaveBeenCalled();
      });

      it('should return undefined when no active span', () => {
        mockGetActiveSpan.mockReturnValueOnce(undefined);
        const traceId = getCurrentTraceId();
        expect(traceId).toBeUndefined();
      });
    });

    describe('getCurrentSpanId', () => {
      it('should return span ID from active span', () => {
        const spanId = getCurrentSpanId();
        expect(spanId).toBe('test-span-id');
        expect(mockGetActiveSpan).toHaveBeenCalled();
      });

      it('should return undefined when no active span', () => {
        mockGetActiveSpan.mockReturnValueOnce(undefined);
        const spanId = getCurrentSpanId();
        expect(spanId).toBeUndefined();
      });
    });

    describe('addAttributesToCurrentSpan', () => {
      it('should add attributes to active span', () => {
        const attributes = {
          'custom.key1': 'value1',
          'custom.key2': 123,
          'custom.key3': false
        };

        addAttributesToCurrentSpan(attributes);

        expect(mockGetActiveSpan).toHaveBeenCalled();
        expect(mockSpan.setAttributes).toHaveBeenCalledWith(attributes);
      });

      it('should do nothing when no active span', () => {
        mockGetActiveSpan.mockReturnValueOnce(undefined);

        addAttributesToCurrentSpan({ key: 'value' });

        expect(mockSpan.setAttributes).not.toHaveBeenCalled();
      });
    });

    describe('recordExceptionInCurrentSpan', () => {
      it('should record exception in active span', () => {
        const error = new Error('Test exception');

        recordExceptionInCurrentSpan(error);

        expect(mockGetActiveSpan).toHaveBeenCalled();
        expect(mockSpan.recordException).toHaveBeenCalledWith(error);
        expect(mockSpan.setStatus).toHaveBeenCalledWith({
          code: 2, // ERROR
          message: 'Test exception'
        });
      });

      it('should do nothing when no active span', () => {
        mockGetActiveSpan.mockReturnValueOnce(undefined);

        recordExceptionInCurrentSpan(new Error('No span'));

        expect(mockSpan.recordException).not.toHaveBeenCalled();
        expect(mockSpan.setStatus).not.toHaveBeenCalled();
      });
    });
  });
});