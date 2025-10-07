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
 * Setup OAuth 2.0 authentication routes with multi-provider support
 *
 * @param router - Express router to attach routes to
 * @param providers - Map of provider type to provider instance
 * @param clientStore - Client store for DCR
 */
export function setupOAuthRoutes(
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
      res.redirect(302, `/auth/${providerType}${queryString ? `?${queryString}` : ''}`);
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
      if (grant_type === 'authorization_code') {
        // Log complete request body for debugging (redact sensitive fields)
        logger.debug("Token exchange request body", {
          grant_type,
          code: code?.substring(0, 10) + '...',
          hasCodeVerifier: !!req.body.code_verifier,
          codeVerifierPrefix: req.body.code_verifier?.substring(0, 8),
          hasClientId: !!req.body.client_id,
          hasRedirectUri: !!req.body.redirect_uri,
          allBodyKeys: Object.keys(req.body)
        });

        // Find the correct provider by checking who has the authorization code
        let correctProvider: OAuthProvider | null = null;
        let correctProviderType: OAuthProviderType | null = null;

        logger.info("Searching for provider with stored authorization code", {
          codePrefix: code?.substring(0, 10),
          availableProviders: Array.from(providers.keys())
        });

        for (const [providerType, provider] of providers.entries()) {
          if ('hasStoredCodeForProvider' in provider) {
            const hasCode = await (provider as any).hasStoredCodeForProvider(code);
            logger.info("Provider code check result", {
              provider: providerType,
              hasCode,
              codePrefix: code?.substring(0, 10)
            });
            if (hasCode) {
              correctProvider = provider;
              correctProviderType = providerType as OAuthProviderType;
              logger.info("Found provider for authorization code", { provider: providerType });
              break;
            }
          }
        }

        // No stored code_verifier found - this indicates either:
        // 1. Direct OAuth flow where client should provide code_verifier
        // 2. Authorization code expired or already used
        // 3. Wrong provider tried (code issued by different provider)
        if (!correctProvider) {
          logger.error("No provider found for authorization code", {
            codePrefix: code?.substring(0, 10),
            availableProviders: Array.from(providers.keys()),
            hasCodeVerifier: !!req.body.code_verifier,
            message: 'Authorization code not found in any provider PKCE store. Either code expired, already used, or client must provide code_verifier for direct OAuth flow.'
          });

          res.status(400).json({
            error: 'invalid_grant',
            error_description: 'The provided authorization grant is invalid, expired, or was issued by a different provider',
            detail: 'No OAuth provider found with stored code_verifier for this authorization code'
          });
          return;
        }

        // Use the correct provider for token exchange
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

        // No providers were available (should never reach here)
        logger.warn("No OAuth providers available for token exchange");
        res.status(400).json({
          error: 'invalid_grant',
          error_description: 'No OAuth providers available'
        });
      } else if (grant_type === 'refresh_token' || refresh_token) {
        // Optimized refresh token routing: Look up token first to determine correct provider
        let correctProvider: OAuthProvider | null = null;
        let correctProviderType: string | null = null;

        // Get token store from any provider (they all share the same store)
        const firstProvider = providers.values().next().value;
        if (firstProvider && 'getTokenStore' in firstProvider) {
          const tokenStore = (firstProvider as any).getTokenStore();

          try {
            const tokenData = await tokenStore.findByRefreshToken(refresh_token);

            if (tokenData && tokenData.tokenInfo) {
              const providerType = tokenData.tokenInfo.provider;
              correctProvider = providers.get(providerType) || null;
              correctProviderType = providerType;

              if (correctProvider) {
                logger.debug('Routing refresh token to correct provider', { provider: correctProviderType });
              }
            }
          } catch (error) {
            // Token store lookup failed, fallback to sequential approach
            logger.debug('Token store lookup failed, falling back to sequential provider trial', { error });
          }
        }

        // If we found the correct provider, use it directly
        if (correctProvider) {
          try {
            await correctProvider.handleTokenRefresh(req, res);
            return; // Success
          } catch (error) {
            // Correct provider failed, don't try others
            logger.error('Token refresh failed with correct provider', { provider: correctProviderType, error });
            res.status(400).json({
              error: 'invalid_grant',
              error_description: error instanceof Error ? error.message : 'The provided refresh token is invalid or expired'
            });
            return;
          }
        }

        // Fallback: Try each provider (for direct OAuth flows or if lookup failed)
        logger.debug('Trying each provider for refresh token');
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