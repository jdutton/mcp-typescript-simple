/**
 * Universal OAuth Token Revocation Handler
 *
 * Implements RFC 7009 OAuth 2.0 Token Revocation endpoint logic.
 * Works with any provider and handles multi-provider token lookup.
 *
 * This shared implementation eliminates code duplication between Express
 * and Vercel serverless deployments.
 */

import { OAuthProvider } from '../providers/types.js';
import { logger } from '../utils/logger.js';
import {
  OAuthRequestAdapter,
  OAuthResponseAdapter,
  sendOAuthError,
  sendOAuthSuccess
} from './oauth-helpers.js';

/**
 * Handle universal OAuth 2.0 token revocation request (RFC 7009)
 *
 * Per RFC 7009 Section 2.2:
 * "The authorization server responds with HTTP status code 200 if the token
 * has been revoked successfully or if the client submitted an invalid token"
 *
 * @param req - Request adapter
 * @param res - Response adapter
 * @param providers - Map of available OAuth providers
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export async function handleUniversalRevokeRequest(
  req: OAuthRequestAdapter,
  res: OAuthResponseAdapter,
  providers: Map<string, OAuthProvider>
): Promise<void> {
  try {
    // Extract token parameter (RFC 7009 Section 2.1)
    const { token } = req.body ?? {};

    // Validate required token parameter
    if (!token || typeof token !== 'string' || token.trim() === '') {
      sendOAuthError(
        res,
        400,
        'invalid_request',
        'Missing or invalid token parameter'
      );
      return;
    }

    // Try to revoke token from each provider
    // RFC 7009 Section 2.2: "The authorization server responds with HTTP status code 200
    // if the token has been revoked successfully or if the client submitted an invalid token"
    for (const [providerType, provider] of providers.entries()) {
      try {
        // Check if provider has this token
        if ('getToken' in provider) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const storedToken = await (provider as any).getToken(token);
          if (storedToken) {
            // Remove token from provider's store
            await provider.removeToken(token);
            logger.debug('Token revoked successfully', { provider: providerType });
            break; // Token found and removed, stop searching
          }
        } else {
          // If provider doesn't support getToken, try removing anyway
          await provider.removeToken(token);
          logger.debug('Token removal attempted', { provider: providerType });
          break;
        }
      } catch (error) {
        // Per RFC 7009 Section 2.2: "invalid tokens do not cause an error"
        // Continue trying other providers
        logger.debug('Token removal failed, trying next provider', { provider: providerType, error });
        continue;
      }
    }

    // Always return 200 OK per RFC 7009 (even if token not found)
    sendOAuthSuccess(res, { success: true });
  } catch (error) {
    logger.error('OAuth universal revoke handler error', error);
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
