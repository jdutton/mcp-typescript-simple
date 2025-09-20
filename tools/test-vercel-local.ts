#!/usr/bin/env tsx

/**
 * Local test script for Vercel API functions
 */

import { createServer } from 'http';
import { parse } from 'url';

// Import our API handlers
const handlers = {
  '/api/health': () => import('./api/health.js'),
  '/api/admin': () => import('./api/admin.js'),
  '/api/auth': () => import('./api/auth.js'),
  '/api/mcp': () => import('./api/mcp.js'),
};

async function createVercelMockServer(port: number = 3000) {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url || '', true);
      const pathname = parsedUrl.pathname || '';

      console.log(`📡 ${req.method} ${pathname}`);

      // Find matching handler
      const handlerPath = Object.keys(handlers).find(path =>
        pathname.startsWith(path)
      );

      if (handlerPath) {
        // Load the handler module
        const module = await handlers[handlerPath as keyof typeof handlers]();
        const handler = module.default;

        // Create mock VercelRequest/VercelResponse
        const mockReq = {
          ...req,
          url: req.url,
          method: req.method,
          headers: req.headers,
          body: req.method === 'POST' ? await getBody(req) : undefined,
        };

        const mockRes = {
          ...res,
          setHeader: (name: string, value: string) => res.setHeader(name, value),
          status: (code: number) => {
            res.statusCode = code;
            return {
              json: (data: any) => {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(data, null, 2));
              },
              end: () => res.end(),
            };
          },
          json: (data: any) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data, null, 2));
          },
          end: () => res.end(),
        };

        // Call the handler
        await handler(mockReq as any, mockRes as any);
      } else {
        // 404 for unknown paths
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          error: 'Not Found',
          message: `Path not found: ${pathname}`,
          available_paths: Object.keys(handlers)
        }, null, 2));
      }

    } catch (error) {
      console.error('❌ Server error:', error);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }, null, 2));
    }
  });

  return new Promise<void>((resolve) => {
    server.listen(port, () => {
      console.log(`🚀 Mock Vercel server running at http://localhost:${port}`);
      console.log(`📋 Available endpoints:`);
      Object.keys(handlers).forEach(path => {
        console.log(`   http://localhost:${port}${path}`);
      });
      resolve();
    });
  });
}

async function getBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: any) => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : undefined);
      } catch {
        resolve(body);
      }
    });
  });
}

// Start the server
createVercelMockServer(3000).catch(console.error);