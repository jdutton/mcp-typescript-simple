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
import { OAuthProvider, OAuthProviderType } from '../../auth/providers/types.js';
import { OAuthRegisteredClientsStore } from '../../auth/stores/client-store-interface.js';
import { setupDCRRoutes } from './dcr-routes.js';
import { logger } from '../../observability/logger.js';
import { generateLoginPageHTML } from '../../auth/login-page.js';

/**
 * Setup OAuth 2.0 authentication routes (single provider - legacy)
 *
 * @param router - Express router to attach routes to
 * @param oauthProvider - Configured OAuth provider
 * @param clientStore - Client store for DCR
 * @deprecated Use setupMultiProviderOAuthRoutes for multi-provider support
 */
export function setupOAuthRoutes(
  router: Router,
  oauthProvider: OAuthProvider,
  clientStore: OAuthRegisteredClientsStore
): void {
  const endpoints = oauthProvider.getEndpoints();

  // Helper to set anti-caching headers for OAuth endpoints (RFC 6749, RFC 9700)
  // Prevents Vercel edge cache from serving stale OAuth responses
  const setAntiCachingHeaders = (res: Response): void => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  };

  // Generic auth endpoint for test discovery
  router.get('/auth', (req: Request, res: Response) => {
    setAntiCachingHeaders(res);
    res.json({
      message: 'OAuth authentication endpoint',
      providers: ['google', 'github', 'microsoft'],
      endpoints: endpoints
    });
  });

  // OAuth authorization endpoint
  const authHandler = async (req: Request, res: Response) => {
    try {
      setAntiCachingHeaders(res);
      await oauthProvider.handleAuthorizationRequest(req, res);
    } catch (error) {
      logger.error("OAuth authorization error", error);
      setAntiCachingHeaders(res);
      res.status(500).json({ error: 'Authorization failed' });
    }
  };
  router.get(endpoints.authEndpoint, authHandler);

  // Generic OAuth authorize endpoint (for MCP Inspector compatibility) - now under /auth/authorize
  router.get('/auth/authorize', authHandler);

  // OAuth callback endpoint
  const callbackHandler = async (req: Request, res: Response) => {
    try {
      setAntiCachingHeaders(res);
      await oauthProvider.handleAuthorizationCallback(req, res);
    } catch (error) {
      logger.error("OAuth callback error", error);
      setAntiCachingHeaders(res);
      res.status(500).json({ error: 'Authorization callback failed' });
    }
  };
  router.get(endpoints.callbackEndpoint, callbackHandler);

  // Universal OAuth 2.0 token handler (RFC 6749 Section 3.2)
  // Implements OAuth 2.0 Token Endpoint for authorization_code and refresh_token grants
  // Supports both JSON and form data (RFC 6749 Section 4.1.3 and 6.1)
  const universalTokenHandler = async (req: Request, res: Response) => {
    try {
      setAntiCachingHeaders(res);

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
      setAntiCachingHeaders(res);
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
  router.post('/auth/token', universalTokenHandler);

  // Universal OAuth 2.0 token revocation endpoint (RFC 7009)
  const revokeHandler = async (req: Request, res: Response) => {
    try {
      setAntiCachingHeaders(res);

      // Extract token parameter (RFC 7009 Section 2.1)
      const { token, token_type_hint } = req.body || {};

      // Validate required token parameter
      if (!token || typeof token !== 'string' || token.trim() === '') {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing or invalid token parameter'
        });
        return;
      }

      // Remove token from provider's store
      try {
        await oauthProvider.removeToken(token);
        logger.debug('Token revoked successfully', { provider: oauthProvider.getProviderType() });
      } catch (error) {
        // Per RFC 7009 Section 2.2: "invalid tokens do not cause an error"
        logger.debug('Token removal failed', { provider: oauthProvider.getProviderType(), error });
      }

      // Always return 200 OK per RFC 7009 (even if token not found)
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error("OAuth revoke handler error", error);
      setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  };
  router.post('/auth/revoke', revokeHandler);

  // Logout endpoint
  const logoutHandler = async (req: Request, res: Response) => {
    try {
      setAntiCachingHeaders(res);
      await oauthProvider.handleLogout(req, res);
    } catch (error) {
      logger.error("Logout error", error);
      setAntiCachingHeaders(res);
      res.status(500).json({ error: 'Logout failed' });
    }
  };
  router.post(endpoints.logoutEndpoint, logoutHandler);

  // OAuth 2.0 Dynamic Client Registration routes (RFC 7591/7592)
  setupDCRRoutes(router, clientStore);
}

/**
 * Setup OAuth 2.0 authentication routes with multi-provider support
 *
 * @param router - Express router to attach routes to
 * @param providers - Map of provider type to provider instance
 * @param clientStore - Client store for DCR
 */
