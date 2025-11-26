/**
 * Unit tests for OCSF Authentication Event Builder
 */

/* eslint-disable sonarjs/no-hardcoded-ip */
// Test files use hardcoded IPs for test data

import { describe, it, expect } from 'vitest';
import {
  logonEvent,
  logoffEvent,
  authenticationEvent,
  AuthenticationActivityId,
  AuthProtocolId,
  LogonTypeId,
  SeverityId,
  StatusId,
} from '../../../src/ocsf/index.js';

describe('AuthenticationEventBuilder', () => {
  describe('logonEvent()', () => {
    it('should create a basic logon event', () => {
      const event = logonEvent()
        .user({ name: 'testuser', uid: 'user-123' })
        .build();

      expect(event.class_uid).toBe(3002);
      expect(event.class_name).toBe('Authentication');
      expect(event.category_uid).toBe(3);
      expect(event.category_name).toBe('Identity & Access Management');
      expect(event.activity_id).toBe(AuthenticationActivityId.Logon);
      expect(event.activity_name).toBe('Logon');
      expect(event.severity_id).toBe(SeverityId.Informational);
      expect(event.user?.name).toBe('testuser');
      expect(event.user?.uid).toBe('user-123');
      expect(event.metadata.version).toBe('1.3.0');
    });

    it('should set OAuth protocol information', () => {
      const event = logonEvent()
        .user({ name: 'testuser', uid: 'user-123', email_addr: 'test@example.com' })
        .authProtocol(AuthProtocolId.OAuth2)
        .logonType(LogonTypeId.Network)
        .session({ uid: 'session-456', created_time: Date.now() })
        .build();

      expect(event.auth_protocol_id).toBe(AuthProtocolId.OAuth2);
      expect(event.logon_type_id).toBe(LogonTypeId.Network);
      expect(event.session?.uid).toBe('session-456');
      expect(event.user?.email_addr).toBe('test@example.com');
    });

    it('should set MFA and remote flags', () => {
      const event = logonEvent()
        .user({ name: 'testuser' })
        .isMfa(true)
        .isRemote(true)
        .build();

      expect(event.is_mfa).toBe(true);
      expect(event.is_remote).toBe(true);
    });

    it('should set severity and status', () => {
      const event = logonEvent()
        .user({ name: 'testuser' })
        .severity(SeverityId.High, 'High')
        .status(StatusId.Failure, '401', 'Invalid credentials')
        .build();

      expect(event.severity_id).toBe(SeverityId.High);
      expect(event.severity).toBe('High');
      expect(event.status_id).toBe(StatusId.Failure);
      expect(event.status_code).toBe('401');
      expect(event.status_detail).toBe('Invalid credentials');
    });

    it('should set message and failure reason', () => {
      const event = logonEvent()
        .user({ name: 'testuser' })
        .message('User authentication failed')
        .failureReason('Invalid password')
        .build();

      expect(event.message).toBe('User authentication failed');
      expect(event.failure_reason).toBe('Invalid password');
    });

    it('should add network endpoints', () => {
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

      expect(event.src_endpoint?.ip).toBe('192.168.1.100');
      expect(event.src_endpoint?.port).toBe(54321);
      expect(event.dst_endpoint?.ip).toBe('10.0.0.1');
      expect(event.dst_endpoint?.port).toBe(443);
    });

    it('should add cloud context', () => {
      const event = logonEvent()
        .user({ name: 'testuser' })
        .cloud({
          provider: 'Vercel',
          region: 'us-east-1',
          account: { name: 'production', uid: 'acct-123' },
        })
        .build();

      expect(event.cloud?.provider).toBe('Vercel');
      expect(event.cloud?.region).toBe('us-east-1');
      expect(event.cloud?.account?.name).toBe('production');
    });

    it('should add device information', () => {
      const event = logonEvent()
        .user({ name: 'testuser' })
        .device({
          name: 'MacBook Pro',
          type: 'Laptop',
          hostname: 'mbp-dev',
          os: { name: 'macOS', version: '14.1' },
        })
        .build();

      expect(event.device?.name).toBe('MacBook Pro');
      expect(event.device?.os?.name).toBe('macOS');
    });

    it('should add HTTP request details', () => {
      const event = logonEvent()
        .user({ name: 'testuser' })
        .httpRequest({
          method: 'POST',
          url: {
            url_string: 'https://api.example.com/oauth/token',
            hostname: 'api.example.com',
            path: '/oauth/token',
            scheme: 'https',
          },
          user_agent: 'Mozilla/5.0',
        })
        .build();

      expect(event.http_request?.method).toBe('POST');
      expect(event.http_request?.url?.path).toBe('/oauth/token');
      expect(event.http_request?.user_agent).toBe('Mozilla/5.0');
    });

    it('should add API details', () => {
      const event = logonEvent()
        .user({ name: 'testuser' })
        .api({
          operation: 'authenticate',
          service: { name: 'auth-service', version: '1.0' },
          response: { code: 200, message: 'Success' },
        })
        .build();

      expect(event.api?.operation).toBe('authenticate');
      expect(event.api?.service?.name).toBe('auth-service');
      expect(event.api?.response?.code).toBe(200);
    });

    it('should add metadata', () => {
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
          labels: ['production', 'oauth'],
        })
        .build();

      expect(event.metadata.uid).toBe('event-123');
      expect(event.metadata.correlation_uid).toBe('trace-456');
      expect(event.metadata.product?.name).toBe('MCP Server');
      expect(event.metadata.labels).toEqual(['production', 'oauth']);
    });

    it('should set duration and time range', () => {
      const startTime = Date.now();
      const endTime = startTime + 5000;

      const event = logonEvent()
        .user({ name: 'testuser' })
        .timeRange(startTime, endTime)
        .build();

      expect(event.start_time).toBe(startTime);
      expect(event.end_time).toBe(endTime);
      expect(event.duration).toBe(5000);
    });

    it('should add unmapped custom attributes', () => {
      const event = logonEvent()
        .user({ name: 'testuser' })
        .unmapped({
          custom_field: 'custom_value',
          custom_number: 42,
        })
        .build();

      expect(event.unmapped?.custom_field).toBe('custom_value');
      expect(event.unmapped?.custom_number).toBe(42);
    });

    it('should throw error if user is missing', () => {
      expect(() => {
        logonEvent().build();
      }).toThrow('User is required for Authentication event');
    });
  });

  describe('logoffEvent()', () => {
    it('should create a basic logoff event', () => {
      const event = logoffEvent()
        .user({ name: 'testuser', uid: 'user-123' })
        .build();

      expect(event.activity_id).toBe(AuthenticationActivityId.Logoff);
      expect(event.activity_name).toBe('Logoff');
      expect(event.user?.name).toBe('testuser');
    });
  });

  describe('authenticationEvent()', () => {
    it('should create event with custom activity ID', () => {
      const event = authenticationEvent(AuthenticationActivityId.AuthenticationTicket)
        .user({ name: 'testuser' })
        .build();

      expect(event.activity_id).toBe(AuthenticationActivityId.AuthenticationTicket);
      expect(event.activity_name).toBe('Authentication Ticket');
    });
  });

  describe('type_uid calculation', () => {
    it('should calculate correct type_uid for Logon', () => {
      const event = logonEvent()
        .user({ name: 'testuser' })
        .build();

      // type_uid = class_uid * 100 + activity_id = 3002 * 100 + 1 = 300201
      expect(event.type_uid).toBe(300201);
    });

    it('should calculate correct type_uid for Logoff', () => {
      const event = logoffEvent()
        .user({ name: 'testuser' })
        .build();

      // type_uid = class_uid * 100 + activity_id = 3002 * 100 + 2 = 300202
      expect(event.type_uid).toBe(300202);
    });
  });

  describe('fluent API chaining', () => {
    it('should allow full fluent API chaining', () => {
      const event = logonEvent()
        .user({ name: 'testuser', uid: 'user-123', email_addr: 'test@example.com' })
        .severity(SeverityId.Informational, 'Informational')
        .status(StatusId.Success, '200', 'Login successful')
        .message('User logged in successfully')
        .session({ uid: 'session-456' })
        .authProtocol(AuthProtocolId.OAuth2)
        .logonType(LogonTypeId.Network)
        .isMfa(true)
        .isRemote(true)
        .srcEndpoint({ ip: '192.168.1.100' })
        .dstEndpoint({ ip: '10.0.0.1', port: 443 })
        .cloud({ provider: 'Vercel', region: 'us-east-1' })
        .device({ name: 'MacBook Pro', type: 'Laptop' })
        .withMetadata({ uid: 'event-123' })
        .unmapped({ custom: 'value' })
        .build();

      expect(event.user?.name).toBe('testuser');
      expect(event.severity_id).toBe(SeverityId.Informational);
      expect(event.status_id).toBe(StatusId.Success);
      expect(event.is_mfa).toBe(true);
      expect(event.cloud?.provider).toBe('Vercel');
      expect(event.unmapped?.custom).toBe('value');
    });
  });
});
