/**
 * OCSF Middleware Integration Tests
 *
 * Tests that verify OCSF API Activity events are emitted for HTTP requests through the middleware.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { ocsfMiddleware } from '../../src/middleware/ocsf-middleware.js';
import * as ocsfModule from '@mcp-typescript-simple/observability/ocsf';

describe('OCSF Middleware Integration', () => {
  let app: Express;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    // Spy on emitOCSFEvent to verify it's called
    emitSpy = vi.spyOn(ocsfModule, 'emitOCSFEvent');

    // Create Express app with OCSF middleware
    app = express();
    app.use(ocsfMiddleware());

    // Add test routes
    app.get('/health', (_req, res) => {
      res.status(200).json({ status: 'healthy' });
    });

    app.get('/api/test', (_req, res) => {
      res.status(200).json({ message: 'test' });
    });

    app.post('/api/create', (_req, res) => {
      res.status(201).json({ created: true });
    });

    app.get('/error', (_req, _res) => {
      throw new Error('Test error');
    });
  });

  afterAll(() => {
    emitSpy.mockRestore();
  });

  it('should emit OCSF event for successful GET request', async () => {
    emitSpy.mockClear();

    await request(app).get('/health').expect(200);

    // Verify emitOCSFEvent was called
    expect(emitSpy).toHaveBeenCalledTimes(1);

    // Verify event structure
    const event = emitSpy.mock.calls[0][0];
    console.log('[TEST DEBUG] Event received:', JSON.stringify(event, null, 2));
    expect(event).toMatchObject({
      class_name: 'API Activity',
      class_uid: 6003,
      category_name: 'Application Activity',
      category_uid: 6,
      severity: 'Informational',
      severity_id: 1,
      activity_name: 'Create',
      activity_id: 1,
    });

    // Verify HTTP request details
    expect(event.http_request).toMatchObject({
      method: 'GET', // OCSF spec uses 'method' not 'http_method'
      url: expect.objectContaining({
        path: '/health',
      }),
    });

    // Verify status
    expect(event.status_code).toBe('200');
    expect(event.status).toBe('Success');
    expect(event.status_id).toBe(1); // Success
  });

  it('should emit OCSF event for POST request with 201 response', async () => {
    emitSpy.mockClear();

    await request(app).post('/api/create').expect(201);

    expect(emitSpy).toHaveBeenCalledTimes(1);

    const event = emitSpy.mock.calls[0][0];
    expect(event.http_request).toMatchObject({
      method: 'POST', // OCSF spec uses 'method' not 'http_method'
      url: expect.objectContaining({
        path: '/api/create',
      }),
    });

    expect(event.status_code).toBe('201');
    expect(event.status).toBe('Success');
  });

  it('should emit OCSF events for multiple sequential requests', async () => {
    emitSpy.mockClear();

    await request(app).get('/health').expect(200);
    await request(app).get('/api/test').expect(200);
    await request(app).post('/api/create').expect(201);

    // Verify 3 events were emitted
    expect(emitSpy).toHaveBeenCalledTimes(3);

    // Verify each event has correct HTTP method
    const methods = emitSpy.mock.calls.map((call) => call[0].http_request.method);
    expect(methods).toEqual(['GET', 'GET', 'POST']);
  });

  it('should emit OCSF event with correct activity_name for different HTTP methods', async () => {
    emitSpy.mockClear();

    await request(app).get('/api/test').expect(200);
    await request(app).post('/api/create').expect(201);

    expect(emitSpy).toHaveBeenCalledTimes(2);

    // All should be "Create" activity (API Activity default)
    const activities = emitSpy.mock.calls.map((call) => call[0].activity_name);
    expect(activities).toEqual(['Create', 'Create']);
  });

  it('should include source endpoint information', async () => {
    emitSpy.mockClear();

    await request(app).get('/health').expect(200);

    expect(emitSpy).toHaveBeenCalledTimes(1);

    const event = emitSpy.mock.calls[0][0];
    expect(event.src_endpoint).toBeDefined();
    expect(event.src_endpoint?.ip).toBeDefined();
  });

  it('should include metadata with correlation UID', async () => {
    emitSpy.mockClear();

    await request(app).get('/health').expect(200);

    expect(emitSpy).toHaveBeenCalledTimes(1);

    const event = emitSpy.mock.calls[0][0];
    expect(event.metadata).toBeDefined();
    expect(event.metadata.version).toBe('1.3.0');
    expect(event.metadata.uid).toBeDefined();
  });

  it('should emit events for different endpoint paths', async () => {
    emitSpy.mockClear();

    await request(app).get('/health').expect(200);
    await request(app).get('/api/test').expect(200);

    expect(emitSpy).toHaveBeenCalledTimes(2);

    const paths = emitSpy.mock.calls.map((call) => call[0].http_request.url.path);
    expect(paths).toEqual(['/health', '/api/test']);
  });

  it('should include duration in milliseconds', async () => {
    emitSpy.mockClear();

    await request(app).get('/health').expect(200);

    expect(emitSpy).toHaveBeenCalledTimes(1);

    const event = emitSpy.mock.calls[0][0];
    expect(event.duration).toBeDefined();
    expect(typeof event.duration).toBe('number');
    expect(event.duration).toBeGreaterThanOrEqual(0);
  });

  it('should handle requests without errors', async () => {
    emitSpy.mockClear();

    // Multiple concurrent requests
    await Promise.all([
      request(app).get('/health'),
      request(app).get('/api/test'),
      request(app).post('/api/create'),
    ]);

    // Verify all events were emitted
    expect(emitSpy).toHaveBeenCalledTimes(3);

    // Verify all events are valid
    for (const call of emitSpy.mock.calls) {
      const event = call[0];
      expect(event.class_name).toBe('API Activity');
      expect(event.http_request).toBeDefined();
      expect(event.status_code).toBeDefined();
    }
  });
});
