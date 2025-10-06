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
import { OAuthProvider, OAuthProviderType } from '../../auth/providers/types.js';
import { OAuthRegisteredClientsStore } from '../../auth/stores/client-store-interface.js';
import { setupDCRRoutes } from './dcr-routes.js';
import { logger } from '../../observability/logger.js';

/**
 * Setup OAuth 2.0 authentication routes (single provider - legacy)
 *
 * @param router - Express router to attach routes to
 * @param oauthProvider - Configured OAuth provider
 * @param clientStore - Client store for DCR
 * @deprecated Use setupMultiProviderOAuthRoutes for multi-provider support
 */
export function setupOAuthRoutes(
  router: Router,
  oauthProvider: OAuthProvider,
  clientStore: OAuthRegisteredClientsStore
): void {
  const endpoints = oauthProvider.getEndpoints();

  // Helper to set anti-caching headers for OAuth endpoints (RFC 6749, RFC 9700)
  // Prevents Vercel edge cache from serving stale OAuth responses
  const setAntiCachingHeaders = (res: Response): void => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  };

  // Generic auth endpoint for test discovery
  router.get('/auth', (req: Request, res: Response) => {
    setAntiCachingHeaders(res);
    res.json({
      message: 'OAuth authentication endpoint',
      providers: ['google', 'github', 'microsoft'],
      endpoints: endpoints
    });
  });

  // OAuth authorization endpoint
  const authHandler = async (req: Request, res: Response) => {
    try {
      setAntiCachingHeaders(res);
      await oauthProvider.handleAuthorizationRequest(req, res);
    } catch (error) {
      logger.error("OAuth authorization error", error);
      setAntiCachingHeaders(res);
      res.status(500).json({ error: 'Authorization failed' });
    }
  };
  router.get(endpoints.authEndpoint, authHandler);

  // Generic OAuth authorize endpoint (for MCP Inspector compatibility) - now under /auth/authorize
  router.get('/auth/authorize', authHandler);

  // OAuth callback endpoint
  const callbackHandler = async (req: Request, res: Response) => {
    try {
      setAntiCachingHeaders(res);
      await oauthProvider.handleAuthorizationCallback(req, res);
    } catch (error) {
      logger.error("OAuth callback error", error);
      setAntiCachingHeaders(res);
      res.status(500).json({ error: 'Authorization callback failed' });
    }
  };
  router.get(endpoints.callbackEndpoint, callbackHandler);

  // Universal OAuth 2.0 token handler (RFC 6749 Section 3.2)
  // Implements OAuth 2.0 Token Endpoint for authorization_code and refresh_token grants
  // Supports both JSON and form data (RFC 6749 Section 4.1.3 and 6.1)
  const universalTokenHandler = async (req: Request, res: Response) => {
    try {
      setAntiCachingHeaders(res);

      logger.debug("Universal token handler processing", {
        contentType: req.headers['content-type'],
        body: req.body
      });

      // Extract parameters (works for both form data and JSON)
      const { grant_type, refresh_token } = req.body;

      // Determine operation based on grant_type (RFC 6749 Section 4.1.3)
      if (grant_type === 'authorization_code') {
        // Authorization Code Grant token exchange (RFC 6749 Section 4.1.3)
        // Supports PKCE (RFC 7636) - delegate to provider's handleTokenExchange
        if (oauthProvider && 'handleTokenExchange' in oauthProvider) {
          // Type assertion for providers that implement handleTokenExchange
          const provider = oauthProvider as OAuthProvider & {
            handleTokenExchange: (req: Request, res: Response) => Promise<void>
          };
          await provider.handleTokenExchange(req, res);
        } else {
          res.status(501).json({
            error: 'not_implemented',
            error_description: 'Token exchange not supported by current OAuth provider'
          });
        }
      } else if (grant_type === 'refresh_token' || refresh_token) {
        // Refresh Token Grant (RFC 6749 Section 6) - delegate to provider's handleTokenRefresh
        await oauthProvider.handleTokenRefresh(req, res);
      } else {
        // Invalid grant type (RFC 6749 Section 5.2)
        res.status(400).json({
          error: 'unsupported_grant_type',
          error_description: 'Supported grant types: authorization_code, refresh_token'
        });
      }
    } catch (error) {
      logger.error("OAuth universal token handler error", error);
      setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  };

  // Use universal handler for both provider-specific refresh endpoint and generic token endpoint
  router.post(endpoints.refreshEndpoint, universalTokenHandler);

  // Generic OAuth 2.0 token endpoint (RFC 6749 Section 3.2) - uses same universal handler
  router.post('/auth/token', universalTokenHandler);

  // Logout endpoint
  const logoutHandler = async (req: Request, res: Response) => {
    try {
      setAntiCachingHeaders(res);
      await oauthProvider.handleLogout(req, res);
    } catch (error) {
      logger.error("Logout error", error);
      setAntiCachingHeaders(res);
      res.status(500).json({ error: 'Logout failed' });
    }
  };
  router.post(endpoints.logoutEndpoint, logoutHandler);

  // OAuth 2.0 Dynamic Client Registration routes (RFC 7591/7592)
  setupDCRRoutes(router, clientStore);
}

