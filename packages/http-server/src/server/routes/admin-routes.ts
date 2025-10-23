/**
 * Admin and Session Management Routes
 *
 * Provides administrative endpoints for session management and metrics monitoring
 */

import { Router, Request, Response } from 'express';
import { SessionManager } from '../../session/session-manager.js';
import { EnvironmentConfig } from '@mcp-typescript-simple/config';

/**
 * Setup admin and session management routes
 *
 * @param router - Express router to attach routes to
 * @param sessionManager - Session manager for session operations
 */
export function setupAdminRoutes(
  router: Router,
  sessionManager: SessionManager
): void {
  // Get active sessions (admin endpoint)
  const sessionsHandler = (req: Request, res: Response) => {
    const sessions = sessionManager.getActiveSessions();
    const stats = sessionManager.getStats();

    res.json({
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        createdAt: new Date(s.createdAt).toISOString(),
        expiresAt: new Date(s.expiresAt).toISOString(),
        hasAuth: !!s.authInfo,
        metadata: s.metadata,
      })),
      stats,
      deployment: {
        platform: 'vercel',
        mode: 'serverless',
        version: process.env.npm_package_version || '1.0.0',
        node_version: process.version
      }
    });
  };
  router.get('/admin/sessions', sessionsHandler);

  // Close a specific session (admin endpoint)
  const deleteSessionHandler = (req: Request, res: Response) => {
    const { sessionId } = req.params;
    if (!sessionId) {
      res.status(400).json({ error: 'Session ID is required' });
      return;
    }
    const closed = sessionManager.closeSession(sessionId);

    if (closed) {
      res.json({ success: true, message: `Session ${sessionId} closed` });
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  };
  router.delete('/admin/sessions/:sessionId', deleteSessionHandler);

  // Admin info endpoint (deployment information)
  const infoHandler = (req: Request, res: Response) => {
    const googleConfigured = EnvironmentConfig.checkOAuthCredentials('google');
    const githubConfigured = EnvironmentConfig.checkOAuthCredentials('github');
    const microsoftConfigured = EnvironmentConfig.checkOAuthCredentials('microsoft');
    const configuredOAuthProviders = [
      googleConfigured && 'google',
      githubConfigured && 'github',
      microsoftConfigured && 'microsoft'
    ].filter(Boolean) as string[];
    const llmProviders = EnvironmentConfig.checkLLMProviders();

    res.json({
      platform: 'vercel',
      mode: 'serverless',
      version: process.env.npm_package_version || '1.0.0',
      node_version: process.version,
      oauth_providers: configuredOAuthProviders,
      oauth_configured: configuredOAuthProviders.length > 0,
      llm_providers: llmProviders
    });
  };
  router.get('/admin/info', infoHandler);

  // Admin metrics endpoint (matches Vercel API)
  const metricsHandler = (req: Request, res: Response) => {
    const sessionStats = sessionManager.getStats();
    const googleConfigured = EnvironmentConfig.checkOAuthCredentials('google');
    const githubConfigured = EnvironmentConfig.checkOAuthCredentials('github');
    const microsoftConfigured = EnvironmentConfig.checkOAuthCredentials('microsoft');
    const configuredOAuthProviders = [
      googleConfigured && 'google',
      githubConfigured && 'github',
      microsoftConfigured && 'microsoft'
    ].filter(Boolean) as string[];
    const llmProviders = EnvironmentConfig.checkLLMProviders();

    const metrics = {
      timestamp: new Date().toISOString(),
      platform: 'vercel-serverless',
      performance: {
        uptime_seconds: process.uptime(),
        memory_usage: process.memoryUsage(),
        cpu_usage: process.cpuUsage(),
      },
      deployment: {
        region: process.env.VERCEL_REGION || 'local',
        version: process.env.npm_package_version || '1.0.0',
        node_version: process.version,
        environment: process.env.NODE_ENV || 'development',
      },
      configuration: {
        oauth_providers: configuredOAuthProviders,
        llm_providers: llmProviders,
        transport_mode: 'streamable_http',
      },
      sessions: sessionStats,
      endpoints: {
        health: '/health',
        mcp: '/mcp',
        auth: '/auth',
        admin: '/admin',
      }
    };

    res.json(metrics);
  };
  router.get('/admin/metrics', metricsHandler);

  // 404 handler for unknown admin endpoints (must be last)
  // Use wildcard parameter instead of * to make path-to-regexp happy
  router.use('/admin/:invalidPath', (req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not found',
      message: `Admin endpoint ${req.path} not found`,
      available_endpoints: [
        '/admin/sessions',
        '/admin/info',
        '/admin/metrics'
      ]
    });
  });
}