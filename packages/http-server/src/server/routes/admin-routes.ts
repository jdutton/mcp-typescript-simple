/**
 * Admin Routes
 *
 * Provides administrative endpoints for monitoring
 */

import { Router, Request, Response } from 'express';
import { InitialAccessTokenStore } from '@mcp-typescript-simple/persistence';
import { requireInitialAccessToken } from '../../middleware/dcr-auth.js';
import { buildInfoResponse, buildMetricsResponse } from '../responses/admin-response.js';

export interface AdminRoutesOptions {
  /** Allow unrestricted access in development mode (default: false) */
  devMode?: boolean;
}

/**
 * Setup admin routes
 *
 * @param router - Express router to attach routes to
 * @param tokenStore - Token store for authentication
 * @param options - Configuration options
 */
export function setupAdminRoutes(
  router: Router,
  tokenStore: InitialAccessTokenStore,
  options: AdminRoutesOptions = {}
): void {
  const devMode = options.devMode ?? false;

  // Admin info endpoint (deployment information)
  const infoHandler = (req: Request, res: Response) => {
    const response = buildInfoResponse({
      deployment: 'local',
    });

    res.json(response);
  };

  // Admin metrics endpoint (matches Vercel API)
  const metricsHandler = (req: Request, res: Response) => {
    const response = buildMetricsResponse({
      deployment: 'local',
      sessionStats: {
        totalSessions: 0,      // Not tracked after sessionManager removal
        activeSessions: 0,     // Session count available via metadataStore if needed
        expiredSessions: 0,
      },
    });

    res.json(response);
  };

  // Register routes with authentication in production mode
  if (devMode) {
    // Development mode - no authentication required
    router.get('/admin/info', infoHandler);
    router.get('/admin/metrics', metricsHandler);
  } else {
    // Production mode - require authentication
    const authMiddleware = requireInitialAccessToken(tokenStore);
    router.get('/admin/info', authMiddleware, infoHandler);
    router.get('/admin/metrics', authMiddleware, metricsHandler);
  }

  // 404 handler for unknown admin endpoints (must be last)
  // Use wildcard parameter instead of * to make path-to-regexp happy
  router.use('/admin/:invalidPath', (req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not found',
      message: `Admin endpoint ${req.path} not found`,
      availableEndpoints: [
        'GET /admin/info',
        'GET /admin/metrics',
      ],
    });
  });
}
