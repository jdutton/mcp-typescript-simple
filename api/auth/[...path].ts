/**
 * OAuth authentication endpoints for Vercel deployment
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { OAuthProviderFactory } from '../build/auth/factory.js';
import { logger } from '../build/utils/logger.js';

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

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    // Parse the OAuth path from Vercel's catch-all route parameter
    // For /auth/github, Vercel passes query.path = ['github']
    // For /auth/github/callback, Vercel passes query.path = ['github', 'callback']
    const pathArray = Array.isArray(req.query.path) ? req.query.path : [req.query.path].filter(Boolean);
    const oauthPath = '/' + pathArray.join('/');

    logger.debug("OAuth request received", {
      method: req.method,
      path: oauthPath,
      rawPath: req.url,
      queryPath: req.query.path
    });

    // Initialize OAuth provider
    const oauthProvider = await initializeOAuthProvider();
    const endpoints = oauthProvider.getEndpoints();

    // Route to appropriate OAuth handler based on path
    // Paths come as: /github, /github/callback, /google, /google/callback, etc.

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