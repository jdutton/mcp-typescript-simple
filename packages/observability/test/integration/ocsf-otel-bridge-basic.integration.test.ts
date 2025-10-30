/**
 * Basic integration tests for OCSF-OTEL Bridge
 *
 * These tests verify that the OCSF-OTEL bridge works with real OpenTelemetry
 * providers without errors. Detailed functionality is covered by unit tests.
 *
 * Focus: End-to-end setup validation, not detailed log inspection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LoggerProvider, ConsoleLogRecordExporter, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { logs } from '@opentelemetry/api-logs';
import { trace, context, type Tracer } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { OCSFOTELBridge, getOCSFOTELBridge, emitOCSFEvent } from '../../src/ocsf/ocsf-otel-bridge.js';
import { logonEvent, logoffEvent, createAPIEvent, SeverityId, StatusId } from '../../src/ocsf/index.js';

/**
 * Helper: Emit event within trace context
 */
function emitEventWithTraceContext(
  bridge: OCSFOTELBridge,
  span: ReturnType<Tracer['startSpan']>
): void {
  context.with(trace.setSpan(context.active(), span), () => {
    const event = logonEvent()
      .user({ name: 'testuser', uid: 'user-123' })
      .message('User logged in')
      .build();

    bridge.emitAuthenticationEvent(event);
  });
}

/**
 * Helper: Emit event with trace context disabled
 */
function emitEventWithoutTraceContext(
  bridge: OCSFOTELBridge,
  span: ReturnType<Tracer['startSpan']>
): void {
  context.with(trace.setSpan(context.active(), span), () => {
    const event = logonEvent()
      .user({ name: 'testuser', uid: 'user-123' })
      .build();

    bridge.emitEvent(event, { addTraceContext: false });
  });
}

