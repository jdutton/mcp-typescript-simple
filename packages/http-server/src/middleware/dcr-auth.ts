/**
 * DCR Authentication Middleware
 *
 * Validates initial access tokens for protected DCR endpoints.
 *
 * Per RFC 7591 Section 3.1.1:
 * "The authorization server MAY require an initial access token that is provisioned
 * out-of-band (in a manner that is out of scope for this specification)."
 *
 * This middleware:
 * 1. Extracts Bearer token from Authorization header
 * 2. Validates token against the token store
 * 3. Marks token as used (increments usage count)
 * 4. Attaches token metadata to request for downstream handlers
 */

import { Request, Response, NextFunction } from 'express';
import { InitialAccessTokenStore, InitialAccessToken } from '@mcp-typescript-simple/persistence';
import { logger } from '@mcp-typescript-simple/observability';

/**
 * Extend Express Request to include validated token
 */
declare global {
   
  namespace Express {
    interface Request {
      initialAccessToken?: InitialAccessToken;
    }
  }
}

/**
 * Create middleware that validates initial access tokens
 */
export function requireInitialAccessToken(tokenStore: InitialAccessTokenStore) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Extract Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      logger.warn('DCR auth failed: missing Authorization header', {
        path: req.path,
        method: req.method,
      });

      res.status(401).json({
        error: 'invalid_token',
        error_description: 'Missing Authorization header. Use: Authorization: Bearer <token>',
      });
      return;
    }

    // Parse Bearer token
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
      logger.warn('DCR auth failed: invalid Authorization header format', {
        path: req.path,
        method: req.method,
        authHeader: authHeader.substring(0, 20) + '...',
      });

      res.status(401).json({
        error: 'invalid_token',
        error_description: 'Invalid Authorization header format. Use: Authorization: Bearer <token>',
      });
      return;
    }

    const token = match[1];

    // Validate token
    try {
      const result = await tokenStore.validateAndUseToken(token);

      if (!result.valid) {
        logger.warn('DCR auth failed: token validation failed', {
          path: req.path,
          method: req.method,
          reason: result.reason,
          token: token.substring(0, 8) + '...',
        });

        res.status(401).json({
          error: 'invalid_token',
          error_description: result.reason || 'Token validation failed',
        });
        return;
      }

      // Attach token to request
      req.initialAccessToken = result.token;

      logger.info('DCR auth succeeded', {
        tokenId: result.token?.id,
        path: req.path,
        method: req.method,
        usageCount: result.token?.usage_count,
      });

      next();
    } catch (error) {
      logger.error('DCR auth error', error);

      res.status(500).json({
        error: 'server_error',
        error_description: 'Internal server error during token validation',
      });
    }
  };
}

/**
 * Optional middleware to check admin permissions
 * (for future use when we add role-based access)
 *
 * NOTE: This implementation has testability limitations due to the Promise wrapper
 * around the inner middleware. In production, it works correctly, but the wrapped
 * response detection makes unit testing difficult. The inner middleware
 * (requireInitialAccessToken) is thoroughly tested and provides the core functionality.
 */
export function requireAdminToken(tokenStore: InitialAccessTokenStore) {
  const tokenMiddleware = requireInitialAccessToken(tokenStore);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // First validate the token
    await new Promise<void>((resolve, reject) => {
      tokenMiddleware(req, res, (err?: unknown) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Check if token has admin scope (future enhancement)
    // For now, any valid initial access token grants admin access
    if (!req.initialAccessToken) {
      res.status(403).json({
        error: 'insufficient_scope',
        error_description: 'Token does not have admin permissions',
      });
      return;
    }

    next();
  };
}