/**
 * Universal OAuth Token Handler
 *
 * Implements OAuth 2.0 token endpoint logic that works with any provider.
 * Supports both authorization_code and refresh_token grant types.
 *
 * This shared implementation eliminates code duplication between Express
 * and Vercel serverless deployments.
 */

import { OAuthProvider, OAuthProviderType } from '../providers/types.js';
import { logger } from '../../observability/logger.js';
import {
  OAuthRequestAdapter,
  OAuthResponseAdapter,
  sendOAuthError
} from './oauth-helpers.js';

/**
 * Handle universal OAuth 2.0 token request
 *
 * Supports:
 * - Authorization code grant (RFC 6749 Section 4.1.3)
 * - Refresh token grant (RFC 6749 Section 6)
 * - Multi-provider routing with O(1) lookups
 *
 * @param req - Request adapter
 * @param res - Response adapter
 * @param providers - Map of available OAuth providers
 */
export async function handleUniversalTokenRequest(
  req: OAuthRequestAdapter,
  res: OAuthResponseAdapter,
  providers: Map<string, OAuthProvider>
): Promise<void> {
  try {
    const { grant_type, refresh_token, code } = req.body || {};

    logger.debug("Multi-provider token handler", {
      grant_type,
      hasCode: !!code,
      hasRefreshToken: !!refresh_token
    });

    // Authorization Code Grant - find correct provider (two-phase approach)
    if (grant_type === 'authorization_code') {
      await handleAuthorizationCodeGrant(req, res, providers, code);
      return;
    }

    // Refresh Token Grant - O(1) provider lookup
    if (grant_type === 'refresh_token' || refresh_token) {
      await handleRefreshTokenGrant(req, res, providers, refresh_token);
      return;
    }

    // Invalid grant type
    sendOAuthError(
      res,
      400,
      'unsupported_grant_type',
      'Supported grant types: authorization_code, refresh_token'
    );
  } catch (error) {
    logger.error("OAuth universal token handler error", error);
    if (!res.headersSent) {
      sendOAuthError(
        res,
        500,
        'server_error',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

/**
 * Handle authorization code grant
 *
 * Phase 1: Find which provider issued the authorization code
 * Phase 2: Use that provider to exchange code for tokens
 *
 * @param req - Request adapter
 * @param res - Response adapter
 * @param providers - Map of available OAuth providers
 * @param code - Authorization code
 */
async function handleAuthorizationCodeGrant(
  req: OAuthRequestAdapter,
  res: OAuthResponseAdapter,
  providers: Map<string, OAuthProvider>,
  code: string
): Promise<void> {
  // Log request details for debugging (redact sensitive fields)
  logger.debug("Token exchange request body", {
    grant_type: 'authorization_code',
    code: code?.substring(0, 10) + '...',
    hasCodeVerifier: !!req.body?.code_verifier,
    codeVerifierPrefix: req.body?.code_verifier?.substring(0, 8),
    hasClientId: !!req.body?.client_id,
    hasRedirectUri: !!req.body?.redirect_uri,
    allBodyKeys: Object.keys(req.body || {})
  });

  // Find the correct provider by checking who has the authorization code
  let correctProvider: OAuthProvider | null = null;
  let correctProviderType: OAuthProviderType | null = null;

  logger.info("Searching for provider with stored authorization code", {
    codePrefix: code?.substring(0, 10),
    availableProviders: Array.from(providers.keys())
  });

  for (const [providerType, provider] of providers.entries()) {
    if ('hasStoredCodeForProvider' in provider) {
      const hasCode = await (provider as any).hasStoredCodeForProvider(code);
      logger.info("Provider code check result", {
        provider: providerType,
        hasCode,
        codePrefix: code?.substring(0, 10)
      });
      if (hasCode) {
        correctProvider = provider;
        correctProviderType = providerType as OAuthProviderType;
        logger.info("Found provider for authorization code", { provider: providerType });
        break;
      }
    }
  }

  // No stored code_verifier found - this indicates either:
  // 1. Direct OAuth flow where client should provide code_verifier
  // 2. Authorization code expired or already used
  // 3. Wrong provider tried (code issued by different provider)
  if (!correctProvider) {
    logger.error("No provider found for authorization code", {
      codePrefix: code?.substring(0, 10),
      availableProviders: Array.from(providers.keys()),
      hasCodeVerifier: !!req.body?.code_verifier,
      message: 'Authorization code not found in any provider PKCE store. Either code expired, already used, or client must provide code_verifier for direct OAuth flow.'
    });

    sendOAuthError(
      res,
      400,
      'invalid_grant',
      'The provided authorization grant is invalid, expired, or was issued by a different provider'
    );
    return;
  }

  // Use the correct provider for token exchange
  if (correctProvider && 'handleTokenExchange' in correctProvider) {
    try {
      logger.debug("Using correct provider for token exchange", { provider: correctProviderType });
      const tokenProvider = correctProvider as OAuthProvider & {
        handleTokenExchange: (req: any, res: any) => Promise<void>
      };
      await tokenProvider.handleTokenExchange(req as any, res as any);
      logger.debug("Token exchange succeeded", { provider: correctProviderType });
      return;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("Token exchange failed with correct provider", {
        provider: correctProviderType,
        error: errorMsg
      });
      sendOAuthError(res, 400, 'invalid_grant', errorMsg);
      return;
    }
  }

  // No providers were available (should never reach here)
  logger.warn("No OAuth providers available for token exchange");
  sendOAuthError(res, 400, 'invalid_grant', 'No OAuth providers available');
}

/**
 * Handle refresh token grant
 *
 * Phase 1: Look up token in store to find owning provider (O(1))
 * Phase 2: Use that provider to refresh the token
 *
 * @param req - Request adapter
 * @param res - Response adapter
 * @param providers - Map of available OAuth providers
 * @param refresh_token - Refresh token
 */
async function handleRefreshTokenGrant(
  req: OAuthRequestAdapter,
  res: OAuthResponseAdapter,
  providers: Map<string, OAuthProvider>,
  refresh_token: string
): Promise<void> {
  // Optimized refresh token routing: Look up token first to determine correct provider
  let correctProvider: OAuthProvider | null = null;
  let correctProviderType: string | null = null;

  // Get token store from any provider (they all share the same store)
  const firstProvider = providers.values().next().value;
  if (firstProvider && 'getTokenStore' in firstProvider) {
    const tokenStore = (firstProvider as any).getTokenStore();

    try {
      const tokenData = await tokenStore.findByRefreshToken(refresh_token);

      if (tokenData && tokenData.tokenInfo) {
        const providerType = tokenData.tokenInfo.provider;
        correctProvider = providers.get(providerType) || null;
        correctProviderType = providerType;

        if (correctProvider) {
          logger.debug('Routing refresh token to correct provider', { provider: correctProviderType });
        }
      }
    } catch (error) {
      // Token store lookup failed, fallback to sequential approach
      logger.debug('Token store lookup failed, falling back to sequential provider trial', { error });
    }
  }

  // If we found the correct provider, use it directly
  if (correctProvider) {
    try {
      await correctProvider.handleTokenRefresh(req as any, res as any);
      return; // Success
    } catch (error) {
      // Correct provider failed, don't try others
      logger.error('Token refresh failed with correct provider', { provider: correctProviderType, error });
      sendOAuthError(
        res,
        400,
        'invalid_grant',
        error instanceof Error ? error.message : 'The provided refresh token is invalid or expired'
      );
      return;
    }
  }

  // Fallback: Try each provider (for direct OAuth flows or if lookup failed)
  logger.debug('Trying each provider for refresh token');
  for (const provider of providers.values()) {
    try {
      await provider.handleTokenRefresh(req as any, res as any);
      return; // Success
    } catch (error) {
      // Try next provider
      continue;
    }
  }

  // No provider succeeded
  sendOAuthError(
    res,
    400,
    'invalid_grant',
    'The provided refresh token is invalid or expired'
  );
}
