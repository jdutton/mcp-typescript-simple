/**
 * OAuth authentication endpoints for Vercel deployment
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { OAuthProviderFactory } from '../build/auth/factory.js';
import { OAuthProvider, OAuthProviderType } from '../build/auth/providers/types.js';
import { logger } from '../build/utils/logger.js';
import { setOAuthAntiCachingHeaders } from './_utils/headers.js';

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

        // Simple HTML provider selection page
        // Note: Links use /auth/* paths (not /api/auth/*) to match Express behavior
        // Vercel rewrites /auth/* → /api/auth handler
        const loginHtml = `
<!DOCTYPE html>
<html>
  <head>
    <title>Sign in to MCP Server</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; max-width: 400px; margin: 50px auto; padding: 20px; }
      h1 { text-align: center; }
      .providers { display: flex; flex-direction: column; gap: 12px; margin-top: 24px; }
      .provider-btn { display: block; padding: 12px 24px; text-align: center; border: 2px solid #ddd; border-radius: 6px; text-decoration: none; color: #333; transition: all 0.2s; }
      .provider-btn:hover { border-color: #0066cc; background: #f0f9ff; }
    </style>
  </head>
  <body>
    <h1>Sign in to MCP Server</h1>
    <p style="text-align: center; color: #666;">Choose your authentication provider</p>
    <div class="providers">
      ${availableProviders.includes('google') ? `<a href="/auth/google${clientState ? `?state=${encodeURIComponent(clientState)}` : ''}${clientRedirectUri ? `${clientState ? '&' : '?'}redirect_uri=${encodeURIComponent(clientRedirectUri)}` : ''}" class="provider-btn">Continue with Google</a>` : ''}
      ${availableProviders.includes('github') ? `<a href="/auth/github${clientState ? `?state=${encodeURIComponent(clientState)}` : ''}${clientRedirectUri ? `${clientState ? '&' : '?'}redirect_uri=${encodeURIComponent(clientRedirectUri)}` : ''}" class="provider-btn">Continue with GitHub</a>` : ''}
      ${availableProviders.includes('microsoft') ? `<a href="/auth/microsoft${clientState ? `?state=${encodeURIComponent(clientState)}` : ''}${clientRedirectUri ? `${clientState ? '&' : '?'}redirect_uri=${encodeURIComponent(clientRedirectUri)}` : ''}" class="provider-btn">Continue with Microsoft</a>` : ''}
    </div>
  </body>
</html>`;

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

          // Authorization Code Grant - find correct provider
          if (grant_type === 'authorization_code') {
            logger.debug("Processing authorization_code grant", { hasCode: !!code });

            // Try each provider until one succeeds
            const errors: Array<{ provider: string; error: string }> = [];

            for (const [providerType, provider] of providers.entries()) {
              if (res.headersSent) {
                logger.debug("Response already sent, stopping provider iteration");
                return;
              }

              if ('handleTokenExchange' in provider) {
                try {
                  logger.debug("Trying token exchange with provider", { provider: providerType });
                  // Type cast required: Vercel types are not fully compatible with Express types
                  await (provider as any).handleTokenExchange(req as any, res as any);
                  logger.debug("Token exchange succeeded", { provider: providerType });
                  return; // Success
                } catch (error) {
                  if (!res.headersSent) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    logger.debug("Token exchange failed with provider", { provider: providerType, error: errorMsg });
                    errors.push({ provider: providerType, error: errorMsg });
                  } else {
                    logger.debug("Provider sent error response, stopping iteration");
                    return;
                  }
                }
              }
            }

            // No provider succeeded
            if (!res.headersSent) {
              logger.warn("Token exchange failed with all providers", { errors });
              res.status(400).json({
                error: 'invalid_grant',
                error_description: 'The provided authorization grant is invalid or expired',
                details: errors
              });
            }
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
        login: '/login',
        authorize: '/authorize',
        token: '/token',
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