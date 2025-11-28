/**
 * Health check endpoint for Vercel deployment
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { logger } from '@mcp-typescript-simple/observability/logger';
import { buildHealthResponse } from '@mcp-typescript-simple/http-server/responses/health-response';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    // Only allow GET requests for health check
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const healthResponse = buildHealthResponse({
      deployment: 'vercel',
      mode: 'streamable_http',
      region: process.env.VERCEL_REGION ?? 'unknown',
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? 'local',
      deploymentUrl: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
      gitCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown',
      gitBranch: process.env.VERCEL_GIT_COMMIT_REF ?? 'unknown',
    });

    res.status(200).json(healthResponse);

  } catch (error) {
    logger.error("Health check error", error);
    if (!res.headersSent) {
      res.status(500).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}