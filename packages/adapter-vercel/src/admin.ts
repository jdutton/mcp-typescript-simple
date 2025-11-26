/**
 * Admin endpoints for monitoring and management
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { logger } from '@mcp-typescript-simple/observability/logger';
import { buildSessionsResponse, buildInfoResponse, buildMetricsResponse } from '@mcp-typescript-simple/http-server/responses/admin-response';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    // Parse the URL path to determine the admin endpoint
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    const pathSegments = url.pathname.split('/').filter(Boolean);

    // Remove 'api' and 'admin' from path segments to get the actual admin path
    const adminPath = '/' + pathSegments.slice(2).join('/');

    logger.debug("Admin request received", { method: req.method, path: adminPath });

    // Sessions endpoint
    if (adminPath === '/sessions' || adminPath === '') {
      if (req.method === 'GET') {
        // For serverless deployment, we don't maintain persistent sessions
        const response = buildSessionsResponse({
          deployment: 'vercel',
          sessions: [],
          sessionStats: {
            totalSessions: 0,
            activeSessions: 0,
            expiredSessions: 0
          },
          region: process.env.VERCEL_REGION ?? 'unknown',
          deploymentId: process.env.VERCEL_DEPLOYMENT_ID?.substring(0, 12) || 'local',
          note: 'Serverless deployments do not maintain persistent sessions between requests'
        });

        res.status(200).json(response);
        return;
      }
    }

    // Individual session management (not applicable in serverless)
    if (adminPath.startsWith('/sessions/')) {
      const sessionId = pathSegments[3];

      if (req.method === 'DELETE') {
        res.status(200).json({
          success: false,
          message: `Session management not available in serverless deployment`,
          sessionId: sessionId,
          note: 'Sessions are not persistent in serverless functions'
        });
        return;
      }
    }

    // Deployment info endpoint
    if (adminPath === '/info') {
      if (req.method === 'GET') {
        const response = buildInfoResponse({
          deployment: 'vercel',
          region: process.env.VERCEL_REGION ?? 'unknown',
          deploymentId: process.env.VERCEL_DEPLOYMENT_ID?.substring(0, 12) || 'local',
          deploymentUrl: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'unknown',
          gitCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown',
          gitBranch: process.env.VERCEL_GIT_COMMIT_REF ?? 'unknown',
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          cpuUsage: process.cpuUsage(),
        });

        res.status(200).json(response);
        return;
      }
    }

    // Metrics endpoint
    if (adminPath === '/metrics') {
      if (req.method === 'GET') {
        const response = buildMetricsResponse({
          deployment: 'vercel',
          region: process.env.VERCEL_REGION ?? 'unknown',
          deploymentId: process.env.VERCEL_DEPLOYMENT_ID || 'local',
          gitCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown',
          gitBranch: process.env.VERCEL_GIT_COMMIT_REF ?? 'unknown',
        });

        res.status(200).json(response);
        return;
      }
    }

    // If no matching endpoint found, return 404
    res.status(404).json({
      error: 'Not found',
      message: `Admin endpoint not found: ${adminPath}`,
      available_endpoints: ['/sessions', '/info', '/metrics']
    });

  } catch (error) {
    logger.error("Admin endpoint error", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Admin endpoint failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}