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
import { OAuthProviderFactory } from '../../build/auth/factory.js';
import { createOAuthDiscoveryMetadata } from '../../build/auth/discovery-metadata.js';
import type { OAuthProvider } from '../../build/auth/providers/types.js';

// Global OAuth provider instance for reuse
let oauthProviderInstance: OAuthProvider | null = null;

/**
 * Initialize OAuth provider for serverless environment
 */
async function initializeOAuthProvider() {
  if (oauthProviderInstance) {
    return oauthProviderInstance;
  }

  try {
    const provider = await OAuthProviderFactory.createFromEnvironment();
    if (provider) {
      oauthProviderInstance = provider;
      console.log(`🔐 OAuth provider initialized: ${provider.getProviderType()}`);
    }
    return provider;
  } catch (error) {
    console.error('Failed to initialize OAuth provider:', error);
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
 * Set common CORS headers
 */
function setCORSHeaders(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-protocol-version, mcp-session-id, Accept, User-Agent');
  res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
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
    const { discovery } = req.query;
    const discoveryPath = Array.isArray(discovery) ? discovery.join('/') : discovery || '';

    console.log(`📡 OAuth discovery request: /${discoveryPath}`);

    const baseUrl = getBaseUrl(req);
    const oauthProvider = await initializeOAuthProvider();

    // Route to appropriate discovery handler
    switch (discoveryPath) {
      case 'oauth-authorization-server':
        await handleAuthorizationServerMetadata(req, res, baseUrl, oauthProvider);
        break;

      case 'oauth-protected-resource':
        await handleProtectedResourceMetadata(req, res, baseUrl, oauthProvider);
        break;

      case 'oauth-protected-resource/mcp':
        await handleMCPProtectedResourceMetadata(req, res, baseUrl, oauthProvider);
        break;

      case 'openid-configuration':
        await handleOpenIDConnectConfiguration(req, res, baseUrl, oauthProvider);
        break;

      default:
        res.status(404).json({
          error: 'Discovery endpoint not found',
          message: `Unknown discovery endpoint: /${discoveryPath}`,
          available_endpoints: [
            '/.well-known/oauth-authorization-server',
            '/.well-known/oauth-protected-resource',
            '/.well-known/oauth-protected-resource/mcp',
            '/.well-known/openid-configuration'
          ]
        });
        break;
    }

  } catch (error) {
    console.error('❌ OAuth discovery endpoint error:', error);

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
 */
async function handleAuthorizationServerMetadata(
  req: VercelRequest,
  res: VercelResponse,
  baseUrl: string,
  oauthProvider: OAuthProvider | null
): Promise<void> {
  if (!oauthProvider) {
    res.json({
      error: 'OAuth not configured',
      message: 'OAuth provider not available. Configure OAuth credentials to enable authentication.',
      issuer: baseUrl,
      configuration_endpoint: `${baseUrl}/.well-known/oauth-authorization-server`
    });
    return;
  }

  const discoveryMetadata = createOAuthDiscoveryMetadata(oauthProvider, baseUrl, {
    enableResumability: false, // Default for serverless
    toolDiscoveryEndpoint: `${baseUrl}/api/mcp`
  });

  const metadata = discoveryMetadata.generateAuthorizationServerMetadata();
  res.json(metadata);
}

/**
 * Handle OAuth 2.0 Protected Resource Metadata (RFC 9728)
 */
async function handleProtectedResourceMetadata(
  req: VercelRequest,
  res: VercelResponse,
  baseUrl: string,
  oauthProvider: OAuthProvider | null
): Promise<void> {
  if (!oauthProvider) {
    res.json({
      resource: baseUrl,
      authorization_servers: [],
      resource_documentation: `${baseUrl}/docs`,
      bearer_methods_supported: ['header'],
      message: 'OAuth provider not configured'
    });
    return;
  }

  const discoveryMetadata = createOAuthDiscoveryMetadata(oauthProvider, baseUrl, {
    enableResumability: false, // Default for serverless
    toolDiscoveryEndpoint: `${baseUrl}/api/mcp`
  });

  const metadata = discoveryMetadata.generateProtectedResourceMetadata();
  res.json(metadata);
}

/**
 * Handle MCP-specific Protected Resource Metadata
 */
async function handleMCPProtectedResourceMetadata(
  req: VercelRequest,
  res: VercelResponse,
  baseUrl: string,
  oauthProvider: OAuthProvider | null
): Promise<void> {
  if (!oauthProvider) {
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

  const discoveryMetadata = createOAuthDiscoveryMetadata(oauthProvider, baseUrl, {
    enableResumability: false, // Default for serverless
    toolDiscoveryEndpoint: `${baseUrl}/api/mcp`
  });

  const metadata = discoveryMetadata.generateMCPProtectedResourceMetadata();
  res.json(metadata);
}

/**
 * Handle OpenID Connect Discovery Configuration
 */
async function handleOpenIDConnectConfiguration(
  req: VercelRequest,
  res: VercelResponse,
  baseUrl: string,
  oauthProvider: OAuthProvider | null
): Promise<void> {
  if (!oauthProvider) {
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

  const discoveryMetadata = createOAuthDiscoveryMetadata(oauthProvider, baseUrl, {
    enableResumability: false, // Default for serverless
    toolDiscoveryEndpoint: `${baseUrl}/api/mcp`
  });

  const metadata = discoveryMetadata.generateOpenIDConnectConfiguration();
  res.json(metadata);
}