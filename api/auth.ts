/**
 * OAuth authentication endpoints for Vercel deployment
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { OAuthProviderFactory } from '../build/auth/factory.js';
import { logger } from '../build/utils/logger.js';
import { setOAuthAntiCachingHeaders } from './_utils/headers.js';

// Global OAuth provider instance for reuse
let oauthProviderInstance: any = null;

/**
 * Initialize OAuth provider for serverless environment
 */
async function initializeOAuthProvider() {
  if (oauthProviderInstance) {
    return oauthProviderInstance;
  }

  try {
    const provider = await OAuthProviderFactory.createFromEnvironment();
    if (!provider) {
      throw new Error('OAuth provider could not be created from environment configuration');
    }

    oauthProviderInstance = provider;
    logger.info("OAuth provider initialized", { providerType: provider.getProviderType() });
    return provider;
  } catch (error) {
    logger.error("Failed to initialize OAuth provider", error);
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
    // For /auth/github, Vercel passes query.path = ['github']
    // For /auth/github/callback, Vercel passes query.path = ['github', 'callback']

    // Try to get path from query parameter first
    let pathArray: string[] = [];
    if (req.query.path) {
      pathArray = Array.isArray(req.query.path) ? req.query.path : [req.query.path];
      pathArray = pathArray.filter(Boolean);
    }

    // Fallback: parse from URL if query.path is empty
    if (pathArray.length === 0 && req.url) {
      // Extract path after /auth/ or /api/auth/
      // Also handle direct /authorize and /token endpoints
      const urlMatch = req.url.match(/\/(?:api\/)?(?:auth(?:\/(.+?))?|authorize|token)(?:\?|$)/);
      if (urlMatch) {
        if (req.url.includes('/authorize')) {
          pathArray = ['authorize'];
        } else if (req.url.includes('/token')) {
          pathArray = ['token'];
        } else if (urlMatch[1]) {
          pathArray = urlMatch[1].split('/').filter(Boolean);
        }
      }
    }

    const oauthPath = pathArray.length > 0 ? '/' + pathArray.join('/') : '/';

    logger.info("OAuth request received", {
      method: req.method,
      path: oauthPath,
      rawPath: req.url,
      queryPath: req.query.path,
      parsedPathArray: pathArray,
      fullQuery: req.query
    });

    // Initialize OAuth provider
    const oauthProvider = await initializeOAuthProvider();
    const endpoints = oauthProvider.getEndpoints();

    // Route to appropriate OAuth handler based on path
    // Paths come as: /github, /github/callback, /google, /google/callback, etc.

    // Match generic /authorize endpoint (MCP Inspector compatibility)
    if (oauthPath === '/authorize') {
      if (req.method === 'GET') {
        logger.debug("Handling generic OAuth authorization request", { path: oauthPath });
        await oauthProvider.handleAuthorizationRequest(req, res);
        return;
      }
    }

    // Match generic /token endpoint (MCP Inspector compatibility)
    if (oauthPath === '/token') {
      if (req.method === 'POST') {
        logger.debug("Handling generic token request", {
          path: oauthPath,
          contentType: req.headers['content-type'],
          grantType: req.body?.grant_type
        });

        try {
          const { grant_type, refresh_token } = req.body || {};

          // Determine operation based on grant_type (RFC 6749 Section 4.1.3)
          if (grant_type === 'authorization_code') {
            // Authorization Code Grant token exchange (RFC 6749 Section 4.1.3)
            // Supports PKCE (RFC 7636)
            if (oauthProvider && 'handleTokenExchange' in oauthProvider) {
              const provider = oauthProvider as any;
              await provider.handleTokenExchange(req, res);
            } else {
              res.status(501).json({
                error: 'not_implemented',
                error_description: 'Token exchange not supported by current OAuth provider'
              });
            }
          } else if (grant_type === 'refresh_token' || refresh_token) {
            // Refresh Token Grant (RFC 6749 Section 6)
            await oauthProvider.handleTokenRefresh(req, res);
          } else {
            // Invalid grant type (RFC 6749 Section 5.2)
            res.status(400).json({
              error: 'unsupported_grant_type',
              error_description: 'Supported grant types: authorization_code, refresh_token'
            });
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

    // Match authorization endpoints: /github, /google, /microsoft, /oauth
    if (oauthPath === '/github' || oauthPath === '/google' || oauthPath === '/microsoft' || oauthPath === '/oauth' || oauthPath === endpoints.authEndpoint) {
      if (req.method === 'GET') {
        logger.debug("Handling OAuth authorization request", { provider: oauthPath });
        await oauthProvider.handleAuthorizationRequest(req, res);
        return;
      }
    }

    // Match callback endpoints: /github/callback, /google/callback, etc.
    if (oauthPath.endsWith('/callback')) {
      if (req.method === 'GET') {
        logger.debug("Handling OAuth callback", { path: oauthPath });
        await oauthProvider.handleAuthorizationCallback(req, res);
        return;
      }
    }

    // Match refresh endpoints: /github/refresh, /google/refresh, etc.
    if (oauthPath.endsWith('/refresh')) {
      if (req.method === 'POST') {
        logger.debug("Handling token refresh", { path: oauthPath });
        await oauthProvider.handleTokenRefresh(req, res);
        return;
      }
    }

    // Match logout endpoints: /github/logout, /google/logout, etc.
    if (oauthPath.endsWith('/logout')) {
      if (req.method === 'POST') {
        logger.debug("Handling logout", { path: oauthPath });
        await oauthProvider.handleLogout(req, res);
        return;
      }
    }

    // If no matching endpoint found, return 404
    res.status(404).json({
      error: 'Not found',
      message: `OAuth endpoint not found: ${oauthPath}`,
      available_endpoints: endpoints
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