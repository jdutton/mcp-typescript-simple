/**
 * OAuth 2.0 Authentication Routes
 *
 * Implements OAuth 2.0 authentication flow:
 * - Authorization endpoint (RFC 6749 Section 4.1.1)
 * - Callback endpoint (RFC 6749 Section 4.1.2)
 * - Token endpoint (RFC 6749 Section 3.2)
 * - Logout endpoint
 */

import { Router, Request, Response } from 'express';
import { OAuthProvider, OAuthProviderType } from '@mcp-typescript-simple/auth';
import { OAuthRegisteredClientsStore } from '@mcp-typescript-simple/persistence';
import { setupDCRRoutes } from './dcr-routes.js';
import { logger } from '../../observability/logger.js';
import { generateLoginPageHTML } from '@mcp-typescript-simple/auth';
import { setOAuthAntiCachingHeaders } from '@mcp-typescript-simple/auth';
import { handleUniversalTokenRequest } from '@mcp-typescript-simple/auth';
import { handleUniversalRevokeRequest } from '@mcp-typescript-simple/auth';
import {
  handleProviderAuthorizationRequest,
  handleProviderAuthorizationCallback,
  handleProviderLogout,
  handleOAuthDiscovery,
  handleGenericAuthorize
} from '@mcp-typescript-simple/auth';

/**
 * Setup OAuth 2.0 authentication routes with multi-provider support
 *
 * @param router - Express router to attach routes to
 * @param providers - Map of provider type to provider instance
 * @param clientStore - Client store for DCR
 */
export function setupOAuthRoutes(
  router: Router,
  providers: Map<string, OAuthProvider>,
  clientStore: OAuthRegisteredClientsStore
): void {
  // Provider selection/login page
  router.get('/auth/login', (req: Request, res: Response) => {
    setOAuthAntiCachingHeaders(res);

    const availableProviders = Array.from(providers.keys());
    const clientState = req.query.state as string | undefined;
    const clientRedirectUri = req.query.redirect_uri as string | undefined;

    const loginHtml = generateLoginPageHTML({
      availableProviders,
      clientState,
      clientRedirectUri
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(loginHtml);
  });

  // Generic auth endpoint (discovery)
  router.get('/auth', (req: Request, res: Response) => {
    handleOAuthDiscovery(providers, res);
  });

  // Setup routes for each provider
  for (const [providerType, provider] of providers.entries()) {
    const endpoints = provider.getEndpoints();

    // Provider-specific authorization endpoint
    router.get(endpoints.authEndpoint, async (req: Request, res: Response) => {
      await handleProviderAuthorizationRequest(provider, providerType, req, res);
    });

    // Provider-specific callback endpoint
    router.get(endpoints.callbackEndpoint, async (req: Request, res: Response) => {
      await handleProviderAuthorizationCallback(provider, providerType, req, res);
    });

    // Provider-specific logout endpoint
    router.post(endpoints.logoutEndpoint, async (req: Request, res: Response) => {
      await handleProviderLogout(provider, providerType, req, res);
    });
  }

  // Generic OAuth 2.0 authorize endpoint (redirects to login page)
  router.get('/auth/authorize', (req: Request, res: Response) => {
    handleGenericAuthorize(providers, req.query as Record<string, any>, res);
  });

  // Universal OAuth 2.0 token handler (works with any provider)
  router.post('/auth/token', async (req: Request, res: Response) => {
    setOAuthAntiCachingHeaders(res);
    await handleUniversalTokenRequest(req, res, providers);
  });

  // Universal OAuth 2.0 token revocation endpoint (RFC 7009)
  router.post('/auth/revoke', async (req: Request, res: Response) => {
    setOAuthAntiCachingHeaders(res);
    await handleUniversalRevokeRequest(req, res, providers);
  });

  // OAuth 2.0 Dynamic Client Registration routes (RFC 7591/7592)
  setupDCRRoutes(router, clientStore);
}