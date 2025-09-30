/**
 * Admin Token Management Routes
 *
 * Endpoints for managing initial access tokens used for protected DCR.
 *
 * Security: These endpoints require admin authentication (future: use existing admin session/JWT)
 * For now: Development mode allows unrestricted access when MCP_DEV_SKIP_AUTH=true
 *
 * Endpoints:
 * - POST /admin/tokens - Create new initial access token
 * - GET /admin/tokens - List all tokens
 * - GET /admin/tokens/:id - Get token details
 * - DELETE /admin/tokens/:id - Revoke/delete token
 * - POST /admin/tokens/cleanup - Clean up expired tokens
 * - POST /admin/register - Protected client registration (requires initial access token)
 */

import { Router, Request, Response } from 'express';
import { InitialAccessTokenStore } from '../../auth/stores/token-store-interface.js';
import { OAuthRegisteredClientsStore } from '../../auth/stores/client-store-interface.js';
import { requireInitialAccessToken } from '../../middleware/dcr-auth.js';
import { logger } from '../../utils/logger.js';

export interface AdminTokenRoutesOptions {
  /** Allow unrestricted access in development mode (default: false) */
  devMode?: boolean;
}

/**
 * Setup admin token management routes
 */
export function setupAdminTokenRoutes(
  router: Router,
  tokenStore: InitialAccessTokenStore,
  clientStore: OAuthRegisteredClientsStore,
  options: AdminTokenRoutesOptions = {}
): void {
  const devMode = options.devMode ?? false;

  /**
   * Create new initial access token
   * POST /admin/tokens
   */
  const createTokenHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { description, expires_in, max_uses } = req.body;

      if (!description || typeof description !== 'string') {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'description is required and must be a string',
        });
        return;
      }

      const token = await tokenStore.createToken({
        description,
        expires_in: expires_in || 2592000, // 30 days default
        max_uses: max_uses || 0, // Unlimited default
      });

      logger.info('Initial access token created via admin endpoint', {
        tokenId: token.id,
        description: token.description,
        expiresAt: token.expires_at,
      });

      res.status(201).json({
        id: token.id,
        token: token.token, // Only returned on creation
        description: token.description,
        created_at: token.created_at,
        expires_at: token.expires_at,
        max_uses: token.max_uses || null,
      });
    } catch (error) {
      logger.error('Failed to create token', error);
      res.status(500).json({
        error: 'server_error',
        error_description: 'Failed to create token',
      });
    }
  };

  /**
   * List all tokens
   * GET /admin/tokens
   */
  const listTokensHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const includeRevoked = req.query.include_revoked === 'true';
      const includeExpired = req.query.include_expired === 'true';

      const tokens = await tokenStore.listTokens({
        includeRevoked,
        includeExpired,
      });

      // Don't include actual token values in list
      const sanitized = tokens.map((t) => ({
        id: t.id,
        description: t.description,
        created_at: t.created_at,
        expires_at: t.expires_at,
        last_used_at: t.last_used_at,
        usage_count: t.usage_count,
        max_uses: t.max_uses || null,
        revoked: t.revoked,
      }));

      res.json({
        tokens: sanitized,
        count: sanitized.length,
      });
    } catch (error) {
      logger.error('Failed to list tokens', error);
      res.status(500).json({
        error: 'server_error',
        error_description: 'Failed to list tokens',
      });
    }
  };

  /**
   * Get token details
   * GET /admin/tokens/:id
   */
  const getTokenHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Token ID is required',
        });
        return;
      }

      const token = await tokenStore.getToken(id);

      if (!token) {
        res.status(404).json({
          error: 'not_found',
          error_description: 'Token not found',
        });
        return;
      }

      // Don't include actual token value
      res.json({
        id: token.id,
        description: token.description,
        created_at: token.created_at,
        expires_at: token.expires_at,
        last_used_at: token.last_used_at,
        usage_count: token.usage_count,
        max_uses: token.max_uses || null,
        revoked: token.revoked,
      });
    } catch (error) {
      logger.error('Failed to get token', error);
      res.status(500).json({
        error: 'server_error',
        error_description: 'Failed to get token',
      });
    }
  };

  /**
   * Revoke/delete token
   * DELETE /admin/tokens/:id
   */
  const deleteTokenHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      if (!id) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Token ID is required',
        });
        return;
      }

      const permanent = req.query.permanent === 'true';

      let success: boolean;
      if (permanent) {
        success = await tokenStore.deleteToken(id);
      } else {
        success = await tokenStore.revokeToken(id);
      }

      if (!success) {
        res.status(404).json({
          error: 'not_found',
          error_description: 'Token not found',
        });
        return;
      }

      logger.info('Token removed via admin endpoint', {
        tokenId: id,
        action: permanent ? 'deleted' : 'revoked',
      });

      res.json({
        success: true,
        action: permanent ? 'deleted' : 'revoked',
      });
    } catch (error) {
      logger.error('Failed to delete token', error);
      res.status(500).json({
        error: 'server_error',
        error_description: 'Failed to delete token',
      });
    }
  };

  /**
   * Clean up expired/revoked tokens
   * POST /admin/tokens/cleanup
   */
  const cleanupTokensHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      const cleaned = await tokenStore.cleanup();

      logger.info('Token cleanup completed via admin endpoint', { cleaned });

      res.json({
        success: true,
        cleaned_count: cleaned,
      });
    } catch (error) {
      logger.error('Failed to cleanup tokens', error);
      res.status(500).json({
        error: 'server_error',
        error_description: 'Failed to cleanup tokens',
      });
    }
  };

  /**
   * Protected client registration endpoint
   * POST /admin/register
   *
   * Requires initial access token authentication.
   * Used for trusted clients that need longer-lived credentials.
   */
  const protectedRegisterHandler = async (req: Request, res: Response): Promise<void> => {
    try {
      logger.info('Protected client registration request received', {
        clientName: req.body.client_name,
        redirectUris: req.body.redirect_uris,
        tokenId: req.initialAccessToken?.id,
      });

      // Validate required fields (RFC 7591 Section 2)
      if (!req.body.redirect_uris || !Array.isArray(req.body.redirect_uris) || req.body.redirect_uris.length === 0) {
        res.status(400).json({
          error: 'invalid_client_metadata',
          error_description: 'redirect_uris is required and must be a non-empty array',
        });
        return;
      }

      // Validate redirect URIs
      for (const uri of req.body.redirect_uris) {
        try {
          new URL(uri);
        } catch {
          res.status(400).json({
            error: 'invalid_redirect_uri',
            error_description: `Invalid redirect URI: ${uri}`,
          });
          return;
        }
      }

      // Register client with extended expiration (1 year instead of 30 days)
      const client = await clientStore.registerClient({
        client_name: req.body.client_name || 'Trusted Client',
        redirect_uris: req.body.redirect_uris,
        grant_types: req.body.grant_types || ['authorization_code', 'refresh_token'],
        response_types: req.body.response_types || ['code'],
        scope: req.body.scope,
        token_endpoint_auth_method: req.body.token_endpoint_auth_method || 'client_secret_post',
        // Trusted clients get 1 year expiration
        client_secret_expires_at: 31536000,
      });

      logger.info('Trusted client registered successfully', {
        clientId: client.client_id,
        clientName: client.client_name,
        tokenId: req.initialAccessToken?.id,
      });

      // Return RFC 7591 compliant response
      res.status(201).json(client);
    } catch (error) {
      logger.error('Protected client registration failed', error);
      res.status(500).json({
        error: 'server_error',
        error_description: 'Failed to register client',
      });
    }
  };

  // Register routes
  // Note: In dev mode, skip authentication. In production, would require admin session/JWT.
  if (devMode) {
    logger.warn('Admin token routes running in DEV MODE - no authentication required');
    router.post('/admin/tokens', createTokenHandler);
    router.get('/admin/tokens', listTokensHandler);
    router.get('/admin/tokens/:id', getTokenHandler);
    router.delete('/admin/tokens/:id', deleteTokenHandler);
    router.post('/admin/tokens/cleanup', cleanupTokensHandler);
  } else {
    // In production, these would require admin authentication
    // For now, we'll just log a warning that they should be protected
    logger.warn('Admin token routes should be protected with authentication in production');
    router.post('/admin/tokens', createTokenHandler);
    router.get('/admin/tokens', listTokensHandler);
    router.get('/admin/tokens/:id', getTokenHandler);
    router.delete('/admin/tokens/:id', deleteTokenHandler);
    router.post('/admin/tokens/cleanup', cleanupTokensHandler);
  }

  // Protected registration endpoint always requires initial access token
  router.post('/admin/register', requireInitialAccessToken(tokenStore), protectedRegisterHandler);

  logger.info('Admin token routes configured', {
    devMode,
    endpoints: [
      'POST /admin/tokens',
      'GET /admin/tokens',
      'GET /admin/tokens/:id',
      'DELETE /admin/tokens/:id',
      'POST /admin/tokens/cleanup',
      'POST /admin/register (protected)',
    ],
  });
}