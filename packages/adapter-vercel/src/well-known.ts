/**
 * OAuth Discovery endpoints for Vercel deployment
 *
 * Handles all /.well-known/* discovery endpoints:
 * - /.well-known/oauth-authorization-server (RFC 8414)
 * - /.well-known/oauth-protected-resource (RFC 9728)
 * - /.well-known/oauth-protected-resource/mcp (MCP-specific)
 * - /.well-known/openid-configuration (OpenID Connect Discovery)
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { OAuthProviderFactory } from '@mcp-typescript-simple/auth/factory';
import { createOAuthDiscoveryMetadata } from '@mcp-typescript-simple/auth/discovery-metadata';
import type { OAuthProvider } from '@mcp-typescript-simple/auth/providers/types';
import { logger } from '@mcp-typescript-simple/observability/logger';
import { setOAuthAntiCachingHeaders } from './_utils/headers.js';

// Global OAuth providers map for multi-provider support
let oauthProvidersInstance: Map<string, OAuthProvider> | null = null;

/**
 * Initialize OAuth providers for serverless environment (multi-provider support)
 */
async function initializeOAuthProviders(): Promise<Map<string, OAuthProvider> | null> {
  // Only return cached instance if it exists and has providers
  if (oauthProvidersInstance && oauthProvidersInstance.size > 0) {
    logger.info("Returning cached OAuth providers", {
      providers: Array.from(oauthProvidersInstance.keys())
    });
    return oauthProvidersInstance;
  }

  logger.info("Initializing OAuth providers from environment", {
    hasGoogleId: !!process.env.GOOGLE_CLIENT_ID,
    hasGoogleSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    hasGithubId: !!process.env.GITHUB_CLIENT_ID,
    hasGithubSecret: !!process.env.GITHUB_CLIENT_SECRET,
  });

  try {
    const providers = await OAuthProviderFactory.createAllFromEnvironment();
    logger.info("OAuth provider creation completed", {
      success: !!providers,
      count: providers?.size ?? 0,
      providers: providers ? Array.from(providers.keys()) : []
    });

    if (providers && providers.size > 0) {
      oauthProvidersInstance = providers;
      logger.info("Multi-provider OAuth initialized for discovery endpoints", {
        providers: Array.from(providers.keys()),
        count: providers.size
      });
      return providers;
    }
    // Don't cache null - retry on next request
    logger.warn("No OAuth providers configured in environment");
    return null;
  } catch (error) {
    // Don't cache errors - retry on next request
    logger.error("Failed to initialize OAuth providers", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return null;
  }
}

/**
 * Get base URL from Vercel request
 */
function getBaseUrl(req: VercelRequest): string {
  const protocol = req.headers['x-forwarded-proto'] ?? 'https';
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  return `${protocol}://${host}`;
}

/**
 * Set common CORS headers and anti-caching headers
 */
function setCORSHeaders(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-protocol-version, mcp-session-id, Accept, User-Agent');

  // Set anti-caching headers for OAuth endpoints (RFC 6749, RFC 9700)
  setOAuthAntiCachingHeaders(res);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    setCORSHeaders(res);

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    // Only allow GET requests for discovery endpoints
    if (req.method !== 'GET') {
      res.status(405).json({
        error: 'Method not allowed',
        message: 'Only GET requests are supported for discovery endpoints'
      });
      return;
    }

    // Parse the discovery path from the URL
    // Extract path after /.well-known/
    let discoveryPath = '';
    if (req.url) {
      const match = req.url.match(/\/\.well-known\/(.+?)(?:\?|$)/);
      if (match?.[1]) {
        discoveryPath = match[1];
      }
    }

    logger.info("OAuth discovery request received", {
      path: `/${discoveryPath}`,
      rawUrl: req.url,
      query: req.query
    });

    const baseUrl = getBaseUrl(req);
    const oauthProviders = await initializeOAuthProviders();

    // Route to appropriate discovery handler
    switch (discoveryPath) {
      case 'oauth-authorization-server':
        await handleAuthorizationServerMetadata(req, res, baseUrl, oauthProviders);
        break;

      case 'oauth-protected-resource':
        await handleProtectedResourceMetadata(req, res, baseUrl, oauthProviders);
        break;

      case 'oauth-protected-resource/mcp':
      case 'mcp-oauth-discovery': // Legacy endpoint for older MCP Inspector versions
        await handleMCPProtectedResourceMetadata(req, res, baseUrl, oauthProviders);
        break;

      case 'openid-configuration':
        await handleOpenIDConnectConfiguration(req, res, baseUrl, oauthProviders);
        break;

      default:
        res.status(404).json({
          error: 'Discovery endpoint not found',
          message: `Unknown discovery endpoint: /${discoveryPath}`,
          available_endpoints: [
            '/.well-known/oauth-authorization-server',
            '/.well-known/oauth-protected-resource',
            '/.well-known/oauth-protected-resource/mcp',
            '/.well-known/mcp-oauth-discovery',
            '/.well-known/openid-configuration'
          ]
        });
        break;
    }

  } catch (error) {
    logger.error("OAuth discovery endpoint error", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Discovery endpoint failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

/**
 * Handle OAuth 2.0 Authorization Server Metadata (RFC 8414)
 * Multi-provider support: Returns metadata for all configured providers
 */
async function handleAuthorizationServerMetadata(
  req: VercelRequest,
  res: VercelResponse,
  baseUrl: string,
  oauthProviders: Map<string, OAuthProvider> | null
): Promise<void> {
  if (!oauthProviders || oauthProviders.size === 0) {
    res.json({
      error: 'OAuth not configured',
      message: 'OAuth provider not available. Configure OAuth credentials to enable authentication.',
      issuer: baseUrl,
      configuration_endpoint: `${baseUrl}/.well-known/oauth-authorization-server`
    });
    return;
  }

  // For multi-provider setups, return generic metadata without provider-specific URLs
  // This prevents OAuth clients from making incorrect assumptions about provider-specific endpoints
  if (oauthProviders.size > 1) {
    const metadata = {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/auth/authorize`,
      token_endpoint: `${baseUrl}/auth/token`,
      registration_endpoint: `${baseUrl}/register`,
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      scopes_supported: ['openid', 'profile', 'email'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      available_providers: Array.from(oauthProviders.keys()),
      provider_selection_endpoint: `${baseUrl}/auth/login`
    };
    res.json(metadata);
    return;
  }

  // Single provider: use provider-specific metadata for backward compatibility
  const primaryProvider = oauthProviders.values().next().value;
  if (!primaryProvider) {
    res.status(500).json({ error: 'No OAuth provider available' });
    return;
  }

  const discoveryMetadata = createOAuthDiscoveryMetadata(primaryProvider, baseUrl, {
    enableResumability: false,
    toolDiscoveryEndpoint: `${baseUrl}/mcp`
  });

  res.json(discoveryMetadata.generateAuthorizationServerMetadata());
}

/**
 * Handle OAuth 2.0 Protected Resource Metadata (RFC 9728)
 * Multi-provider support: Returns metadata with all authorization servers
 */
async function handleProtectedResourceMetadata(
  req: VercelRequest,
  res: VercelResponse,
  baseUrl: string,
  oauthProviders: Map<string, OAuthProvider> | null
): Promise<void> {
  if (!oauthProviders || oauthProviders.size === 0) {
    res.json({
      resource: baseUrl,
      authorization_servers: [],
      resource_documentation: `${baseUrl}/docs`,
      bearer_methods_supported: ['header'],
      message: 'OAuth provider not configured'
    });
    return;
  }

  // Use first provider for base metadata
  const primaryProvider = oauthProviders.values().next().value;
  if (!primaryProvider) {
    res.status(500).json({ error: 'No OAuth provider available' });
    return;
  }

  const discoveryMetadata = createOAuthDiscoveryMetadata(primaryProvider, baseUrl, {
    enableResumability: false, // Default for serverless
    toolDiscoveryEndpoint: `${baseUrl}/mcp`
  });

  const metadata = discoveryMetadata.generateProtectedResourceMetadata();

  // Add all provider authorization servers
  if (oauthProviders.size > 1) {
    const authServers: string[] = [];
    for (const providerType of oauthProviders.keys()) {
      authServers.push(`${baseUrl}/auth/${providerType}`);
    }
    (metadata as any).authorization_servers = authServers;
    (metadata as any).available_providers = Array.from(oauthProviders.keys());
  }

  res.json(metadata);
}

/**
 * Handle MCP-specific Protected Resource Metadata
 * Multi-provider support: Returns MCP metadata with all providers
 */
async function handleMCPProtectedResourceMetadata(
  req: VercelRequest,
  res: VercelResponse,
  baseUrl: string,
  oauthProviders: Map<string, OAuthProvider> | null
): Promise<void> {
  if (!oauthProviders || oauthProviders.size === 0) {
    res.json({
      resource: baseUrl,
      authorization_servers: [],
      mcp_version: '1.18.0',
      transport_capabilities: ['streamable_http'],
      tool_discovery_endpoint: `${baseUrl}/mcp`,
      supported_tool_types: ['function', 'text_generation', 'analysis'],
      session_management: {
        resumability_supported: false // Default for serverless
      },
      message: 'OAuth provider not configured'
    });
    return;
  }

  // Use first provider for base metadata
  const primaryProvider = oauthProviders.values().next().value;
  if (!primaryProvider) {
    res.status(500).json({ error: 'No OAuth provider available' });
    return;
  }

  const discoveryMetadata = createOAuthDiscoveryMetadata(primaryProvider, baseUrl, {
    enableResumability: false, // Default for serverless
    toolDiscoveryEndpoint: `${baseUrl}/mcp`
  });

  const metadata = discoveryMetadata.generateMCPProtectedResourceMetadata();

  // Add multi-provider information
  if (oauthProviders.size > 1) {
    const authServers: string[] = [];
    for (const providerType of oauthProviders.keys()) {
      authServers.push(`${baseUrl}/auth/${providerType}`);
    }
    (metadata as any).authorization_servers = authServers;
    (metadata as any).available_providers = Array.from(oauthProviders.keys());
    (metadata as any).provider_selection_endpoint = `${baseUrl}/auth/login`;
  }

  res.json(metadata);
}

/**
 * Handle OpenID Connect Discovery Configuration
 * Multi-provider support: Returns OIDC metadata for primary provider
 */
async function handleOpenIDConnectConfiguration(
  req: VercelRequest,
  res: VercelResponse,
  baseUrl: string,
  oauthProviders: Map<string, OAuthProvider> | null
): Promise<void> {
  if (!oauthProviders || oauthProviders.size === 0) {
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/auth/login`,
      token_endpoint: `${baseUrl}/auth/token`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      message: 'OAuth provider not configured'
    });
    return;
  }

  // Use first provider for base metadata
  const primaryProvider = oauthProviders.values().next().value;
  if (!primaryProvider) {
    res.status(500).json({ error: 'No OAuth provider available' });
    return;
  }

  const discoveryMetadata = createOAuthDiscoveryMetadata(primaryProvider, baseUrl, {
    enableResumability: false, // Default for serverless
    toolDiscoveryEndpoint: `${baseUrl}/mcp`
  });

  const metadata = discoveryMetadata.generateOpenIDConnectConfiguration();

  // Add multi-provider hint
  if (oauthProviders.size > 1) {
    (metadata as any).available_providers = Array.from(oauthProviders.keys());
    (metadata as any).provider_selection_endpoint = `${baseUrl}/auth/login`;
  }

  res.json(metadata);
}