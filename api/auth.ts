/**
 * OAuth authentication endpoints for Vercel deployment
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { OAuthProviderFactory } from '../build/auth/factory.js';
import { OAuthProvider, OAuthProviderType } from '../build/auth/providers/types.js';
import { logger } from '../build/utils/logger.js';
import { setOAuthAntiCachingHeaders } from './_utils/headers.js';
import { generateLoginPageHTML } from '../build/auth/login-page.js';

// Global OAuth providers map for multi-provider support
let oauthProvidersInstance: Map<OAuthProviderType, OAuthProvider> | null = null;

/**
 * Initialize OAuth providers for serverless environment (multi-provider support)
 */
async function initializeOAuthProviders(): Promise<Map<OAuthProviderType, OAuthProvider>> {
  if (oauthProvidersInstance) {
    return oauthProvidersInstance;
  }

  try {
    const providers = await OAuthProviderFactory.createAllFromEnvironment();
    if (!providers || providers.size === 0) {
      throw new Error('No OAuth providers could be created from environment configuration');
    }

    oauthProvidersInstance = providers;
    logger.info("Multi-provider OAuth initialized", {
      providers: Array.from(providers.keys()),
      count: providers.size
    });
    return providers;
  } catch (error) {
    logger.error("Failed to initialize OAuth providers", error);
    throw error;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-protocol-version, mcp-session-id, Accept, User-Agent');

    // Set anti-caching headers for OAuth endpoints (RFC 6749, RFC 9700)
    setOAuthAntiCachingHeaders(res);

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    // Parse the OAuth path from Vercel's catch-all route parameter
    // Vercel rewrite: /auth/:path(.*)  →  /api/auth?path=:path
    // Examples:
    //   /auth/login          → query.path = "login"
    //   /auth/authorize      → query.path = "authorize"
    //   /auth/token          → query.path = "token"
    //   /auth/github         → query.path = "github"
    //   /auth/github/callback → query.path = "github/callback"

    if (!req.query.path) {
      logger.error("Missing path parameter from Vercel rewrite", {
        url: req.url,
        query: req.query
      });
      res.status(400).json({
        error: 'Bad Request',
        message: 'Missing path parameter. OAuth requests must go through /auth/* endpoints.'
      });
      return;
    }

    const pathArray = Array.isArray(req.query.path)
      ? req.query.path.filter(Boolean)
      : [req.query.path].filter(Boolean);

    const oauthPath = '/' + pathArray.join('/');

    logger.info("OAuth request received", {
      method: req.method,
      path: oauthPath,
      rawPath: req.url,
      queryPath: req.query.path,
      parsedPathArray: pathArray,
      fullQuery: req.query
    });

    // Initialize OAuth providers (multi-provider support)
    const providers = await initializeOAuthProviders();

    // Extract provider type from path (e.g., /google/callback -> google)
    const providerMatch = oauthPath.match(/^\/(google|github|microsoft)(\/|$)/);
    const providerType = providerMatch ? providerMatch[1] as OAuthProviderType : null;
    const provider = providerType ? providers.get(providerType) : null;

    /**
     * OAuth Route Handling
     *
     * All routes handled here (no fallbacks):
     *
     * Generic endpoints:
     *   /auth/login      → /login      (provider selection page)
     *   /auth/authorize  → /authorize  (generic OAuth start, redirects to /login)
     *   /auth/token      → /token      (universal token exchange)
     *
     * Provider-specific endpoints:
     *   /auth/google              → /google              (start Google OAuth)
     *   /auth/google/callback     → /google/callback     (Google callback)
     *   /auth/google/logout       → /google/logout       (Google logout)
     *   /auth/github              → /github              (start GitHub OAuth)
     *   /auth/github/callback     → /github/callback     (GitHub callback)
     *   /auth/github/logout       → /github/logout       (GitHub logout)
     *   /auth/microsoft           → /microsoft           (start Microsoft OAuth)
     *   /auth/microsoft/callback  → /microsoft/callback  (Microsoft callback)
     *   /auth/microsoft/logout    → /microsoft/logout    (Microsoft logout)
     */

    // Generic /authorize endpoint - redirect to /login for provider selection
    if (oauthPath === '/authorize') {
      if (req.method === 'GET') {
        logger.debug("Redirecting generic authorize to login page", { path: oauthPath });

        // If only one provider, redirect directly
        // Note: Use /auth/* paths (not /api/auth/*) to match Express behavior
        if (providers.size === 1) {
          const [singleProviderType] = providers.keys();
          const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
          res.redirect(302, `/auth/${singleProviderType}${queryString ? `?${queryString}` : ''}`);
          return;
        }

        // Multiple providers - redirect to login page
        const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
        res.redirect(302, `/auth/login${queryString ? `?${queryString}` : ''}`);
        return;
      }
    }

    // Provider selection/login page
    if (oauthPath === '/login') {
      if (req.method === 'GET') {
        logger.debug("Rendering provider selection page", { path: oauthPath });

        const availableProviders = Array.from(providers.keys());
        const clientState = req.query.state as string | undefined;
        const clientRedirectUri = req.query.redirect_uri as string | undefined;

        // Use shared login page template (ensures consistency with Express)
        const loginHtml = generateLoginPageHTML({
          availableProviders,
          clientState,
          clientRedirectUri
        });

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(loginHtml);
        return;
      }
    }


    // Universal /token endpoint (tries all providers)
    if (oauthPath === '/token') {
      if (req.method === 'POST') {
        logger.debug("Handling universal token request", {
          path: oauthPath,
          contentType: req.headers['content-type'],
          grantType: req.body?.grant_type
        });

        try {
          const { grant_type, refresh_token, code } = req.body || {};

          // Authorization Code Grant - find correct provider (two-phase approach)
          if (grant_type === 'authorization_code') {
            logger.info("Searching for provider with stored authorization code", {
              codePrefix: code?.substring(0, 10),
              availableProviders: Array.from(providers.keys())
            });

            // Phase 1: Find which provider has the authorization code
            let correctProvider: OAuthProvider | null = null;
            let correctProviderType: OAuthProviderType | null = null;

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
                  correctProviderType = providerType;
                  logger.info("Found provider for authorization code", { provider: providerType });
                  break;
                }
              }
            }

            // No provider has this code
            if (!correctProvider) {
              logger.error("No provider found for authorization code", {
                codePrefix: code?.substring(0, 10),
                availableProviders: Array.from(providers.keys()),
                hasCodeVerifier: !!req.body.code_verifier,
                message: 'Authorization code not found in any provider PKCE store'
              });

              res.status(400).json({
                error: 'invalid_grant',
                error_description: 'The provided authorization grant is invalid, expired, or was issued by a different provider'
              });
              return;
            }

            // Phase 2: Use the correct provider for token exchange
            if (correctProvider && 'handleTokenExchange' in correctProvider) {
              try {
                logger.info("Using correct provider for token exchange", { provider: correctProviderType });
                await (correctProvider as any).handleTokenExchange(req as any, res as any);
                logger.info("Token exchange succeeded", { provider: correctProviderType });
                return;
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

            // Should never reach here
            logger.warn("No OAuth providers available for token exchange");
            res.status(400).json({
              error: 'invalid_grant',
              error_description: 'No OAuth providers available'
            });
            return;
          } else if (grant_type === 'refresh_token' || refresh_token) {
            // Refresh Token Grant - try all providers
            logger.debug("Processing refresh_token grant");

            for (const provider of providers.values()) {
              try {
                // Type cast required: Vercel types are not fully compatible with Express types
                await provider.handleTokenRefresh(req as any, res as any);
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
            return;
          } else {
            // Invalid grant type
            res.status(400).json({
              error: 'unsupported_grant_type',
              error_description: 'Supported grant types: authorization_code, refresh_token'
            });
            return;
          }
        } catch (error) {
          logger.error("Token endpoint error", error);
          if (!res.headersSent) {
            res.status(500).json({
              error: 'server_error',
              error_description: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
        return;
      }
    }

    // Universal OAuth 2.0 token revocation endpoint (RFC 7009)
    if (oauthPath === '/revoke') {
      if (req.method === 'POST') {
        logger.debug("Handling universal token revocation", { path: oauthPath });

        try {
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
          return;
        } catch (error) {
          logger.error("Token revocation error", error);
          if (!res.headersSent) {
            res.status(500).json({
              error: 'server_error',
              error_description: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
        return;
      }
    }

    // Provider-specific routes
    if (provider) {
      const endpoints = provider.getEndpoints();

      // Authorization endpoint: /google, /github, /microsoft
      if (oauthPath === `/${providerType}`) {
        if (req.method === 'GET') {
          logger.debug("Handling OAuth authorization request", { provider: providerType });
          // Type cast required: Vercel types are not fully compatible with Express types
          await provider.handleAuthorizationRequest(req as any, res as any);
          return;
        }
      }

      // Callback endpoint: /google/callback, /github/callback, etc.
      if (oauthPath === `/${providerType}/callback`) {
        if (req.method === 'GET') {
          logger.debug("Handling OAuth callback", { provider: providerType });
          // Type cast required: Vercel types are not fully compatible with Express types
          await provider.handleAuthorizationCallback(req as any, res as any);
          return;
        }
      }

      // Logout endpoint: /google/logout, /github/logout, etc.
      if (oauthPath === `/${providerType}/logout`) {
        if (req.method === 'POST') {
          logger.debug("Handling logout", { provider: providerType });
          // Type cast required: Vercel types are not fully compatible with Express types
          await provider.handleLogout(req as any, res as any);
          return;
        }
      }
    }

    // If no matching endpoint found, return 404
    res.status(404).json({
      error: 'Not found',
      message: `OAuth endpoint not found: ${oauthPath}`,
      available_providers: Array.from(providers.keys()),
      available_endpoints: {
        login: '/auth/login',
        authorize: '/auth/authorize',
        token: '/auth/token',
        revoke: '/auth/revoke',
        providers: Array.from(providers.keys()).map(p => ({
          type: p,
          auth: `/auth/${p}`,
          callback: `/auth/${p}/callback`,
          logout: `/auth/${p}/logout`
        }))
      }
    });

  } catch (error) {
    logger.error("OAuth endpoint error", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: 'OAuth authentication failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}