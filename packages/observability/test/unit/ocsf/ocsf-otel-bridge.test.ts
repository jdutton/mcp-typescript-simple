/**
 * Unit tests for OCSF-OTEL Bridge
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OCSFOTELBridge, emitOCSFEvent } from '../../../src/ocsf/ocsf-otel-bridge.js';
import { logonEvent, createAPIEvent, SeverityId, StatusId } from '../../../src/ocsf/index.js';
import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import { trace, context, type Span } from '@opentelemetry/api';

describe('OCSFOTELBridge', () => {
  let bridge: OCSFOTELBridge;
  let mockLogger: any;
  let mockEmit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock OTEL logger
    mockEmit = vi.fn();
    mockLogger = {
      emit: mockEmit,
    };

    // Mock the logger provider to return our mock logger
    const mockLoggerProvider = {
      getLogger: vi.fn().mockReturnValue(mockLogger),
    };

    vi.spyOn(logs, 'getLoggerProvider').mockReturnValue(mockLoggerProvider as any);

    bridge = new OCSFOTELBridge('test-service');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('emitEvent()', () => {
    it('should emit a basic OCSF event as OTEL log', () => {
      const event = logonEvent()
        .user({ name: 'testuser', uid: 'user-123' })
        .severity(SeverityId.Informational, 'Informational')
        .message('User logged in')
        .build();

      bridge.emitEvent(event);

      expect(mockEmit).toHaveBeenCalledTimes(1);
      const call = mockEmit.mock.calls[0][0];

      expect(call.severityNumber).toBe(SeverityNumber.INFO);
      expect(call.severityText).toBe('Informational');
      expect(call.body).toBe('User logged in');
      expect(call.timestamp).toBe(event.time);
      expect(call.attributes['ocsf.class_uid']).toBe(3002);
      expect(call.attributes['ocsf.class_name']).toBe('Authentication');
      expect(call.attributes['ocsf.activity_name']).toBe('Logon');
    });

    it('should map OCSF severities to OTEL severities correctly', () => {
      const testCases = [
        { ocsf: SeverityId.Unknown, otel: SeverityNumber.UNSPECIFIED },
        { ocsf: SeverityId.Informational, otel: SeverityNumber.INFO },
        { ocsf: SeverityId.Low, otel: SeverityNumber.INFO2 },
        { ocsf: SeverityId.Medium, otel: SeverityNumber.WARN },
        { ocsf: SeverityId.High, otel: SeverityNumber.ERROR },
        { ocsf: SeverityId.Critical, otel: SeverityNumber.FATAL },
        { ocsf: SeverityId.Fatal, otel: SeverityNumber.FATAL4 },
        { ocsf: SeverityId.Other, otel: SeverityNumber.UNSPECIFIED },
      ];

      for (const { ocsf, otel } of testCases) {
        mockEmit.mockClear();

        const event = logonEvent()
          .user({ name: 'testuser' })
          .severity(ocsf)
          .build();

        bridge.emitEvent(event);

        const call = mockEmit.mock.calls[0][0];
        expect(call.severityNumber).toBe(otel);
      }
    });

    it('should include all OCSF base fields as attributes', () => {
      const event = logonEvent()
        .user({ name: 'testuser', uid: 'user-123', email_addr: 'test@example.com' })
        .status(StatusId.Success, '200', 'Login successful')
        .build();

      bridge.emitEvent(event);

      const call = mockEmit.mock.calls[0][0];
      const attrs = call.attributes;

      expect(attrs['ocsf.class_uid']).toBe(3002);
      expect(attrs['ocsf.class_name']).toBe('Authentication');
      expect(attrs['ocsf.category_uid']).toBe(3);
      expect(attrs['ocsf.category_name']).toBe('Identity & Access Management');
      expect(attrs['ocsf.activity_id']).toBe(1);
      expect(attrs['ocsf.activity_name']).toBe('Logon');
      expect(attrs['ocsf.type_uid']).toBe(300201);
      expect(attrs['ocsf.severity_id']).toBe(SeverityId.Informational);
      expect(attrs['ocsf.status_id']).toBe(StatusId.Success);
      expect(attrs['ocsf.status_code']).toBe('200');
      expect(attrs['ocsf.status_detail']).toBe('Login successful');
    });

    it('should include metadata fields as attributes', () => {
      const event = logonEvent()
        .user({ name: 'testuser' })
        .withMetadata({
          uid: 'event-123',
          correlation_uid: 'trace-456',
          product: {
            name: 'MCP Server',
            version: '1.0.0',
            vendor_name: 'Test Corp',
          },
        })
        .build();

      bridge.emitEvent(event);

      const call = mockEmit.mock.calls[0][0];
      const attrs = call.attributes;

      expect(attrs['ocsf.metadata.version']).toBe('1.3.0');
      expect(attrs['ocsf.metadata.uid']).toBe('event-123');
      expect(attrs['ocsf.metadata.correlation_uid']).toBe('trace-456');
      expect(attrs['ocsf.metadata.product.name']).toBe('MCP Server');
      expect(attrs['ocsf.metadata.product.version']).toBe('1.0.0');
      expect(attrs['ocsf.metadata.product.vendor_name']).toBe('Test Corp');
    });

    it('should include actor information as attributes', () => {
      const event = logonEvent()
        .user({ name: 'testuser', uid: 'user-123', email_addr: 'test@example.com' })
        .actor({
          user: {
            name: 'john.doe',
            uid: 'user-456',
            email_addr: 'john@example.com',
          },
          session: {
            uid: 'session-789',
            issuer: 'auth-server',
          },
        })
        .build();

      bridge.emitEvent(event);

      const call = mockEmit.mock.calls[0][0];
      const attrs = call.attributes;

      expect(attrs['ocsf.actor.user.name']).toBe('john.doe');
      expect(attrs['ocsf.actor.user.uid']).toBe('user-456');
      expect(attrs['ocsf.actor.user.email_addr']).toBe('john@example.com');
      expect(attrs['ocsf.actor.session.uid']).toBe('session-789');
      expect(attrs['ocsf.actor.session.issuer']).toBe('auth-server');
    });

    it('should include network endpoint information', () => {
      const event = logonEvent()
        .user({ name: 'testuser' })
        .srcEndpoint({
          ip: '192.168.1.100',
          port: 54321,
          hostname: 'client.local',
        })
        .dstEndpoint({
          ip: '10.0.0.1',
          port: 443,
          hostname: 'api.example.com',
        })
        .build();

      bridge.emitEvent(event);

      const call = mockEmit.mock.calls[0][0];
      const attrs = call.attributes;

      expect(attrs['ocsf.src_endpoint.ip']).toBe('192.168.1.100');
      expect(attrs['ocsf.src_endpoint.port']).toBe(54321);
      expect(attrs['ocsf.src_endpoint.hostname']).toBe('client.local');
      expect(attrs['ocsf.dst_endpoint.ip']).toBe('10.0.0.1');
      expect(attrs['ocsf.dst_endpoint.port']).toBe(443);
      expect(attrs['ocsf.dst_endpoint.hostname']).toBe('api.example.com');
    });

    it('should include cloud context', () => {
      const event = logonEvent()
        .user({ name: 'testuser' })
        .cloud({
          provider: 'Vercel',
          region: 'us-east-1',
        })
        .build();

      bridge.emitEvent(event);

      const call = mockEmit.mock.calls[0][0];
      const attrs = call.attributes;

      expect(attrs['ocsf.cloud.provider']).toBe('Vercel');
      expect(attrs['ocsf.cloud.region']).toBe('us-east-1');
    });

    it('should include device information', () => {
      const event = logonEvent()
        .user({ name: 'testuser' })
        .device({
          name: 'MacBook Pro',
          type: 'Laptop',
          hostname: 'mbp-dev',
        })
        .build();

      bridge.emitEvent(event);

      const call = mockEmit.mock.calls[0][0];
      const attrs = call.attributes;

      expect(attrs['ocsf.device.name']).toBe('MacBook Pro');
      expect(attrs['ocsf.device.type']).toBe('Laptop');
      expect(attrs['ocsf.device.hostname']).toBe('mbp-dev');
    });

    it('should include performance metrics', () => {
      const event = logonEvent()
        .user({ name: 'testuser' })
        .duration(250)
        .build();

      bridge.emitEvent(event);

      const call = mockEmit.mock.calls[0][0];
      const attrs = call.attributes;

      expect(attrs['ocsf.duration']).toBe(250);
    });

    it('should include full event as JSON for SIEM systems', () => {
      const event = logonEvent()
        .user({ name: 'testuser', uid: 'user-123' })
        .build();

      bridge.emitEvent(event);

      const call = mockEmit.mock.calls[0][0];
      const attrs = call.attributes;

      expect(attrs['ocsf.event']).toBeDefined();
      expect(typeof attrs['ocsf.event']).toBe('string');

      const parsedEvent = JSON.parse(attrs['ocsf.event'] as string);
      expect(parsedEvent.class_uid).toBe(3002);
      expect(parsedEvent.user.name).toBe('testuser');
    });

    it('should add trace context when available', () => {
      // Mock active span
      const mockSpan = {
        spanContext: vi.fn().mockReturnValue({
          traceId: 'trace-123',
          spanId: 'span-456',
          traceFlags: 1,
        }),
      } as unknown as Span;

      vi.spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan);

      const event = logonEvent()
        .user({ name: 'testuser' })
        .build();

      bridge.emitEvent(event);

      const call = mockEmit.mock.calls[0][0];
      const attrs = call.attributes;

      expect(attrs['trace_id']).toBe('trace-123');
      expect(attrs['span_id']).toBe('span-456');
      expect(attrs['trace_flags']).toBe(1);
    });

    it('should not add trace context when disabled', () => {
      const event = logonEvent()
        .user({ name: 'testuser' })
        .build();

      bridge.emitEvent(event, { addTraceContext: false });

      const call = mockEmit.mock.calls[0][0];
      const attrs = call.attributes;

      expect(attrs['trace_id']).toBeUndefined();
      expect(attrs['span_id']).toBeUndefined();
    });

    it('should use correlation_uid as trace_id when span not available', () => {
      // No active span
      vi.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined);

      const event = logonEvent()
        .user({ name: 'testuser' })
        .withMetadata({
          correlation_uid: 'existing-trace-789',
        })
        .build();

      bridge.emitEvent(event);

      const call = mockEmit.mock.calls[0][0];
      const attrs = call.attributes;

      // Should preserve existing correlation_uid
      expect(attrs['ocsf.metadata.correlation_uid']).toBe('existing-trace-789');
      // Should not add trace_id since no active span
      expect(attrs['trace_id']).toBeUndefined();
    });

    it('should use custom observed timestamp', () => {
      const customTimestamp = Date.now() - 1000;

      const event = logonEvent()
        .user({ name: 'testuser' })
        .build();

      bridge.emitEvent(event, { observedTimestamp: customTimestamp });

      const call = mockEmit.mock.calls[0][0];
      expect(call.observedTimestamp).toBe(customTimestamp);
    });

    it('should handle API Activity events', () => {
      const event = createAPIEvent()
        .resource('user')
        .actor({ user: { name: 'testuser', uid: 'user-123' } })
        .api({ operation: 'createUser' })
        .build();

      bridge.emitAPIActivityEvent(event);

      expect(mockEmit).toHaveBeenCalledTimes(1);
      const call = mockEmit.mock.calls[0][0];

      expect(call.attributes['ocsf.class_uid']).toBe(6003);
      expect(call.attributes['ocsf.class_name']).toBe('API Activity');
      expect(call.attributes['ocsf.activity_name']).toBe('Create');
    });
  });

  describe('helper methods', () => {
    it('should emit authentication event via helper', () => {
      const event = logonEvent()
        .user({ name: 'testuser' })
        .build();

      bridge.emitAuthenticationEvent(event);

      expect(mockEmit).toHaveBeenCalledTimes(1);
    });

    it('should emit API activity event via helper', () => {
      const event = createAPIEvent()
        .resource('item')
        .actor({ user: { name: 'testuser', uid: 'user-123' } })
        .api({ operation: 'testOp' })
        .build();

      bridge.emitAPIActivityEvent(event);

      expect(mockEmit).toHaveBeenCalledTimes(1);
    });
  });

  describe('emitOCSFEvent()', () => {
    it('should emit event using convenience function', () => {
      const event = logonEvent()
        .user({ name: 'testuser' })
        .build();

      emitOCSFEvent(event);

      expect(mockEmit).toHaveBeenCalledTimes(1);
    });
  });
});
