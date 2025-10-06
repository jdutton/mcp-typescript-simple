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
import { OAuthProviderFactory } from '../build/auth/factory.js';
import { createOAuthDiscoveryMetadata } from '../build/auth/discovery-metadata.js';
import type { OAuthProvider } from '../build/auth/providers/types.js';
import { logger } from '../build/utils/logger.js';
import { setOAuthAntiCachingHeaders } from './_utils/headers.js';

// Global OAuth providers map for multi-provider support
let oauthProvidersInstance: Map<string, OAuthProvider> | null = null;

/**
 * Initialize OAuth providers for serverless environment (multi-provider support)
 */
async function initializeOAuthProviders(): Promise<Map<string, OAuthProvider> | null> {
  if (oauthProvidersInstance) {
    return oauthProvidersInstance;
  }

  try {
    const providers = await OAuthProviderFactory.createAllFromEnvironment();
    if (providers && providers.size > 0) {
      oauthProvidersInstance = providers;
      logger.info("Multi-provider OAuth initialized for discovery endpoints", {
        providers: Array.from(providers.keys()),
        count: providers.size
      });
      return providers;
    }
    return null;
  } catch (error) {
    logger.error("Failed to initialize OAuth providers", error);
    return null;
  }
}

/**
 * Get base URL from Vercel request
 */
function getBaseUrl(req: VercelRequest): string {
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
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
      if (match && match[1]) {
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

  // Use first provider for backward compatibility (clients expect single metadata response)
  // Note: Multi-provider clients should query per-provider endpoints or use MCP metadata
  const primaryProvider = oauthProviders.values().next().value;

  const discoveryMetadata = createOAuthDiscoveryMetadata(primaryProvider, baseUrl, {
    enableResumability: false, // Default for serverless
    toolDiscoveryEndpoint: `${baseUrl}/api/mcp`
  });

  const metadata = discoveryMetadata.generateAuthorizationServerMetadata();

  // Add multi-provider hint
  if (oauthProviders.size > 1) {
    (metadata as any).available_providers = Array.from(oauthProviders.keys());
    (metadata as any).provider_selection_endpoint = `${baseUrl}/api/auth/login`;
  }

  res.json(metadata);
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

  const discoveryMetadata = createOAuthDiscoveryMetadata(primaryProvider, baseUrl, {
    enableResumability: false, // Default for serverless
    toolDiscoveryEndpoint: `${baseUrl}/api/mcp`
  });

  const metadata = discoveryMetadata.generateProtectedResourceMetadata();

  // Add all provider authorization servers
  if (oauthProviders.size > 1) {
    const authServers: string[] = [];
    for (const providerType of oauthProviders.keys()) {
      authServers.push(`${baseUrl}/api/auth/${providerType}`);
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
      tool_discovery_endpoint: `${baseUrl}/api/mcp`,
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

  const discoveryMetadata = createOAuthDiscoveryMetadata(primaryProvider, baseUrl, {
    enableResumability: false, // Default for serverless
    toolDiscoveryEndpoint: `${baseUrl}/api/mcp`
  });

  const metadata = discoveryMetadata.generateMCPProtectedResourceMetadata();

  // Add multi-provider information
  if (oauthProviders.size > 1) {
    const authServers: string[] = [];
    for (const providerType of oauthProviders.keys()) {
      authServers.push(`${baseUrl}/api/auth/${providerType}`);
    }
    (metadata as any).authorization_servers = authServers;
    (metadata as any).available_providers = Array.from(oauthProviders.keys());
    (metadata as any).provider_selection_endpoint = `${baseUrl}/api/auth/login`;
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
      authorization_endpoint: `${baseUrl}/api/auth/login`,
      token_endpoint: `${baseUrl}/api/auth/token`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      message: 'OAuth provider not configured'
    });
    return;
  }

  // Use first provider for base metadata
  const primaryProvider = oauthProviders.values().next().value;

  const discoveryMetadata = createOAuthDiscoveryMetadata(primaryProvider, baseUrl, {
    enableResumability: false, // Default for serverless
    toolDiscoveryEndpoint: `${baseUrl}/api/mcp`
  });

  const metadata = discoveryMetadata.generateOpenIDConnectConfiguration();

  // Add multi-provider hint
  if (oauthProviders.size > 1) {
    (metadata as any).available_providers = Array.from(oauthProviders.keys());
    (metadata as any).provider_selection_endpoint = `${baseUrl}/api/auth/login`;
  }

  res.json(metadata);
}