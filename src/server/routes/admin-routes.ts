/**
 * Admin and Session Management Routes
 *
 * Provides administrative endpoints for session management and metrics monitoring
 */

import { Router, Request, Response } from 'express';
import { SessionManager } from '../../session/session-manager.js';
import { EnvironmentConfig } from '../../config/environment.js';

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

  // Admin metrics endpoint (matches Vercel API)
  const metricsHandler = (req: Request, res: Response) => {
    const sessionStats = sessionManager.getStats();
    const oauthProvider = process.env.OAUTH_PROVIDER || 'google';
    const hasOAuthCredentials = EnvironmentConfig.checkOAuthCredentials(oauthProvider);
    const llmProviders = EnvironmentConfig.checkLLMProviders();

    const metrics = {
      timestamp: new Date().toISOString(),
      platform: 'express-standalone',
      performance: {
        uptime_seconds: process.uptime(),
        memory_usage: process.memoryUsage(),
        cpu_usage: process.cpuUsage(),
      },
      deployment: {
        mode: 'standalone',
        version: process.env.npm_package_version || '1.0.0',
        node_version: process.version,
        environment: process.env.NODE_ENV || 'development',
      },
      configuration: {
        oauth_provider: oauthProvider,
        oauth_configured: hasOAuthCredentials,
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
}