describe('OCSF-OTEL Bridge Basic Integration', () => {
  let loggerProvider: LoggerProvider;
  let tracerProvider: NodeTracerProvider;
  let bridge: OCSFOTELBridge;
  let tracer: Tracer;
  let spanExporter: InMemorySpanExporter;

  beforeEach(() => {
    // Set up console log exporter (simple, no in-memory complexity)
    const logExporter = new ConsoleLogRecordExporter();
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'test-service',
      [ATTR_SERVICE_VERSION]: '1.0.0',
    });

    loggerProvider = new LoggerProvider({
      resource,
      processors: [new SimpleLogRecordProcessor(logExporter)],
    });
    logs.setGlobalLoggerProvider(loggerProvider);

    // Set up span exporter for trace correlation
    spanExporter = new InMemorySpanExporter();
    const tracerResource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'test-service',
    });

    tracerProvider = new NodeTracerProvider({
      resource: tracerResource,
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    tracerProvider.register();
    tracer = trace.getTracer('test-tracer', '1.0.0');

    // Create bridge instance
    bridge = new OCSFOTELBridge('test-service');
  });

  afterEach(async () => {
    // Clean up providers
    await loggerProvider.shutdown();
    await tracerProvider.shutdown();
    spanExporter.reset();
  });

  describe('Bridge Instantiation', () => {
    it('should create bridge instance with real OTEL setup', () => {
      expect(bridge).toBeDefined();
      expect(bridge).toBeInstanceOf(OCSFOTELBridge);
    });

    it('should emit authentication events without errors', () => {
      const event = logonEvent()
        .user({ name: 'testuser', uid: 'user-123' })
        .severity(SeverityId.Informational, 'Informational')
        .message('User logged in')
        .build();

      // Should not throw
      expect(() => bridge.emitAuthenticationEvent(event)).not.toThrow();
    });

    it('should emit API activity events without errors', () => {
      const event = createAPIEvent()
        .resource('user')
        .actor({ user: { name: 'testuser', uid: 'user-123' } })
        .api({ operation: 'createUser' })
        .severity(SeverityId.Informational, 'Informational')
        .message('User creation API called')
        .build();

      // Should not throw
      expect(() => bridge.emitAPIActivityEvent(event)).not.toThrow();
    });
  });

  describe('Multiple Event Emission', () => {
    it('should handle multiple sequential events without errors', () => {
      const event1 = logonEvent()
        .user({ name: 'user1', uid: 'user-1' })
        .message('User 1 logged in')
        .build();

      const event2 = logonEvent()
        .user({ name: 'user2', uid: 'user-2' })
        .message('User 2 logged in')
        .build();

      const event3 = logoffEvent()
        .user({ name: 'user1', uid: 'user-1' })
        .message('User 1 logged out')
        .build();

      // Should not throw
      expect(() => {
        bridge.emitAuthenticationEvent(event1);
        bridge.emitAuthenticationEvent(event2);
        bridge.emitAuthenticationEvent(event3);
      }).not.toThrow();
    });

    it('should handle mixed event types without errors', () => {
      const authEvent = logonEvent()
        .user({ name: 'testuser', uid: 'user-123' })
        .message('User logged in')
        .build();

      const apiEvent = createAPIEvent()
        .resource('user')
        .actor({ user: { name: 'testuser', uid: 'user-123' } })
        .api({ operation: 'createUser' })
        .message('User creation API called')
        .build();

      // Should not throw
      expect(() => {
        bridge.emitAuthenticationEvent(authEvent);
        bridge.emitAPIActivityEvent(apiEvent);
      }).not.toThrow();
    });
  });

  describe('Trace Correlation', () => {
    /**
     * Helper: Emit event within trace context
     */
    function emitEventWithTraceContext(span: ReturnType<Tracer['startSpan']>): void {
      context.with(trace.setSpan(context.active(), span), () => {
        const event = logonEvent()
          .user({ name: 'testuser', uid: 'user-123' })
          .message('User logged in')
          .build();

        bridge.emitAuthenticationEvent(event);
      });
    }

    /**
     * Helper: Emit event with trace context disabled
     */
    function emitEventWithoutTraceContext(span: ReturnType<Tracer['startSpan']>): void {
      context.with(trace.setSpan(context.active(), span), () => {
        const event = logonEvent()
          .user({ name: 'testuser', uid: 'user-123' })
          .build();

        bridge.emitEvent(event, { addTraceContext: false });
      });
    }

    it('should emit events within active span context without errors', () => {
      const span = tracer.startSpan('test-operation');

      // Should not throw
      expect(() => emitEventWithTraceContext(span)).not.toThrow();

      span.end();
    });

    it('should emit events with trace context disabled without errors', () => {
      const span = tracer.startSpan('test-operation');

      // Should not throw
      expect(() => emitEventWithoutTraceContext(span)).not.toThrow();

      span.end();
    });
  });

  describe('Event Builder Integration', () => {
    it('should work with all authentication builder features', () => {
      const event = logonEvent()
        .user({ name: 'testuser', uid: 'user-123', email_addr: 'test@example.com' })
        .actor({
          user: { name: 'admin', uid: 'admin-456' },
          session: { uid: 'session-789', issuer: 'auth-server' },
        })
        .srcEndpoint({ ip: '192.168.1.100', port: 54321 })
        .dstEndpoint({ ip: '10.0.0.1', port: 443 })
        .cloud({ provider: 'Vercel', region: 'us-east-1' })
        .device({ name: 'MacBook Pro', type: 'Laptop' })
        .status(StatusId.Success, '200', 'Login successful')
        .severity(SeverityId.Informational, 'Informational')
        .message('User logged in')
        .duration(250)
        .build();

      // Should not throw
      expect(() => bridge.emitAuthenticationEvent(event)).not.toThrow();
    });

    it('should work with all API activity builder features', () => {
      const event = createAPIEvent()
        .resource('user')
        .actor({ user: { name: 'testuser', uid: 'user-123' } })
        .api({ operation: 'createUser', version: 'v1' })
        .cloud({ provider: 'Vercel', region: 'us-east-1' })
        .status(StatusId.Success, '201', 'User created')
        .severity(SeverityId.Informational, 'Informational')
        .message('User creation API called')
        .duration(150)
        .build();

      // Should not throw
      expect(() => bridge.emitAPIActivityEvent(event)).not.toThrow();
    });
  });

  describe('Singleton Pattern', () => {
    it('should support singleton bridge access', () => {
      const bridge1 = getOCSFOTELBridge('test-service');
      const bridge2 = getOCSFOTELBridge('test-service');

      expect(bridge1).toBe(bridge2);

      const event = logonEvent()
        .user({ name: 'testuser', uid: 'user-123' })
        .build();

      // Should not throw
      expect(() => emitOCSFEvent(event)).not.toThrow();
    });
  });
});
