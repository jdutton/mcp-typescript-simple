/**
 * Admin and Session Management Routes
 *
 * Provides administrative endpoints for session management and metrics monitoring
 */

import { Router, Request, Response } from 'express';
import { SessionManager } from '../../session/session-manager.js';
import { InitialAccessTokenStore } from '@mcp-typescript-simple/persistence';
import { requireInitialAccessToken } from '../../middleware/dcr-auth.js';
import { buildInfoResponse, buildMetricsResponse, buildSessionsResponse } from '../responses/admin-response.js';

export interface AdminRoutesOptions {
  /** Allow unrestricted access in development mode (default: false) */
  devMode?: boolean;
}

/**
 * Setup admin and session management routes
 *
 * @param router - Express router to attach routes to
 * @param sessionManager - Session manager for session operations
 * @param tokenStore - Token store for authentication
 * @param options - Configuration options
 */
export function setupAdminRoutes(
  router: Router,
  sessionManager: SessionManager,
  tokenStore: InitialAccessTokenStore,
  options: AdminRoutesOptions = {}
): void {
  const devMode = options.devMode ?? false;
  // Get active sessions (admin endpoint)
  const sessionsHandler = (req: Request, res: Response) => {
    const sessions = sessionManager.getActiveSessions();
    const stats = sessionManager.getStats();

    const response = buildSessionsResponse({
      deployment: 'local',
      sessions: sessions.map(s => ({
        sessionId: s.sessionId,
        createdAt: new Date(s.createdAt).toISOString(),
        expiresAt: new Date(s.expiresAt).toISOString(),
        hasAuth: !!s.authInfo,
        metadata: s.metadata,
      })),
      sessionStats: stats,
    });

    res.json(response);
  };
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

  // Admin info endpoint (deployment information)
  const infoHandler = (req: Request, res: Response) => {
    const response = buildInfoResponse({
      deployment: 'local',
    });

    res.json(response);
  };

  // Admin metrics endpoint (matches Vercel API)
  const metricsHandler = (req: Request, res: Response) => {
    const sessionStats = sessionManager.getStats();

    const response = buildMetricsResponse({
      deployment: 'local',
      sessionStats,
    });

    res.json(response);
  };

  // Register routes with authentication in production mode
  if (devMode) {
    // Development mode - no authentication required
    router.get('/admin/sessions', sessionsHandler);
    router.delete('/admin/sessions/:sessionId', deleteSessionHandler);
    router.get('/admin/info', infoHandler);
    router.get('/admin/metrics', metricsHandler);
  } else {
    // Production mode - require authentication
    const authMiddleware = requireInitialAccessToken(tokenStore);
    router.get('/admin/sessions', authMiddleware, sessionsHandler);
    router.delete('/admin/sessions/:sessionId', authMiddleware, deleteSessionHandler);
    router.get('/admin/info', authMiddleware, infoHandler);
    router.get('/admin/metrics', authMiddleware, metricsHandler);
  }

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