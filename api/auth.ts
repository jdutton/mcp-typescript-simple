/**
 * OAuth authentication endpoints for Vercel deployment
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { OAuthProviderFactory } from '../build/auth/factory.js';

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
    console.log(`🔐 OAuth provider initialized: ${provider.getProviderType()}`);
    return provider;
  } catch (error) {
    console.error('Failed to initialize OAuth provider:', error);
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

    // Parse the URL path to determine the OAuth endpoint
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const pathSegments = url.pathname.split('/').filter(Boolean);

    // Remove 'api' and 'auth' from path segments to get the actual OAuth path
    const oauthPath = '/' + pathSegments.slice(2).join('/');

    console.log(`📡 OAuth request: ${req.method} ${oauthPath}`);

    // Initialize OAuth provider
    const oauthProvider = await initializeOAuthProvider();
    const endpoints = oauthProvider.getEndpoints();

    // Route to appropriate OAuth handler based on path
    if (oauthPath === endpoints.authEndpoint || oauthPath.startsWith('/google') || oauthPath.startsWith('/github') || oauthPath.startsWith('/microsoft') || oauthPath.startsWith('/oauth')) {
      // Authorization endpoint
      if (req.method === 'GET') {
        console.log('🚀 Handling OAuth authorization request');
        await oauthProvider.handleAuthorizationRequest(req, res);
        return;
      }
    }

    if (oauthPath.includes('/callback')) {
      // Callback endpoint
      if (req.method === 'GET') {
        console.log('🔄 Handling OAuth callback');
        await oauthProvider.handleAuthorizationCallback(req, res);
        return;
      }
    }

    if (oauthPath.includes('/refresh')) {
      // Token refresh endpoint
      if (req.method === 'POST') {
        console.log('🔄 Handling token refresh');
        await oauthProvider.handleTokenRefresh(req, res);
        return;
      }
    }

    if (oauthPath.includes('/logout')) {
      // Logout endpoint
      if (req.method === 'POST') {
        console.log('👋 Handling logout');
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
    console.error('❌ OAuth endpoint error:', error);

    if (!res.headersSent) {
      res.status(500).json({
        error: 'OAuth authentication failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}