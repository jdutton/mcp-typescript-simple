/**
 * Health check endpoint for Vercel deployment
 */

import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

    // Check environment variables for OAuth configuration
    const oauthProvider = process.env.OAUTH_PROVIDER || 'google';
    const hasOAuthCredentials = checkOAuthCredentials(oauthProvider);

    // Check LLM provider availability
    const llmProviders = checkLLMProviders();

    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      deployment: 'vercel',
      mode: 'streamable_http',
      auth: hasOAuthCredentials ? 'enabled' : 'disabled',
      oauth_provider: oauthProvider,
      llm_providers: llmProviders,
      version: process.env.npm_package_version || '1.0.0',
      node_version: process.version,
      environment: process.env.NODE_ENV || 'development',
      region: process.env.VERCEL_REGION || 'unknown',
      vercel_deployment_id: process.env.VERCEL_DEPLOYMENT_ID || 'local',
      vercel_deployment_url: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
      git_commit: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
      git_branch: process.env.VERCEL_GIT_COMMIT_REF || 'unknown',
      performance: {
        uptime_seconds: process.uptime(),
        memory_usage: process.memoryUsage(),
        cpu_usage: process.cpuUsage(),
      },
      observability: {
        logs_enabled: true,
        metrics_endpoint: '/api/admin/metrics',
        health_endpoint: '/api/health',
        admin_endpoint: '/api/admin',
      }
    };

    res.status(200).json(healthData);

  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Check if OAuth credentials are configured for the selected provider
 */
function checkOAuthCredentials(provider: string): boolean {
  switch (provider) {
    case 'google':
      return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    case 'github':
      return !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    case 'microsoft':
      return !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
    case 'generic':
      return !!(
        process.env.OAUTH_CLIENT_ID &&
        process.env.OAUTH_CLIENT_SECRET &&
        process.env.OAUTH_AUTHORIZATION_URL &&
        process.env.OAUTH_TOKEN_URL &&
        process.env.OAUTH_USER_INFO_URL
      );
    default:
      return false;
  }
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