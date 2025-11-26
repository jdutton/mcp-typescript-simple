/**
 * Shared OAuth Provider Routing Logic
 *
 * Handles provider-specific OAuth routes (authorize, callback, logout)
 * in a platform-agnostic way that works with both Express and Vercel.
 *
 * This shared implementation eliminates code duplication between Express
 * and Vercel serverless deployments.
 */

import { OAuthProvider } from '../providers/types.js';
import { logger } from '../utils/logger.js';
import {
  OAuthRequestAdapter,
  OAuthResponseAdapter,
  setOAuthAntiCachingHeaders,
  sendOAuthError
} from './oauth-helpers.js';

/**
 * Handle provider-specific authorization request
 *
 * Initiates OAuth flow with the specified provider.
 *
 * @param provider - OAuth provider instance
 * @param providerType - Provider type (google, github, microsoft)
 * @param req - Request adapter
 * @param res - Response adapter
 */
export async function handleProviderAuthorizationRequest(
  provider: OAuthProvider,
  providerType: string,
  req: OAuthRequestAdapter,
  res: OAuthResponseAdapter
): Promise<void> {
  try {
    setOAuthAntiCachingHeaders(res);
    await provider.handleAuthorizationRequest(req as unknown as Parameters<OAuthProvider['handleAuthorizationRequest']>[0], res as unknown as Parameters<OAuthProvider['handleAuthorizationRequest']>[1]);
  } catch (error) {
    logger.error("OAuth authorization error", { provider: providerType, error });
    sendOAuthError(res, 500, 'server_error', 'Authorization failed');
  }
}

/**
 * Handle provider-specific authorization callback
 *
 * Processes OAuth callback from provider after user authorization.
 *
 * @param provider - OAuth provider instance
 * @param providerType - Provider type (google, github, microsoft)
 * @param req - Request adapter
 * @param res - Response adapter
 */
export async function handleProviderAuthorizationCallback(
  provider: OAuthProvider,
  providerType: string,
  req: OAuthRequestAdapter,
  res: OAuthResponseAdapter
): Promise<void> {
  try {
    setOAuthAntiCachingHeaders(res);
    await provider.handleAuthorizationCallback(req as unknown as Parameters<OAuthProvider['handleAuthorizationCallback']>[0], res as unknown as Parameters<OAuthProvider['handleAuthorizationCallback']>[1]);
  } catch (error) {
    logger.error("OAuth callback error", { provider: providerType, error });
    sendOAuthError(res, 500, 'server_error', 'Authorization callback failed');
  }
}

/**
 * Handle provider-specific logout request
 *
 * Logs user out from the specified provider.
 *
 * @param provider - OAuth provider instance
 * @param providerType - Provider type (google, github, microsoft)
 * @param req - Request adapter
 * @param res - Response adapter
 */
export async function handleProviderLogout(
  provider: OAuthProvider,
  providerType: string,
  req: OAuthRequestAdapter,
  res: OAuthResponseAdapter
): Promise<void> {
  try {
    setOAuthAntiCachingHeaders(res);
    await provider.handleLogout(req as unknown as Parameters<OAuthProvider['handleLogout']>[0], res as unknown as Parameters<OAuthProvider['handleLogout']>[1]);
  } catch (error) {
    logger.error("Logout error", { provider: providerType, error });
    sendOAuthError(res, 500, 'server_error', 'Logout failed');
  }
}

/**
 * Handle generic /auth discovery endpoint
 *
 * Returns information about available OAuth providers and endpoints.
 *
 * @param providers - Map of available OAuth providers
 * @param res - Response adapter
 */
export function handleOAuthDiscovery(
  providers: Map<string, OAuthProvider>,
  res: OAuthResponseAdapter
): void {
  setOAuthAntiCachingHeaders(res);
  res.status(200).json({
    message: 'OAuth authentication endpoint',
    providers: Array.from(providers.keys()),
    endpoints: {
      login: '/auth/login',
      authorize: '/auth/authorize',
      token: '/auth/token',
      revoke: '/auth/revoke'
    }
  });
}

/**
 * Handle generic /authorize endpoint
 *
 * Redirects to provider selection page or directly to provider if only one configured.
 *
 * @param providers - Map of available OAuth providers
 * @param query - Request query parameters
 * @param res - Response adapter
 */
export function handleGenericAuthorize(
  providers: Map<string, OAuthProvider>,
  query: Record<string, unknown>,
  res: OAuthResponseAdapter
): void {
  setOAuthAntiCachingHeaders(res);

  // If only one provider, redirect directly
  if (providers.size === 1) {
    const [providerType] = providers.keys();
    const queryString = new URLSearchParams(query as Record<string, string>).toString();
    const redirectUrl = `/auth/${providerType}${queryString ? `?${queryString}` : ''}`;

    if (res.redirect) {
      res.redirect(302, redirectUrl);
    } else {
      // Fallback for platforms without redirect method
      res.status(302).setHeader('Location', redirectUrl);
      res.json({ redirect: redirectUrl });
    }
    return;
  }

  // Multiple providers - redirect to login page
  const queryString = new URLSearchParams(query as Record<string, string>).toString();
  const redirectUrl = `/auth/login${queryString ? `?${queryString}` : ''}`;

  if (res.redirect) {
    res.redirect(302, redirectUrl);
  } else {
    // Fallback for platforms without redirect method
    res.status(302).setHeader('Location', redirectUrl);
    res.json({ redirect: redirectUrl });
  }
}
