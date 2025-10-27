/**
 * Unit tests for OCSF API Activity Event Builder
 */

import { describe, it, expect } from 'vitest';
import {
  createAPIEvent,
  readAPIEvent,
  updateAPIEvent,
  deleteAPIEvent,
  apiActivityEvent,
  APIActivityId,
  SeverityId,
  StatusId,
} from '../../../src/ocsf/index.js';

// Helper to create default actor for tests
const testActor = () => ({ user: { name: 'testuser', uid: 'user-123' } });
const testAPI = () => ({ operation: 'testOp', service: { name: 'test-service' } });

describe('APIActivityEventBuilder', () => {
  describe('createAPIEvent()', () => {
    it('should create a basic Create API event', () => {
      const event = createAPIEvent()
        .resource('user')
        .actor(testActor())
        .api({ operation: 'createUser', service: { name: 'user-service' } })
        .build();

      expect(event.class_uid).toBe(6003);
      expect(event.class_name).toBe('API Activity');
      expect(event.category_uid).toBe(6);
      expect(event.category_name).toBe('Application Activity');
      expect(event.activity_id).toBe(APIActivityId.Create);
      expect(event.activity_name).toBe('Create');
      expect(event.severity_id).toBe(SeverityId.Informational);
      expect(event.resources).toEqual(['user']);
      expect(event.api?.operation).toBe('createUser');
      expect(event.metadata.version).toBe('1.3.0');
    });

    it('should set multiple resources', () => {
      const event = createAPIEvent()
        .resources(['post', 'comment'])
        .actor(testActor())
        .api({ operation: 'bulkCreate' })
        .build();

      // resources() replaces the array
      expect(event.resources).toEqual(['post', 'comment']);
    });

    it('should throw error if no actor', () => {
      expect(() => {
        createAPIEvent()
          .resource('user')
          .api({ operation: 'create' })
          .build();
      }).toThrow('Actor is required for API Activity event');
    });

    it('should throw error if no API details', () => {
      expect(() => {
        createAPIEvent()
          .resource('user')
          .actor(testActor())
          .build();
      }).toThrow('API details are required for API Activity event');
    });
  });

  describe('readAPIEvent()', () => {
    it('should create a basic Read API event', () => {
      const event = readAPIEvent()
        .resource('user')
        .actor(testActor())
        .api({ operation: 'getUser', service: { name: 'user-service' } })
        .build();

      expect(event.activity_id).toBe(APIActivityId.Read);
      expect(event.activity_name).toBe('Read');
      expect(event.resources).toEqual(['user']);
    });
  });

  describe('updateAPIEvent()', () => {
    it('should create a basic Update API event', () => {
      const event = updateAPIEvent()
        .resource('user')
        .actor(testActor())
        .api({ operation: 'updateUser', service: { name: 'user-service' } })
        .build();

      expect(event.activity_id).toBe(APIActivityId.Update);
      expect(event.activity_name).toBe('Update');
    });
  });

  describe('deleteAPIEvent()', () => {
    it('should create a basic Delete API event', () => {
      const event = deleteAPIEvent()
        .resource('user')
        .actor(testActor())
        .api({ operation: 'deleteUser', service: { name: 'user-service' } })
        .build();

      expect(event.activity_id).toBe(APIActivityId.Delete);
      expect(event.activity_name).toBe('Delete');
    });
  });

  describe('API details', () => {
    it('should set comprehensive API details', () => {
      const event = createAPIEvent()
        .resource('user')
        .actor(testActor())
        .api({
          operation: 'createUser',
          service: { name: 'user-service', version: '2.0' },
          version: 'v2',
          request: {
            uid: 'req-123',
            data: { name: 'John Doe', email: 'john@example.com' },
          },
          response: {
            code: 201,
            message: 'Created',
            data: { id: 'user-456' },
          },
        })
        .build();

      expect(event.api?.operation).toBe('createUser');
      expect(event.api?.service?.name).toBe('user-service');
      expect(event.api?.service?.version).toBe('2.0');
      expect(event.api?.version).toBe('v2');
      expect(event.api?.request?.uid).toBe('req-123');
      expect(event.api?.response?.code).toBe(201);
      expect(event.api?.response?.message).toBe('Created');
    });

    it('should set API error response', () => {
      const event = createAPIEvent()
        .resource('user')
        .actor(testActor())
        .api({
          operation: 'createUser',
          response: {
            code: 400,
            message: 'Bad Request',
            error: 'VALIDATION_ERROR',
            error_message: 'Invalid email format',
          },
        })
        .build();

      expect(event.api?.response?.code).toBe(400);
      expect(event.api?.response?.error).toBe('VALIDATION_ERROR');
      expect(event.api?.response?.error_message).toBe('Invalid email format');
    });
  });

  describe('HTTP request/response', () => {
    it('should add HTTP request details', () => {
      const event = readAPIEvent()
        .resource('user')
        .actor(testActor())
        .api(testAPI())
        .httpRequest({
          method: 'GET',
          url: {
            url_string: 'https://api.example.com/v1/users/123',
            hostname: 'api.example.com',
            path: '/v1/users/123',
            scheme: 'https',
            port: 443,
          },
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer [REDACTED]',
          },
          user_agent: 'MCP-Client/1.0',
        })
        .build();

      expect(event.http_request?.method).toBe('GET');
      expect(event.http_request?.url?.path).toBe('/v1/users/123');
      expect(event.http_request?.headers?.['Content-Type']).toBe('application/json');
      expect(event.http_request?.user_agent).toBe('MCP-Client/1.0');
    });

    it('should add HTTP response details', () => {
      const event = readAPIEvent()
        .resource('user')
        .actor(testActor())
        .api(testAPI())
        .httpResponse({
          code: 200,
          message: 'OK',
          headers: {
            'Content-Type': 'application/json',
            'X-Request-ID': 'req-123',
          },
          length: 1024,
          latency: 150,
        })
        .build();

      expect(event.http_response?.code).toBe(200);
      expect(event.http_response?.message).toBe('OK');
      expect(event.http_response?.length).toBe(1024);
      expect(event.http_response?.latency).toBe(150);
    });
  });

  describe('severity and status', () => {
    it('should set severity', () => {
      const event = createAPIEvent()
        .resource('user')
        .actor(testActor())
        .api(testAPI())
        .severity(SeverityId.High, 'High')
        .build();

      expect(event.severity_id).toBe(SeverityId.High);
      expect(event.severity).toBe('High');
    });

    it('should set status', () => {
      const event = createAPIEvent()
        .resource('user')
        .actor(testActor())
        .api(testAPI())
        .status(StatusId.Success, '201', 'Resource created successfully')
        .build();

      expect(event.status_id).toBe(StatusId.Success);
      expect(event.status_code).toBe('201');
      expect(event.status_detail).toBe('Resource created successfully');
    });
  });

  describe('actor and session', () => {
    it('should add actor information', () => {
      const event = createAPIEvent()
        .resource('post')
        .actor({
          user: {
            name: 'john.doe',
            uid: 'user-123',
            email_addr: 'john@example.com',
          },
          session: {
            uid: 'session-456',
            issuer: 'auth-server',
          },
        })
        .api(testAPI())
        .build();

      expect(event.actor?.user?.name).toBe('john.doe');
      expect(event.actor?.user?.uid).toBe('user-123');
      expect(event.actor?.session?.uid).toBe('session-456');
    });
  });

  describe('network endpoints', () => {
    it('should add source and destination endpoints', () => {
      const event = createAPIEvent()
        .resource('file')
        .actor(testActor())
        .api(testAPI())
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
      expect(event.src_endpoint?.hostname).toBe('client.local');
      expect(event.dst_endpoint?.ip).toBe('10.0.0.1');
      expect(event.dst_endpoint?.port).toBe(443);
    });
  });

  describe('cloud context', () => {
    it('should add cloud environment', () => {
      const event = createAPIEvent()
        .resource('database')
        .actor(testActor())
        .api(testAPI())
        .cloud({
          provider: 'Vercel',
          region: 'us-west-2',
          account: { name: 'production', uid: 'acct-123' },
        })
        .build();

      expect(event.cloud?.provider).toBe('Vercel');
      expect(event.cloud?.region).toBe('us-west-2');
    });
  });

  describe('connection and TLS', () => {
    it('should add connection information', () => {
      const event = readAPIEvent()
        .resource('data')
        .actor(testActor())
        .api(testAPI())
        .connectionInfo('inbound', 'HTTPS', '1.1')
        .build();

      expect(event.connection_info?.direction).toBe('inbound');
      expect(event.connection_info?.protocol_name).toBe('HTTPS');
      expect(event.connection_info?.protocol_ver).toBe('1.1');
    });

    it('should add TLS information', () => {
      const event = readAPIEvent()
        .resource('data')
        .actor(testActor())
        .api(testAPI())
        .tls('1.3', 'TLS_AES_256_GCM_SHA384')
        .build();

      expect(event.tls?.version).toBe('1.3');
      expect(event.tls?.cipher).toBe('TLS_AES_256_GCM_SHA384');
    });

    it('should add proxy information', () => {
      const event = readAPIEvent()
        .resource('data')
        .actor(testActor())
        .api(testAPI())
        .proxy('proxy.example.com', '10.1.1.1', 8080)
        .build();

      expect(event.proxy?.hostname).toBe('proxy.example.com');
      expect(event.proxy?.ip).toBe('10.1.1.1');
      expect(event.proxy?.port).toBe(8080);
    });
  });

  describe('metadata and custom attributes', () => {
    it('should add metadata', () => {
      const event = createAPIEvent()
        .resource('tool')
        .actor(testActor())
        .api(testAPI())
        .withMetadata({
          uid: 'event-789',
          correlation_uid: 'trace-abc',
          product: {
            name: 'MCP Server',
            version: '1.0.0',
          },
          labels: ['production', 'api', 'create'],
        })
        .build();

      expect(event.metadata.uid).toBe('event-789');
      expect(event.metadata.correlation_uid).toBe('trace-abc');
      expect(event.metadata.labels).toEqual(['production', 'api', 'create']);
    });

    it('should add unmapped custom attributes', () => {
      const event = createAPIEvent()
        .resource('custom')
        .actor(testActor())
        .api(testAPI())
        .unmapped({
          tool_name: 'chat',
          tool_parameters: { message: 'Hello' },
          cost: 0.002,
        })
        .build();

      expect(event.unmapped?.tool_name).toBe('chat');
      expect(event.unmapped?.cost).toBe(0.002);
    });
  });

  describe('time and duration', () => {
    it('should set duration', () => {
      const event = readAPIEvent()
        .resource('data')
        .actor(testActor())
        .api(testAPI())
        .duration(250)
        .build();

      expect(event.duration).toBe(250);
    });

    it('should set time range', () => {
      const startTime = Date.now();
      const endTime = startTime + 1000;

      const event = updateAPIEvent()
        .resource('config')
        .actor(testActor())
        .api(testAPI())
        .timeRange(startTime, endTime)
        .build();

      expect(event.start_time).toBe(startTime);
      expect(event.end_time).toBe(endTime);
      expect(event.duration).toBe(1000);
    });

    it('should set timezone offset', () => {
      const event = createAPIEvent()
        .resource('log')
        .actor(testActor())
        .api(testAPI())
        .timezoneOffset(-480) // PST
        .build();

      expect(event.timezone_offset).toBe(-480);
    });

    it('should set event count', () => {
      const event = readAPIEvent()
        .resource('items')
        .actor(testActor())
        .api(testAPI())
        .count(100)
        .build();

      expect(event.count).toBe(100);
    });
  });

  describe('type_uid calculation', () => {
    it('should calculate correct type_uid for Create', () => {
      const event = createAPIEvent()
        .resource('item')
        .actor(testActor())
        .api(testAPI())
        .build();

      // type_uid = class_uid * 100 + activity_id = 6003 * 100 + 1 = 600301
      expect(event.type_uid).toBe(600301);
    });

    it('should calculate correct type_uid for Read', () => {
      const event = readAPIEvent()
        .resource('item')
        .actor(testActor())
        .api(testAPI())
        .build();

      // type_uid = class_uid * 100 + activity_id = 6003 * 100 + 2 = 600302
      expect(event.type_uid).toBe(600302);
    });

    it('should calculate correct type_uid for Update', () => {
      const event = updateAPIEvent()
        .resource('item')
        .actor(testActor())
        .api(testAPI())
        .build();

      // type_uid = class_uid * 100 + activity_id = 6003 * 100 + 3 = 600303
      expect(event.type_uid).toBe(600303);
    });

    it('should calculate correct type_uid for Delete', () => {
      const event = deleteAPIEvent()
        .resource('item')
        .actor(testActor())
        .api(testAPI())
        .build();

      // type_uid = class_uid * 100 + activity_id = 6003 * 100 + 4 = 600304
      expect(event.type_uid).toBe(600304);
    });
  });

  describe('fluent API chaining', () => {
    it('should allow full fluent API chaining', () => {
      const event = createAPIEvent()
        .resource('user')
        .resource('profile')
        .resource('preferences')
        .severity(SeverityId.Informational, 'Informational')
        .status(StatusId.Success, '201')
        .message('User created successfully')
        .api({
          operation: 'createUser',
          service: { name: 'user-service', version: '2.0' },
        })
        .httpRequest({
          method: 'POST',
          url: { url_string: 'https://api.example.com/users' },
        })
        .httpResponse({ code: 201, message: 'Created', latency: 120 })
        .actor({ user: { name: 'admin', uid: 'admin-123' } })
        .srcEndpoint({ ip: '192.168.1.100' })
        .dstEndpoint({ ip: '10.0.0.1', port: 443 })
        .cloud({ provider: 'Vercel' })
        .withMetadata({ uid: 'event-123' })
        .unmapped({ custom: 'value' })
        .duration(120)
        .build();

      expect(event.resources).toEqual(['user', 'profile', 'preferences']);
      expect(event.severity_id).toBe(SeverityId.Informational);
      expect(event.status_id).toBe(StatusId.Success);
      expect(event.api?.operation).toBe('createUser');
      expect(event.http_response?.latency).toBe(120);
      expect(event.unmapped?.custom).toBe('value');
    });
  });

  describe('apiActivityEvent()', () => {
    it('should create event with custom activity ID', () => {
      const event = apiActivityEvent(APIActivityId.Other)
        .resource('function')
        .actor(testActor())
        .api(testAPI())
        .build();

      expect(event.activity_id).toBe(APIActivityId.Other);
      expect(event.activity_name).toBe('Other');
    });
  });
});