export function setupMultiProviderOAuthRoutes(
  router: Router,
  providers: Map<string, OAuthProvider>,
  clientStore: OAuthRegisteredClientsStore
): void {
  // Helper to set anti-caching headers for OAuth endpoints (RFC 6749, RFC 9700)
  const setAntiCachingHeaders = (res: Response): void => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  };

  // Provider selection/login page
  router.get('/auth/login', (req: Request, res: Response) => {
    setAntiCachingHeaders(res);

    const availableProviders = Array.from(providers.keys());
    const clientState = req.query.state as string | undefined;
    const clientRedirectUri = req.query.redirect_uri as string | undefined;

    const loginHtml = generateLoginPageHTML({
      availableProviders,
      clientState,
      clientRedirectUri
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(loginHtml);
  });


  // Generic auth endpoint (discovery)
  router.get('/auth', (req: Request, res: Response) => {
    setAntiCachingHeaders(res);
    res.json({
      message: 'OAuth authentication endpoint',
      providers: Array.from(providers.keys()),
      endpoints: {
        login: '/login',
        authorize: '/authorize',
        token: '/token'
      }
    });
  });

  // Setup routes for each provider
  for (const [providerType, provider] of providers.entries()) {
    const endpoints = provider.getEndpoints();

    // Provider-specific authorization endpoint
    const authHandler = async (req: Request, res: Response) => {
      try {
        setAntiCachingHeaders(res);
        await provider.handleAuthorizationRequest(req, res);
      } catch (error) {
        logger.error("OAuth authorization error", { provider: providerType, error });
        setAntiCachingHeaders(res);
        res.status(500).json({ error: 'Authorization failed' });
      }
    };
    router.get(endpoints.authEndpoint, authHandler);

    // Provider-specific callback endpoint
    const callbackHandler = async (req: Request, res: Response) => {
      try {
        setAntiCachingHeaders(res);
        await provider.handleAuthorizationCallback(req, res);
      } catch (error) {
        logger.error("OAuth callback error", { provider: providerType, error });
        setAntiCachingHeaders(res);
        res.status(500).json({ error: 'Authorization callback failed' });
      }
    };
    router.get(endpoints.callbackEndpoint, callbackHandler);

    // Provider-specific logout endpoint
    const logoutHandler = async (req: Request, res: Response) => {
      try {
        setAntiCachingHeaders(res);
        await provider.handleLogout(req, res);
      } catch (error) {
        logger.error("Logout error", { provider: providerType, error });
        setAntiCachingHeaders(res);
        res.status(500).json({ error: 'Logout failed' });
      }
    };
    router.post(endpoints.logoutEndpoint, logoutHandler);
  }

  // Generic OAuth 2.0 authorize endpoint (redirects to login page)
  router.get('/auth/authorize', (req: Request, res: Response) => {
    setAntiCachingHeaders(res);

    // If only one provider, redirect directly
    if (providers.size === 1) {
      const [providerType] = providers.keys();
      const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
      res.redirect(302, `/auth/${providerType}/authorize${queryString ? `?${queryString}` : ''}`);
      return;
    }

    // Multiple providers - redirect to login page
    const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
    res.redirect(302, `/auth/login${queryString ? `?${queryString}` : ''}`);
  });

  // Universal OAuth 2.0 token handler (works with any provider)
  const universalTokenHandler = async (req: Request, res: Response) => {
    try {
      setAntiCachingHeaders(res);

      const { grant_type, refresh_token, code } = req.body;

      logger.debug("Multi-provider token handler", { grant_type, hasCode: !!code, hasRefreshToken: !!refresh_token });

      // For authorization code exchange, we need to determine which provider issued the code
      // Strategy: Check which provider has a stored code_verifier for this authorization code
      // This is more efficient and accurate than trying each provider sequentially
      if (grant_type === 'authorization_code') {
        // Find the correct provider by checking who has the authorization code
        let correctProvider: OAuthProvider | null = null;
        let correctProviderType: OAuthProviderType | null = null;

        for (const [providerType, provider] of providers.entries()) {
          if ('hasStoredCodeForProvider' in provider) {
            const hasCode = await (provider as any).hasStoredCodeForProvider(code);
            if (hasCode) {
              correctProvider = provider;
              correctProviderType = providerType as OAuthProviderType;
              logger.debug("Found provider for authorization code", { provider: providerType });
              break;
            }
          }
        }

        // If no stored code found, try each provider (fallback for direct OAuth flows)
        if (!correctProvider) {
          logger.debug("No stored code_verifier found, trying each provider");
          const errors: Array<{ provider: string; error: string }> = [];

          for (const [providerType, provider] of providers.entries()) {
            // Skip if response already sent by previous provider attempt
            if (res.headersSent) {
              logger.debug("Response already sent, stopping provider iteration");
              return;
            }

            if ('handleTokenExchange' in provider) {
              try {
                logger.debug("Trying token exchange with provider", { provider: providerType });
                const tokenProvider = provider as OAuthProvider & {
                  handleTokenExchange: (req: Request, res: Response) => Promise<void>
                };
                await tokenProvider.handleTokenExchange(req, res);
                logger.debug("Token exchange succeeded", { provider: providerType });
                return; // Success - response already sent
              } catch (error) {
                // Only collect error if response wasn't sent (provider didn't send error response)
                if (!res.headersSent) {
                  const errorMsg = error instanceof Error ? error.message : String(error);
                  logger.debug("Token exchange failed with provider", { provider: providerType, error: errorMsg });
                  errors.push({ provider: providerType, error: errorMsg });
                } else {
                  logger.debug("Provider sent error response, stopping iteration");
                  return;
                }
                // Try next provider
                continue;
              }
            }
          }

          // No provider succeeded - return detailed error (only if no response sent)
          if (!res.headersSent) {
            logger.warn("Token exchange failed with all providers", { errors });
            res.status(400).json({
              error: 'invalid_grant',
              error_description: 'The provided authorization grant is invalid or expired',
              details: errors
            });
          }
          return;
        }

        // Use the correct provider
        if (correctProvider && 'handleTokenExchange' in correctProvider) {
          try {
            logger.debug("Using correct provider for token exchange", { provider: correctProviderType });
            const tokenProvider = correctProvider as OAuthProvider & {
              handleTokenExchange: (req: Request, res: Response) => Promise<void>
            };
            await tokenProvider.handleTokenExchange(req, res);
            logger.debug("Token exchange succeeded", { provider: correctProviderType });
            return; // Success
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error("Token exchange failed with correct provider", { provider: correctProviderType, error: errorMsg });
            res.status(400).json({
              error: 'invalid_grant',
              error_description: errorMsg
            });
            return;
          }
        }

        // This code is unreachable - errors variable is in the fallback block above
        // If we reach here, no providers were available
        logger.warn("No OAuth providers available for token exchange");
        res.status(400).json({
          error: 'invalid_grant',
          error_description: 'No OAuth providers available'
        });
      } else if (grant_type === 'refresh_token' || refresh_token) {
        // For refresh tokens, try each provider
        for (const provider of providers.values()) {
          try {
            await provider.handleTokenRefresh(req, res);
            return; // Success
          } catch (error) {
            // Try next provider
            continue;
          }
        }

        // No provider succeeded
        res.status(400).json({
          error: 'invalid_grant',
          error_description: 'The provided refresh token is invalid or expired'
        });
      } else {
        res.status(400).json({
          error: 'unsupported_grant_type',
          error_description: 'Supported grant types: authorization_code, refresh_token'
        });
      }
    } catch (error) {
      logger.error("OAuth universal token handler error", error);
      setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  };

  router.post('/auth/token', universalTokenHandler);

  // Universal OAuth 2.0 token revocation endpoint (RFC 7009)
  const universalRevokeHandler = async (req: Request, res: Response) => {
    try {
      setAntiCachingHeaders(res);

      // Extract token parameter (RFC 7009 Section 2.1)
      const { token, token_type_hint } = req.body || {};

      // Validate required token parameter
      if (!token || typeof token !== 'string' || token.trim() === '') {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing or invalid token parameter'
        });
        return;
      }

      // Try to revoke token from each provider
      // RFC 7009 Section 2.2: "The authorization server responds with HTTP status code 200
      // if the token has been revoked successfully or if the client submitted an invalid token"
      for (const [providerType, provider] of providers.entries()) {
        try {
          // Check if provider has this token
          if ('getToken' in provider) {
            const storedToken = await (provider as any).getToken(token);
            if (storedToken) {
              // Remove token from provider's store
              await provider.removeToken(token);
              logger.debug('Token revoked successfully', { provider: providerType });
              break; // Token found and removed, stop searching
            }
          } else {
            // If provider doesn't support getToken, try removing anyway
            await provider.removeToken(token);
            logger.debug('Token removal attempted', { provider: providerType });
            break;
          }
        } catch (error) {
          // Per RFC 7009 Section 2.2: "invalid tokens do not cause an error"
          // Continue trying other providers
          logger.debug('Token removal failed, trying next provider', { provider: providerType, error });
          continue;
        }
      }

      // Always return 200 OK per RFC 7009 (even if token not found)
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('OAuth universal revoke handler error', error);
      setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  };

  router.post('/auth/revoke', universalRevokeHandler);

  // OAuth 2.0 Dynamic Client Registration routes (RFC 7591/7592)
  setupDCRRoutes(router, clientStore);
}