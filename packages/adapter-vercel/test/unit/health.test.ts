/**
 * Unit tests for Vercel health endpoint
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../../src/health';

describe('Vercel Health Endpoint', () => {
  let req: Partial<VercelRequest>;
  let res: Partial<VercelResponse>;
  let setHeaderSpy: ReturnType<typeof vi.fn>;
  let statusSpy: ReturnType<typeof vi.fn>;
  let jsonSpy: ReturnType<typeof vi.fn>;
  let endSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset environment variables
    delete process.env.VERCEL_REGION;
    delete process.env.VERCEL_DEPLOYMENT_ID;
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.VERCEL_GIT_COMMIT_REF;

    // Create mocks
    setHeaderSpy = vi.fn();
    statusSpy = vi.fn().mockReturnThis();
    jsonSpy = vi.fn().mockReturnThis();
    endSpy = vi.fn().mockReturnThis();

    req = {
      method: 'GET',
      url: '/health',
    };

    res = {
      setHeader: setHeaderSpy,
      status: statusSpy,
      json: jsonSpy,
      end: endSpy,
      headersSent: false,
    } as Partial<VercelResponse>;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('CORS Headers', () => {
    it('should set CORS headers for GET requests', async () => {
      await handler(req as VercelRequest, res as VercelResponse);

      expect(setHeaderSpy).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(setHeaderSpy).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, OPTIONS');
      expect(setHeaderSpy).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type');
    });

    it('should set CORS headers for OPTIONS requests', async () => {
      req.method = 'OPTIONS';

      await handler(req as VercelRequest, res as VercelResponse);

      expect(setHeaderSpy).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(setHeaderSpy).toHaveBeenCalledWith('Access-Control-Allow-Methods', 'GET, OPTIONS');
      expect(setHeaderSpy).toHaveBeenCalledWith('Access-Control-Allow-Headers', 'Content-Type');
    });
  });

  describe('OPTIONS Requests (CORS Preflight)', () => {
    it('should handle OPTIONS requests correctly', async () => {
      req.method = 'OPTIONS';

      await handler(req as VercelRequest, res as VercelResponse);

      expect(statusSpy).toHaveBeenCalledWith(200);
      expect(endSpy).toHaveBeenCalled();
      expect(jsonSpy).not.toHaveBeenCalled();
    });
  });

  describe('GET Requests', () => {
    it('should return health response for GET requests', async () => {
      await handler(req as VercelRequest, res as VercelResponse);

      expect(statusSpy).toHaveBeenCalledWith(200);
      expect(jsonSpy).toHaveBeenCalled();

      const response = jsonSpy.mock.calls[0][0];
      expect(response).toHaveProperty('status', 'healthy');
      expect(response).toHaveProperty('timestamp');
      expect(response).toHaveProperty('deployment', 'vercel');
      expect(response).toHaveProperty('mode', 'streamable_http');
    });

    it('should include default values when environment variables are missing', async () => {
      await handler(req as VercelRequest, res as VercelResponse);

      const response = jsonSpy.mock.calls[0][0];
      expect(response.region).toBe('unknown');
      expect(response.vercel_deployment_id).toBe('local');
      expect(response.vercel_deployment_url).toBeUndefined();
      expect(response.git_commit).toBe('unknown');
      expect(response.git_branch).toBe('unknown');
    });

    it('should include Vercel environment variables when available', async () => {
      process.env.VERCEL_REGION = 'us-east-1';
      process.env.VERCEL_DEPLOYMENT_ID = 'dpl_123456';
      process.env.VERCEL_URL = 'my-app.vercel.app';
      process.env.VERCEL_GIT_COMMIT_SHA = 'abc123';
      process.env.VERCEL_GIT_COMMIT_REF = 'main';

      await handler(req as VercelRequest, res as VercelResponse);

      const response = jsonSpy.mock.calls[0][0];
      expect(response.region).toBe('us-east-1');
      expect(response.vercel_deployment_id).toBe('dpl_123456');
      expect(response.vercel_deployment_url).toBe('https://my-app.vercel.app');
      expect(response.git_commit).toBe('abc123');
      expect(response.git_branch).toBe('main');
    });
  });

  describe('Invalid HTTP Methods', () => {
    it('should return 405 for POST requests', async () => {
      req.method = 'POST';

      await handler(req as VercelRequest, res as VercelResponse);

      expect(statusSpy).toHaveBeenCalledWith(405);
      expect(jsonSpy).toHaveBeenCalledWith({ error: 'Method not allowed' });
    });

    it('should return 405 for PUT requests', async () => {
      req.method = 'PUT';

      await handler(req as VercelRequest, res as VercelResponse);

      expect(statusSpy).toHaveBeenCalledWith(405);
      expect(jsonSpy).toHaveBeenCalledWith({ error: 'Method not allowed' });
    });

    it('should return 405 for DELETE requests', async () => {
      req.method = 'DELETE';

      await handler(req as VercelRequest, res as VercelResponse);

      expect(statusSpy).toHaveBeenCalledWith(405);
      expect(jsonSpy).toHaveBeenCalledWith({ error: 'Method not allowed' });
    });

    it('should return 405 for PATCH requests', async () => {
      req.method = 'PATCH';

      await handler(req as VercelRequest, res as VercelResponse);

      expect(statusSpy).toHaveBeenCalledWith(405);
      expect(jsonSpy).toHaveBeenCalledWith({ error: 'Method not allowed' });
    });
  });

  describe('Error Handling', () => {
    it('should return 500 when buildHealthResponse throws an error', async () => {
      // Mock buildHealthResponse to throw an error by making setHeader throw
      setHeaderSpy.mockImplementationOnce(() => {
        throw new Error('Header error');
      });

      await handler(req as VercelRequest, res as VercelResponse);

      expect(statusSpy).toHaveBeenCalledWith(500);
      expect(jsonSpy).toHaveBeenCalledWith({
        status: 'unhealthy',
        timestamp: expect.any(String),
        error: 'Header error',
      });
    });

    it('should handle unknown errors', async () => {
      setHeaderSpy.mockImplementationOnce(() => {
        throw 'String error'; // Non-Error object
      });

      await handler(req as VercelRequest, res as VercelResponse);

      expect(statusSpy).toHaveBeenCalledWith(500);
      expect(jsonSpy).toHaveBeenCalledWith({
        status: 'unhealthy',
        timestamp: expect.any(String),
        error: 'Unknown error',
      });
    });

    it('should not send response if headers already sent', async () => {
      res.headersSent = true;
      setHeaderSpy.mockImplementationOnce(() => {
        throw new Error('Test error');
      });

      await handler(req as VercelRequest, res as VercelResponse);

      // Should not call status or json if headers already sent
      expect(statusSpy).not.toHaveBeenCalled();
      expect(jsonSpy).not.toHaveBeenCalled();
    });
  });

  describe('Response Format', () => {
    it('should return timestamp in ISO format', async () => {
      const before = new Date();
      await handler(req as VercelRequest, res as VercelResponse);
      const after = new Date();

      const response = jsonSpy.mock.calls[0][0];
      const timestamp = new Date(response.timestamp);

      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should have consistent response structure', async () => {
      await handler(req as VercelRequest, res as VercelResponse);

      const response = jsonSpy.mock.calls[0][0];
      expect(response).toMatchObject({
        status: expect.any(String),
        timestamp: expect.any(String),
        deployment: expect.any(String),
        mode: expect.any(String),
        auth: expect.any(String),
        oauth_providers: expect.any(Array),
        llm_providers: expect.any(Array),
        version: expect.any(String),
        node_version: expect.any(String),
        environment: expect.any(String),
        performance: expect.any(Object),
        storage: expect.any(Object),
      });
    });
  });
});