/**
 * Setup OAuth 2.0 authentication routes with multi-provider support
 *
 * @param router - Express router to attach routes to
 * @param providers - Map of provider type to provider instance
 * @param clientStore - Client store for DCR
 */
export function setupMultiProviderOAuthRoutes(
  router: Router,
  providers: Map<string, OAuthProvider>,
  clientStore: OAuthRegisteredClientsStore
): void {
  // Helper to set anti-caching headers for OAuth endpoints (RFC 6749, RFC 9700)
  const setAntiCachingHeaders = (res: Response): void => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  };

  // Provider selection/login page
  router.get('/auth/login', (req: Request, res: Response) => {
    setAntiCachingHeaders(res);

    const availableProviders = Array.from(providers.keys());
    const clientState = req.query.state as string | undefined;
    const clientRedirectUri = req.query.redirect_uri as string | undefined;

    const loginHtml = `
<!DOCTYPE html>
<html>
  <head>
    <title>Sign in to MCP Server</title>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      .login-container {
        background: white;
        border-radius: 12px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        max-width: 400px;
        width: 100%;
        padding: 40px;
      }
      h1 {
        font-size: 28px;
        font-weight: 600;
        color: #1a202c;
        margin-bottom: 12px;
        text-align: center;
      }
      .subtitle {
        color: #718096;
        text-align: center;
        margin-bottom: 32px;
        font-size: 14px;
      }
      .provider-buttons {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .provider-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 14px 24px;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        background: white;
        color: #2d3748;
        font-size: 16px;
        font-weight: 500;
        cursor: pointer;
        text-decoration: none;
        transition: all 0.2s;
        gap: 12px;
      }
      .provider-btn:hover {
        border-color: #667eea;
        background: #f7fafc;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
      }
      .provider-icon {
        width: 24px;
        height: 24px;
      }
      .google { border-color: #4285f4; }
      .google:hover { border-color: #4285f4; background: #f8fbff; }
      .github { border-color: #24292e; }
      .github:hover { border-color: #24292e; background: #f6f8fa; }
      .microsoft { border-color: #00a4ef; }
      .microsoft:hover { border-color: #00a4ef; background: #f0f9ff; }
      .footer {
        margin-top: 32px;
        text-align: center;
        color: #a0aec0;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <div class="login-container">
      <h1>Sign in to MCP Server</h1>
      <p class="subtitle">Choose your authentication provider</p>
      <div class="provider-buttons">
        ${availableProviders.includes('google') ? `
          <a href="/auth/google${clientState ? `?state=${encodeURIComponent(clientState)}` : ''}${clientRedirectUri ? `${clientState ? '&' : '?'}redirect_uri=${encodeURIComponent(clientRedirectUri)}` : ''}" class="provider-btn google">
            <svg class="provider-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </a>
        ` : ''}
        ${availableProviders.includes('github') ? `
          <a href="/auth/github${clientState ? `?state=${encodeURIComponent(clientState)}` : ''}${clientRedirectUri ? `${clientState ? '&' : '?'}redirect_uri=${encodeURIComponent(clientRedirectUri)}` : ''}" class="provider-btn github">
            <svg class="provider-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path fill="#24292e" d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            Continue with GitHub
          </a>
        ` : ''}
        ${availableProviders.includes('microsoft') ? `
          <a href="/auth/microsoft${clientState ? `?state=${encodeURIComponent(clientState)}` : ''}${clientRedirectUri ? `${clientState ? '&' : '?'}redirect_uri=${encodeURIComponent(clientRedirectUri)}` : ''}" class="provider-btn microsoft">
            <svg class="provider-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path fill="#f25022" d="M0 0h11.377v11.372H0z"/>
              <path fill="#00a4ef" d="M12.623 0H24v11.372H12.623z"/>
              <path fill="#7fba00" d="M0 12.628h11.377V24H0z"/>
              <path fill="#ffb900" d="M12.623 12.628H24V24H12.623z"/>
            </svg>
            Continue with Microsoft
          </a>
        ` : ''}
      </div>
      <div class="footer">
        <p>Secured with OAuth 2.0</p>
      </div>
    </div>
  </body>
</html>
    `.trim();

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(loginHtml);
  });

  // Generic auth endpoint (discovery)
  router.get('/auth', (req: Request, res: Response) => {
    setAntiCachingHeaders(res);
    res.json({
      message: 'OAuth authentication endpoint',
      providers: Array.from(providers.keys()),
      endpoints: {
        login: '/login',
        authorize: '/authorize',
        token: '/token'
      }
    });
  });

  // Setup routes for each provider
  for (const [providerType, provider] of providers.entries()) {
    const endpoints = provider.getEndpoints();

    // Provider-specific authorization endpoint
    const authHandler = async (req: Request, res: Response) => {
      try {
        setAntiCachingHeaders(res);
        await provider.handleAuthorizationRequest(req, res);
      } catch (error) {
        logger.error("OAuth authorization error", { provider: providerType, error });
        setAntiCachingHeaders(res);
        res.status(500).json({ error: 'Authorization failed' });
      }
    };
    router.get(endpoints.authEndpoint, authHandler);

    // Provider-specific callback endpoint
    const callbackHandler = async (req: Request, res: Response) => {
      try {
        setAntiCachingHeaders(res);
        await provider.handleAuthorizationCallback(req, res);
      } catch (error) {
        logger.error("OAuth callback error", { provider: providerType, error });
        setAntiCachingHeaders(res);
        res.status(500).json({ error: 'Authorization callback failed' });
      }
    };
    router.get(endpoints.callbackEndpoint, callbackHandler);

    // Provider-specific logout endpoint
    const logoutHandler = async (req: Request, res: Response) => {
      try {
        setAntiCachingHeaders(res);
        await provider.handleLogout(req, res);
      } catch (error) {
        logger.error("Logout error", { provider: providerType, error });
        setAntiCachingHeaders(res);
        res.status(500).json({ error: 'Logout failed' });
      }
    };
    router.post(endpoints.logoutEndpoint, logoutHandler);
  }

  // Generic OAuth 2.0 authorize endpoint (redirects to login page)
  router.get('/auth/authorize', (req: Request, res: Response) => {
    setAntiCachingHeaders(res);

    // If only one provider, redirect directly
    if (providers.size === 1) {
      const [providerType] = providers.keys();
      const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
      res.redirect(302, `/auth/${providerType}/authorize${queryString ? `?${queryString}` : ''}`);
      return;
    }

    // Multiple providers - redirect to login page
    const queryString = new URLSearchParams(req.query as Record<string, string>).toString();
    res.redirect(302, `/auth/login${queryString ? `?${queryString}` : ''}`);
  });

  // Universal OAuth 2.0 token handler (works with any provider)
  const universalTokenHandler = async (req: Request, res: Response) => {
    try {
      setAntiCachingHeaders(res);

      const { grant_type, refresh_token, code } = req.body;

      logger.debug("Multi-provider token handler", { grant_type, hasCode: !!code, hasRefreshToken: !!refresh_token });

      // For authorization code exchange, we need to determine which provider issued the code
      // Strategy: Check which provider has a stored code_verifier for this authorization code
      // This is more efficient and accurate than trying each provider sequentially
      if (grant_type === 'authorization_code') {
        // Find the correct provider by checking who has the authorization code
        let correctProvider: OAuthProvider | null = null;
        let correctProviderType: OAuthProviderType | null = null;

        for (const [providerType, provider] of providers.entries()) {
          if ('hasStoredCodeForProvider' in provider) {
            const hasCode = await (provider as any).hasStoredCodeForProvider(code);
            if (hasCode) {
              correctProvider = provider;
              correctProviderType = providerType as OAuthProviderType;
              logger.debug("Found provider for authorization code", { provider: providerType });
              break;
            }
          }
        }

        // If no stored code found, try each provider (fallback for direct OAuth flows)
        if (!correctProvider) {
          logger.debug("No stored code_verifier found, trying each provider");
          const errors: Array<{ provider: string; error: string }> = [];

          for (const [providerType, provider] of providers.entries()) {
            // Skip if response already sent by previous provider attempt
            if (res.headersSent) {
              logger.debug("Response already sent, stopping provider iteration");
              return;
            }

            if ('handleTokenExchange' in provider) {
              try {
                logger.debug("Trying token exchange with provider", { provider: providerType });
                const tokenProvider = provider as OAuthProvider & {
                  handleTokenExchange: (req: Request, res: Response) => Promise<void>
                };
                await tokenProvider.handleTokenExchange(req, res);
                logger.debug("Token exchange succeeded", { provider: providerType });
                return; // Success - response already sent
              } catch (error) {
                // Only collect error if response wasn't sent (provider didn't send error response)
                if (!res.headersSent) {
                  const errorMsg = error instanceof Error ? error.message : String(error);
                  logger.debug("Token exchange failed with provider", { provider: providerType, error: errorMsg });
                  errors.push({ provider: providerType, error: errorMsg });
                } else {
                  logger.debug("Provider sent error response, stopping iteration");
                  return;
                }
                // Try next provider
                continue;
              }
            }
          }

          // No provider succeeded - return detailed error (only if no response sent)
          if (!res.headersSent) {
            logger.warn("Token exchange failed with all providers", { errors });
            res.status(400).json({
              error: 'invalid_grant',
              error_description: 'The provided authorization grant is invalid or expired',
              details: errors
            });
          }
          return;
        }

        // Use the correct provider
        if (correctProvider && 'handleTokenExchange' in correctProvider) {
          try {
            logger.debug("Using correct provider for token exchange", { provider: correctProviderType });
            const tokenProvider = correctProvider as OAuthProvider & {
              handleTokenExchange: (req: Request, res: Response) => Promise<void>
            };
            await tokenProvider.handleTokenExchange(req, res);
            logger.debug("Token exchange succeeded", { provider: correctProviderType });
            return; // Success
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error("Token exchange failed with correct provider", { provider: correctProviderType, error: errorMsg });
            res.status(400).json({
              error: 'invalid_grant',
              error_description: errorMsg
            });
            return;
          }
        }

        // This code is unreachable - errors variable is in the fallback block above
        // If we reach here, no providers were available
        logger.warn("No OAuth providers available for token exchange");
        res.status(400).json({
          error: 'invalid_grant',
          error_description: 'No OAuth providers available'
        });
      } else if (grant_type === 'refresh_token' || refresh_token) {
        // For refresh tokens, try each provider
        for (const provider of providers.values()) {
          try {
            await provider.handleTokenRefresh(req, res);
            return; // Success
          } catch (error) {
            // Try next provider
            continue;
          }
        }

        // No provider succeeded
        res.status(400).json({
          error: 'invalid_grant',
          error_description: 'The provided refresh token is invalid or expired'
        });
      } else {
        res.status(400).json({
          error: 'unsupported_grant_type',
          error_description: 'Supported grant types: authorization_code, refresh_token'
        });
      }
    } catch (error) {
      logger.error("OAuth universal token handler error", error);
      setAntiCachingHeaders(res);
      res.status(500).json({
        error: 'server_error',
        error_description: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  };

  router.post('/auth/token', universalTokenHandler);

  // OAuth 2.0 Dynamic Client Registration routes (RFC 7591/7592)
  setupDCRRoutes(router, clientStore);
}