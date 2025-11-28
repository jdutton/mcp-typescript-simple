/**
 * OAuth Discovery Routes
 *
 * Implements OAuth 2.0 discovery metadata endpoints:
 * - RFC 8414: OAuth 2.0 Authorization Server Metadata
 * - RFC 9728: OAuth 2.0 Protected Resource Metadata
 * - OpenID Connect Discovery 1.0
 * - MCP-specific Protected Resource Metadata
 */

import { Router, Request, Response } from 'express';
import {
  OAuthProvider,
  createOAuthDiscoveryMetadata,
} from '@mcp-typescript-simple/auth';
import { logger } from '@mcp-typescript-simple/observability';

export interface DiscoveryRoutesOptions {
  endpoint: string;
  host: string;
  port: number;
  enableResumability?: boolean;
}

/**
 * Setup OAuth discovery routes
 *
 * @param router - Express router to attach routes to
 * @param oauthProviders - OAuth providers (may be undefined if OAuth not configured)
 * @param options - Server configuration options
 */
export function setupDiscoveryRoutes(
  router: Router,
  oauthProviders: Map<string, OAuthProvider> | undefined,
  options: DiscoveryRoutesOptions
): void {
  // Helper function to get base URL for the current request
  const getBaseUrl = (req: Request): string => {
    const protocol = req.headers['x-forwarded-proto'] ?? (req.secure ? 'https' : 'http');
    const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? `${options.host}:${options.port}`;
    return `${protocol}://${host}`;
  };

  // Helper to set anti-caching headers for OAuth endpoints per RFC 6749 and RFC 9700
  const setAntiCachingHeaders = (res: Response): void => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  };

  // OAuth 2.0 Authorization Server Metadata (RFC 8414)
  router.get('/.well-known/oauth-authorization-server', async (req: Request, res: Response) => {
    try {
      if (!oauthProviders || oauthProviders.size === 0) {
        // Return minimal metadata indicating OAuth is not configured
        setAntiCachingHeaders(res);
        res.json({
          error: 'OAuth not configured',
          message: 'OAuth provider not available. Configure OAuth credentials to enable authentication.',
          issuer: getBaseUrl(req),
          configuration_endpoint: `${getBaseUrl(req)}/.well-known/oauth-authorization-server`
        });
        return;
      }

      const baseUrl = getBaseUrl(req);

      // Return generic metadata for all provider configurations
      // Provider-specific endpoints are available at /auth/{provider}/authorize etc.
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
      setAntiCachingHeaders(res);
      res.json(metadata);
    } catch (error) {
      logger.error("OAuth authorization server metadata error", error);
      setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'Failed to generate authorization server metadata',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // OAuth 2.0 Protected Resource Metadata (RFC 9728)
  router.get('/.well-known/oauth-protected-resource', async (req: Request, res: Response) => {
    try {
      if (!oauthProviders || oauthProviders.size === 0) {
        // Return minimal metadata indicating OAuth is not configured
        setAntiCachingHeaders(res);
        res.json({
          resource: getBaseUrl(req),
          authorization_servers: [],
          resource_documentation: `${getBaseUrl(req)}/docs`,
          bearer_methods_supported: ['header'],
          message: 'OAuth provider not configured'
        });
        return;
      }

      const baseUrl = getBaseUrl(req);
      const firstProviderResult = oauthProviders.values().next();
      if (!firstProviderResult.value) {
        throw new Error('OAuth provider iteration failed unexpectedly');
      }
      const firstProvider = firstProviderResult.value;
      const discoveryMetadata = createOAuthDiscoveryMetadata(firstProvider, baseUrl, {
        enableResumability: options.enableResumability,
        toolDiscoveryEndpoint: `${baseUrl}${options.endpoint}`
      });

      const metadata = discoveryMetadata.generateProtectedResourceMetadata();
      setAntiCachingHeaders(res);
      res.json(metadata);
    } catch (error) {
      logger.error("OAuth protected resource metadata error", error);
      setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'Failed to generate protected resource metadata',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // MCP-specific Protected Resource Metadata
  router.get('/.well-known/oauth-protected-resource/mcp', async (req: Request, res: Response) => {
    try {
      const baseUrl = getBaseUrl(req);

      if (!oauthProviders || oauthProviders.size === 0) {
        // Return MCP metadata even without OAuth configured
        setAntiCachingHeaders(res);
        res.json({
          resource: baseUrl,
          authorization_servers: [],
          mcp_version: '1.18.0',
          transport_capabilities: ['stdio', 'streamable_http'],
          tool_discovery_endpoint: `${baseUrl}${options.endpoint}`,
          supported_tool_types: ['function', 'text_generation', 'analysis'],
          scopes_supported: ['mcp:read', 'mcp:write'],
          session_management: {
            resumability_supported: options.enableResumability ?? false
          },
          message: 'OAuth provider not configured'
        });
        return;
      }

      const firstProviderResult = oauthProviders.values().next();
      if (!firstProviderResult.value) {
        throw new Error('OAuth provider iteration failed unexpectedly');
      }
      const firstProvider = firstProviderResult.value;
      const discoveryMetadata = createOAuthDiscoveryMetadata(firstProvider, baseUrl, {
        enableResumability: options.enableResumability,
        toolDiscoveryEndpoint: `${baseUrl}${options.endpoint}`
      });

      const metadata = discoveryMetadata.generateMCPProtectedResourceMetadata();
      setAntiCachingHeaders(res);
      res.json(metadata);
    } catch (error) {
      logger.error("MCP protected resource metadata error", error);
      setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'Failed to generate MCP protected resource metadata',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // OpenID Connect Discovery Configuration
  router.get('/.well-known/openid-configuration', async (req: Request, res: Response) => {
    try {
      if (!oauthProviders || oauthProviders.size === 0) {
        // Return minimal OpenID Connect metadata indicating OAuth is not configured
        setAntiCachingHeaders(res);
        res.json({
          issuer: getBaseUrl(req),
          authorization_endpoint: `${getBaseUrl(req)}/auth/login`,
          token_endpoint: `${getBaseUrl(req)}/auth/token`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          message: 'OAuth provider not configured'
        });
        return;
      }

      const baseUrl = getBaseUrl(req);
      const firstProviderResult = oauthProviders.values().next();
      if (!firstProviderResult.value) {
        throw new Error('OAuth provider iteration failed unexpectedly');
      }
      const firstProvider = firstProviderResult.value;
      const discoveryMetadata = createOAuthDiscoveryMetadata(firstProvider, baseUrl, {
        enableResumability: options.enableResumability,
        toolDiscoveryEndpoint: `${baseUrl}${options.endpoint}`
      });

      const metadata = discoveryMetadata.generateOpenIDConnectConfiguration();
      setAntiCachingHeaders(res);
      res.json(metadata);
    } catch (error) {
      logger.error("OpenID Connect configuration error", error);
      setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'Failed to generate OpenID Connect configuration',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // 404 handler for unknown discovery endpoints
  router.use('/.well-known', (req: Request, res: Response) => {
    // If we get here, none of the specific endpoints matched
    setAntiCachingHeaders(res);
    res.status(404).json({
      error: 'Discovery endpoint not found',
      message: `The discovery endpoint '${req.path}' was not found on this server.`,
      available_endpoints: [
        '/.well-known/oauth-authorization-server',
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-protected-resource/mcp',
        '/.well-known/openid-configuration'
      ]
    });
  });
}