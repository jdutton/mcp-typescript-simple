/**
 * OAuth authentication endpoints for Vercel deployment
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { OAuthProviderFactory } from '@mcp-typescript-simple/auth/factory';
import { OAuthProvider, OAuthProviderType } from '@mcp-typescript-simple/auth/providers/types';
import { logger } from '@mcp-typescript-simple/observability/logger';
import { setOAuthAntiCachingHeaders } from '@mcp-typescript-simple/auth/shared/oauth-helpers';
import { generateLoginPageHTML } from '@mcp-typescript-simple/auth/login-page';
import { handleUniversalTokenRequest } from '@mcp-typescript-simple/auth/shared/universal-token-handler';
import { handleUniversalRevokeRequest } from '@mcp-typescript-simple/auth/shared/universal-revoke-handler';
import {
  handleProviderAuthorizationRequest,
  handleProviderAuthorizationCallback,
  handleProviderLogout,
  handleOAuthDiscovery,
  handleGenericAuthorize
} from '@mcp-typescript-simple/auth/shared/provider-router';

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
        message: 'Missing path parameter. OAuth requests must go through /auth/* endpoints.',
        timestamp: new Date().toISOString()
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
     *   /auth                → /             (discovery endpoint - lists available providers)
     *   /auth/login          → /login        (provider selection page)
     *   /auth/authorize      → /authorize    (generic OAuth start, redirects to /login)
     *   /auth/token          → /token        (universal token exchange)
     *   /auth/revoke         → /revoke       (universal token revocation)
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

    // Generic auth endpoint (discovery)
    if (oauthPath === '/') {
      if (req.method === 'GET') {
        logger.debug("Returning OAuth discovery information", { path: oauthPath });
        handleOAuthDiscovery(providers, res);
        return;
      }
    }

    // Generic /authorize endpoint - redirect to /login for provider selection
    if (oauthPath === '/authorize') {
      if (req.method === 'GET') {
        logger.debug("Redirecting generic authorize to login page", { path: oauthPath });
        handleGenericAuthorize(providers, req.query as Record<string, any>, res);
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
        await handleUniversalTokenRequest(req, res, providers);
        return;
      }
    }

    // Universal OAuth 2.0 token revocation endpoint (RFC 7009)
    if (oauthPath === '/revoke') {
      if (req.method === 'POST') {
        logger.debug("Handling universal token revocation", { path: oauthPath });
        await handleUniversalRevokeRequest(req, res, providers);
        return;
      }
    }

    // Provider-specific routes
    if (provider && providerType) {
      const endpoints = provider.getEndpoints();

      // Authorization endpoint: /google, /github, /microsoft
      if (oauthPath === `/${providerType}`) {
        if (req.method === 'GET') {
          logger.debug("Handling OAuth authorization request", { provider: providerType });
          await handleProviderAuthorizationRequest(provider, providerType, req, res);
          return;
        }
      }

      // Callback endpoint: /google/callback, /github/callback, etc.
      if (oauthPath === `/${providerType}/callback`) {
        if (req.method === 'GET') {
          logger.debug("Handling OAuth callback", { provider: providerType });
          await handleProviderAuthorizationCallback(provider, providerType, req, res);
          return;
        }
      }

      // Logout endpoint: /google/logout, /github/logout, etc.
      if (oauthPath === `/${providerType}/logout`) {
        if (req.method === 'POST') {
          logger.debug("Handling logout", { provider: providerType });
          await handleProviderLogout(provider, providerType, req, res);
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
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error("OAuth endpoint error", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: 'OAuth authentication failed',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  }
}