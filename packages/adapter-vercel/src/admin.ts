/**
 * Admin endpoints for monitoring and management
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { logger } from '@mcp-typescript-simple/observability/logger';

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
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const pathSegments = url.pathname.split('/').filter(Boolean);

    // Remove 'api' and 'admin' from path segments to get the actual admin path
    const adminPath = '/' + pathSegments.slice(2).join('/');

    logger.debug("Admin request received", { method: req.method, path: adminPath });

    // Sessions endpoint
    if (adminPath === '/sessions' || adminPath === '') {
      if (req.method === 'GET') {
        // For serverless deployment, we don't maintain persistent sessions
        // Return deployment and runtime information instead
        const deploymentInfo = {
          sessions: [],
          stats: {
            totalSessions: 0,
            activeSessions: 0,
            expiredSessions: 0
          },
          deployment: {
            platform: 'vercel',
            mode: 'serverless',
            region: process.env.VERCEL_REGION || 'unknown',
            deployment_id: process.env.VERCEL_DEPLOYMENT_ID?.substring(0, 12) || 'local',
            version: process.env.npm_package_version || '1.0.0',
            node_version: process.version.split('.')[0], // Major version only
            uptime: Math.floor(process.uptime()),
            memory_usage: {
              heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
              heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024), // MB
            },
          },
          environment: {
            oauth_providers: checkConfiguredOAuthProviders(),
            oauth_configured: checkOAuthConfigured(),
            llm_providers: checkLLMProviders(),
          },
          note: 'Serverless deployments do not maintain persistent sessions between requests'
        };

        res.status(200).json(deploymentInfo);
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
    if (adminPath === '/info' || adminPath === '/status') {
      if (req.method === 'GET') {
        const deploymentInfo = {
          platform: 'vercel',
          mode: 'serverless',
          version: process.env.npm_package_version || '1.0.0',
          node_version: process.version.split('.')[0], // Major version only
          region: process.env.VERCEL_REGION || 'unknown',
          deployment_id: process.env.VERCEL_DEPLOYMENT_ID?.substring(0, 12) || 'local',
          deployment_url: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'unknown',
          git_commit: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
          git_branch: process.env.VERCEL_GIT_COMMIT_REF || 'unknown',
          environment: process.env.NODE_ENV || 'development',
          uptime: process.uptime(),
          memory_usage: process.memoryUsage(),
          cpu_usage: process.cpuUsage(),
          oauth_providers: checkConfiguredOAuthProviders(),
          oauth_configured: checkOAuthConfigured(),
          llm_providers: checkLLMProviders(),
        };

        res.status(200).json(deploymentInfo);
        return;
      }
    }

    // Metrics endpoint
    if (adminPath === '/metrics') {
      if (req.method === 'GET') {
        const metrics = {
          timestamp: new Date().toISOString(),
          platform: 'vercel-serverless',
          performance: {
            uptime_seconds: process.uptime(),
            memory_usage: process.memoryUsage(),
            cpu_usage: process.cpuUsage(),
          },
          deployment: {
            region: process.env.VERCEL_REGION || 'unknown',
            deployment_id: process.env.VERCEL_DEPLOYMENT_ID || 'local',
            version: process.env.npm_package_version || '1.0.0',
            node_version: process.version,
            git_commit: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
            git_branch: process.env.VERCEL_GIT_COMMIT_REF || 'unknown',
          },
          configuration: {
            oauth_providers: checkConfiguredOAuthProviders(),
            oauth_configured: checkOAuthConfigured(),
            llm_providers: checkLLMProviders(),
            transport_mode: 'streamable_http',
          },
          endpoints: {
            health: '/api/health',
            mcp: '/api/mcp',
            auth: '/api/auth',
            admin: '/api/admin',
          }
        };

        res.status(200).json(metrics);
        return;
      }
    }

    // If no matching endpoint found, return 404
    res.status(404).json({
      error: 'Not found',
      message: `Admin endpoint not found: ${adminPath}`,
      available_endpoints: ['/sessions', '/info', '/status', '/metrics']
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

/**
 * Check which OAuth providers are configured
 */
function checkConfiguredOAuthProviders(): string[] {
  const providers: string[] = [];

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.push('google');
  }
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    providers.push('github');
  }
  if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
    providers.push('microsoft');
  }
  if (process.env.OAUTH_CLIENT_ID && process.env.OAUTH_CLIENT_SECRET &&
      process.env.OAUTH_AUTHORIZATION_URL && process.env.OAUTH_TOKEN_URL &&
      process.env.OAUTH_USER_INFO_URL) {
    providers.push('generic');
  }

  return providers;
}

/**
 * Check if OAuth is properly configured (at least one provider)
 */
function checkOAuthConfigured(): boolean {
  return checkConfiguredOAuthProviders().length > 0;
}

/**
 * Check which LLM providers have API keys configured
 */
function checkLLMProviders(): string[] {
  const providers: string[] = [];

  if (process.env.ANTHROPIC_API_KEY) {
    providers.push('claude');
  }
  if (process.env.OPENAI_API_KEY) {
    providers.push('openai');
  }
  if (process.env.GOOGLE_API_KEY) {
    providers.push('gemini');
  }

  return providers;
}