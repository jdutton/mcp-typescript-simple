/**
 * OAuth 2.0 Authentication Routes
 *
 * Implements OAuth 2.0 authentication flow:
 * - Authorization endpoint (RFC 6749 Section 4.1.1)
 * - Callback endpoint (RFC 6749 Section 4.1.2)
 * - Token endpoint (RFC 6749 Section 3.2)
 * - Logout endpoint
 */

import { Router, Request, Response } from 'express';
import { OAuthProvider } from '../../auth/providers/types.js';
import { OAuthRegisteredClientsStore } from '../../auth/stores/client-store-interface.js';
import { setupDCRRoutes } from './dcr-routes.js';
import { logger } from '../../observability/logger.js';

/**
 * Setup OAuth 2.0 authentication routes
 *
 * @param router - Express router to attach routes to
 * @param oauthProvider - Configured OAuth provider
 * @param clientStore - Client store for DCR
 */
export function setupOAuthRoutes(
  router: Router,
  oauthProvider: OAuthProvider,
  clientStore: OAuthRegisteredClientsStore
): void {
  const endpoints = oauthProvider.getEndpoints();

  // Generic auth endpoint for test discovery
  router.get('/auth', (req: Request, res: Response) => {
    res.json({
      message: 'OAuth authentication endpoint',
      providers: ['google', 'github', 'microsoft'],
      endpoints: endpoints
    });
  });

  // OAuth authorization endpoint
  const authHandler = async (req: Request, res: Response) => {
    try {
      await oauthProvider.handleAuthorizationRequest(req, res);
    } catch (error) {
      logger.error("OAuth authorization error", error);
      res.status(500).json({ error: 'Authorization failed' });
    }
  };
  router.get(endpoints.authEndpoint, authHandler);

  // Generic OAuth authorize endpoint (for MCP Inspector compatibility)
  router.get('/authorize', authHandler);

  // OAuth callback endpoint
  const callbackHandler = async (req: Request, res: Response) => {
    try {
      await oauthProvider.handleAuthorizationCallback(req, res);
    } catch (error) {
      logger.error("OAuth callback error", error);
      res.status(500).json({ error: 'Authorization callback failed' });
    }
  };
  router.get(endpoints.callbackEndpoint, callbackHandler);

  // Universal OAuth 2.0 token handler (RFC 6749 Section 3.2)
  // Implements OAuth 2.0 Token Endpoint for authorization_code and refresh_token grants
  // Supports both JSON and form data (RFC 6749 Section 4.1.3 and 6.1)
  const universalTokenHandler = async (req: Request, res: Response) => {
    try {
      logger.debug("Universal token handler processing", {
        contentType: req.headers['content-type'],
        body: req.body
      });

      // Extract parameters (works for both form data and JSON)
      const { grant_type, refresh_token } = req.body;

      // Determine operation based on grant_type (RFC 6749 Section 4.1.3)
      if (grant_type === 'authorization_code') {
        // Authorization Code Grant token exchange (RFC 6749 Section 4.1.3)
        // Supports PKCE (RFC 7636) - delegate to provider's handleTokenExchange
        if (oauthProvider && 'handleTokenExchange' in oauthProvider) {
          // Type assertion for providers that implement handleTokenExchange
          const provider = oauthProvider as OAuthProvider & {
            handleTokenExchange: (req: Request, res: Response) => Promise<void>
          };
          await provider.handleTokenExchange(req, res);
        } else {
          res.status(501).json({
            error: 'not_implemented',
            error_description: 'Token exchange not supported by current OAuth provider'
          });
        }
      } else if (grant_type === 'refresh_token' || refresh_token) {
        // Refresh Token Grant (RFC 6749 Section 6) - delegate to provider's handleTokenRefresh
        await oauthProvider.handleTokenRefresh(req, res);
      } else {
        // Invalid grant type (RFC 6749 Section 5.2)
        res.status(400).json({
          error: 'unsupported_grant_type',
          error_description: 'Supported grant types: authorization_code, refresh_token'
        });
      }
    } catch (error) {
      logger.error("OAuth universal token handler error", error);
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  };

  // Use universal handler for both provider-specific refresh endpoint and generic token endpoint
  router.post(endpoints.refreshEndpoint, universalTokenHandler);

  // Generic OAuth 2.0 token endpoint (RFC 6749 Section 3.2) - uses same universal handler
  router.post('/token', universalTokenHandler);

  // Logout endpoint
  const logoutHandler = async (req: Request, res: Response) => {
    try {
      await oauthProvider.handleLogout(req, res);
    } catch (error) {
      logger.error("Logout error", error);
      res.status(500).json({ error: 'Logout failed' });
    }
  };
  router.post(endpoints.logoutEndpoint, logoutHandler);

  // OAuth 2.0 Dynamic Client Registration routes (RFC 7591/7592)
  setupDCRRoutes(router, clientStore);
}