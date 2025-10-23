/**
 * Health and Utility Routes
 *
 * Provides server health monitoring and debugging endpoints
 */

import { Router, Request, Response } from 'express';
import { SessionManager } from '../../session/session-manager.js';
import { OAuthProvider } from '@mcp-typescript-simple/auth';
import { EnvironmentConfig } from '@mcp-typescript-simple/config';
import { logger } from '@mcp-typescript-simple/observability';

export interface HealthRoutesOptions {
  enableResumability?: boolean;
  enableJsonResponse?: boolean;
}

/**
 * Setup health and utility routes
 *
 * @param router - Express router to attach routes to
 * @param sessionManager - Session manager for stats
 * @param oauthProviders - OAuth providers (optional, for debug info)
 * @param options - Server configuration options
 */
export function setupHealthRoutes(
  router: Router,
  sessionManager: SessionManager,
  oauthProviders: Map<string, OAuthProvider> | undefined,
  options: HealthRoutesOptions
): void {
  // Health check endpoint
  const healthHandler = (req: Request, res: Response) => {
    const sessionStats = sessionManager.getStats();

    // Check OAuth credentials availability (multi-provider)
    const googleConfigured = EnvironmentConfig.checkOAuthCredentials('google');
    const githubConfigured = EnvironmentConfig.checkOAuthCredentials('github');
    const microsoftConfigured = EnvironmentConfig.checkOAuthCredentials('microsoft');
    const genericConfigured = EnvironmentConfig.checkOAuthCredentials('generic');
    const configuredOAuthProviders = [
      googleConfigured && 'google',
      githubConfigured && 'github',
      microsoftConfigured && 'microsoft',
      genericConfigured && 'generic'
    ].filter(Boolean) as string[];

    // Check LLM providers
    const llmProviders = EnvironmentConfig.checkLLMProviders();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      deployment: 'local',
      mode: 'streamable_http',
      auth: configuredOAuthProviders.length > 0 ? 'enabled' : 'disabled',
      oauth_providers: configuredOAuthProviders,
      llm_providers: llmProviders,
      version: process.env.npm_package_version || '1.0.0',
      node_version: process.version,
      environment: process.env.NODE_ENV || 'development',
      sessions: sessionStats,
      performance: {
        uptime_seconds: process.uptime(),
        memory_usage: process.memoryUsage(),
      },
      features: {
        resumability: options.enableResumability || false,
        jsonResponse: options.enableJsonResponse || false,
      },
    });
  };

  // Register health endpoints for both standalone and Vercel deployments
  router.get('/health', healthHandler);

  // Debug endpoint for GitHub OAuth troubleshooting
  router.get('/debug/github-oauth', async (req: Request, res: Response) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        res.status(400).json({
          error: 'Missing Authorization header',
          message: 'Provide Authorization: Bearer YOUR_TOKEN header'
        });
        return;
      }

      logger.debug("Testing GitHub API access", { tokenPreview: token.substring(0, 10) + '...' });

      // Test GitHub user API
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'MCP-TypeScript-Server-Debug',
        },
      });

      const userData = userResponse.ok ? await userResponse.json() : await userResponse.text();

      // Test GitHub emails API
      const emailResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'MCP-TypeScript-Server-Debug',
        },
      });

      const emailData = emailResponse.ok ? await emailResponse.json() : await emailResponse.text();

      res.json({
        debug_info: {
          timestamp: new Date().toISOString(),
          token_preview: token.substring(0, 10) + '...',
        },
        github_user_api: {
          status: userResponse.status,
          status_text: userResponse.statusText,
          headers: Object.fromEntries(userResponse.headers.entries()),
          data: userData
        },
        github_emails_api: {
          status: emailResponse.status,
          status_text: emailResponse.statusText,
          headers: Object.fromEntries(emailResponse.headers.entries()),
          data: emailData
        },
        oauth_providers_info: oauthProviders ? Array.from(oauthProviders.entries()).map(([type, provider]) => ({
          type: provider.getProviderType(),
          name: provider.getProviderName(),
          endpoints: provider.getEndpoints()
        })) : 'No OAuth providers configured'
      });

    } catch (error) {
      logger.error("Debug endpoint error", error);
      res.status(500).json({
        error: 'Debug test failed',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
}