/**
 * HTTP server for handling Streamable HTTP transport with OAuth authentication
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer, Server as HttpServer } from 'http';
import helmet from 'helmet';
import cors from 'cors';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { EnvironmentConfig } from '../config/environment.js';
import { OAuthProviderFactory } from '../auth/factory.js';
import { OAuthProvider, OAuthUserInfo } from '../auth/providers/types.js';
import { SessionManager } from '../session/session-manager.js';
import { EventStoreFactory } from '../session/event-store.js';
import { createOAuthDiscoveryMetadata } from '../auth/discovery-metadata.js';
import { logger } from '../utils/logger.js';

export interface StreamableHttpServerOptions {
  port: number;
  host: string;
  endpoint: string;
  requireAuth: boolean;
  allowedOrigins?: string[];
  allowedHosts?: string[];
  sessionSecret: string;
  enableResumability?: boolean;
  enableJsonResponse?: boolean;
}

type AuthenticatedRequest = Request & { auth?: AuthInfo };

/**
 * HTTP server that provides Streamable HTTP endpoints with OAuth authentication
 */
export class MCPStreamableHttpServer {
  private app: Express;
  private server?: HttpServer;
  private oauthProvider?: OAuthProvider;
  private sessionManager: SessionManager;
  private streamableTransportHandler?: (transport: StreamableHTTPServerTransport) => Promise<void>;
  private sessionTransports: Map<string, StreamableHTTPServerTransport> = new Map();

  constructor(private options: StreamableHttpServerOptions) {
    this.app = express();

    // Create session manager with optional event store
    const eventStore = options.enableResumability
      ? EventStoreFactory.createEventStore('memory')
      : undefined;

    this.sessionManager = new SessionManager(eventStore);

    this.setupMiddleware();
    this.setupNonOAuthRoutes();
  }

  /**
   * Initialize async components like OAuth
   */
  async initialize(): Promise<void> {
    // OAuth routes (only if auth is required)
    if (this.options.requireAuth) {
      await this.setupOAuthRoutes();
    }

    // Set up streamable HTTP routes after OAuth provider is configured
    this.setupStreamableHTTPRoutes();
  }

  /**
   * Set up Express middleware for security and functionality
   */
  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false, // Required for streaming
    }));

    // CORS configuration with configurable origins
    const defaultOrigins = [
      'http://localhost:3000',
      'http://localhost:8080',
      'http://127.0.0.1:3000',
      'http://localhost:6274', // MCP Inspector default port
      'http://localhost:6273', // Alternative MCP Inspector port
    ];

    const corsOptions: cors.CorsOptions = {
      origin: this.options.allowedOrigins || defaultOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Last-Event-ID',
        'mcp-protocol-version', // MCP Inspector protocol version header
        'mcp-session-id',       // MCP session ID header
        'Accept',               // Standard accept header
        'User-Agent',           // Standard user agent header
      ],
      optionsSuccessStatus: 200, // Some legacy browsers (IE11, various SmartTVs) choke on 204
    };
    this.app.use(cors(corsOptions));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Comprehensive request logging middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const requestId = Math.random().toString(36).substring(2, 15);
      const startTime = Date.now();

      // Add request ID to request object for correlation
      (req as Request & { requestId: string }).requestId = requestId;

      // Sanitize auth header for logging
      const authHeader = req.headers.authorization;
      const sanitizedAuth = authHeader
        ? authHeader.startsWith('Bearer ')
          ? `Bearer ${authHeader.substring(7, 15)}...${authHeader.substring(authHeader.length - 8)}`
          : authHeader.substring(0, 20) + '...'
        : 'none';

      // Log incoming request
      logger.debug("Incoming request", {
        requestId,
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path,
        client: req.ip,
        userAgent: req.headers['user-agent'] || 'unknown',
        auth: sanitizedAuth,
        contentType: req.headers['content-type'] || 'none',
        bodySize: req.headers['content-length'] || 'unknown',
        accept: req.headers.accept
      });

      // Log request body for MCP endpoint (with size limit)
      if (req.path === this.options.endpoint && req.method === 'POST' && req.body) {
        try {
          const bodyStr = JSON.stringify(req.body);
          if (bodyStr.length < 1000) {
            logger.debug("Request body", { requestId, body: bodyStr });
          } else {
            logger.debug("Request body (truncated)", {
              requestId,
              bodyPreview: bodyStr.substring(0, 500),
              totalLength: bodyStr.length
            });
          }
        } catch (error) {
          logger.debug("Request body stringify failed", { requestId, error });
        }
      }

      // Hook into multiple response methods to capture all responses
      const mcpEndpoint = this.options.endpoint;

      // Hook res.send()
      const originalSend = res.send;
      res.send = function(data) {
        const duration = Date.now() - startTime;
        logger.debug("Response sent", {
          requestId,
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          duration
        });

        // Log response body for MCP endpoint (with size limit)
        if (req.path === mcpEndpoint && data) {
          try {
            const responseStr = typeof data === 'string' ? data : JSON.stringify(data);
            if (responseStr.length < 1000) {
              logger.debug("Response body", { requestId, body: responseStr });
            } else {
              logger.debug("Response body (truncated)", {
                requestId,
                bodyPreview: responseStr.substring(0, 500),
                totalLength: responseStr.length
              });
            }
          } catch (error) {
            logger.debug("Response body stringify failed", { requestId, error });
          }
        }

        return originalSend.call(this, data);
      };

      // Hook res.write() for streaming responses
      const originalWrite = res.write;
      res.write = function(chunk: unknown, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) {
        if (req.path === mcpEndpoint) {
          const chunkStr = chunk ? chunk.toString() : 'empty';
          logger.debug("Streaming chunk written", {
            requestId,
            chunkPreview: chunkStr.substring(0, 200),
            truncated: chunkStr.length > 200
          });
        }
        return originalWrite.call(this, chunk, encoding as BufferEncoding, callback);
      };

      // Hook res.end() for final response
      const originalEnd = res.end;
      res.end = function(chunk?: unknown, encoding?: BufferEncoding | (() => void), callback?: () => void) {
        const duration = Date.now() - startTime;
        logger.debug("Response ended", {
          requestId,
          statusCode: res.statusCode,
          duration
        });

        if (req.path === mcpEndpoint) {
          const contentType = res.getHeader('content-type');
          const contentLength = res.getHeader('content-length');
          logger.debug("Final response headers", {
            requestId,
            contentType: contentType || 'none',
            contentLength: contentLength || 'none'
          });

          if (chunk && req.path === mcpEndpoint) {
            try {
              const chunkStr = chunk.toString();
              if (chunkStr.length < 500) {
                logger.debug("Final chunk", { requestId, chunk: chunkStr });
              } else {
                logger.debug("Final chunk (truncated)", {
                  requestId,
                  chunkPreview: chunkStr.substring(0, 200)
                });
              }
            } catch (error) {
              logger.debug("Final chunk stringify failed", { requestId, error });
            }
          }
        }

        return originalEnd.call(this, chunk, encoding as BufferEncoding, callback);
      };

      next();
    });
  }

  /**
   * Set up non-OAuth routes (called from constructor)
   */
  private setupNonOAuthRoutes(): void {
    // Health check endpoint
    const healthHandler = (req: Request, res: Response) => {
      const sessionStats = this.sessionManager.getStats();

      // Check OAuth credentials availability
      const oauthProvider = process.env.OAUTH_PROVIDER || 'google';
      const hasOAuthCredentials = EnvironmentConfig.checkOAuthCredentials(oauthProvider);

      // Check LLM providers
      const llmProviders = EnvironmentConfig.checkLLMProviders();

      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        deployment: 'local',
        mode: 'streamable_http',
        auth: hasOAuthCredentials ? 'enabled' : 'disabled',
        oauth_provider: oauthProvider,
        llm_providers: llmProviders,
        version: process.env.npm_package_version || '1.0.0',
        node_version: process.version,
        environment: process.env.NODE_ENV || 'development',
        sessions: sessionStats,
        performance: {
          uptime_seconds: process.uptime(),
          memory_usage: process.memoryUsage(),
        },
        features: {
          resumability: this.options.enableResumability || false,
          jsonResponse: this.options.enableJsonResponse || false,
        },
      });
    };

    // Register health endpoints for both standalone and Vercel deployments
    this.app.get('/health', healthHandler);

    // Debug endpoint for GitHub OAuth troubleshooting
    this.app.get('/debug/github-oauth', async (req: Request, res: Response) => {
      try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
          res.status(400).json({
            error: 'Missing Authorization header',
            message: 'Provide Authorization: Bearer YOUR_TOKEN header'
          });
          return;
        }

        logger.debug("Testing GitHub API access", { tokenPreview: token.substring(0, 10) + '...' });

        // Test GitHub user API
        const userResponse = await fetch('https://api.github.com/user', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'MCP-TypeScript-Server-Debug',
          },
        });

        const userData = userResponse.ok ? await userResponse.json() : await userResponse.text();

        // Test GitHub emails API
        const emailResponse = await fetch('https://api.github.com/user/emails', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'MCP-TypeScript-Server-Debug',
          },
        });

        const emailData = emailResponse.ok ? await emailResponse.json() : await emailResponse.text();

        res.json({
          debug_info: {
            timestamp: new Date().toISOString(),
            token_preview: token.substring(0, 10) + '...',
          },
          github_user_api: {
            status: userResponse.status,
            status_text: userResponse.statusText,
            headers: Object.fromEntries(userResponse.headers.entries()),
            data: userData
          },
          github_emails_api: {
            status: emailResponse.status,
            status_text: emailResponse.statusText,
            headers: Object.fromEntries(emailResponse.headers.entries()),
            data: emailData
          },
          oauth_provider_info: this.oauthProvider ? {
            type: this.oauthProvider.getProviderType(),
            name: this.oauthProvider.getProviderName(),
            endpoints: this.oauthProvider.getEndpoints()
          } : 'No OAuth provider configured'
        });

      } catch (error) {
        logger.error("Debug endpoint error", error);
        res.status(500).json({
          error: 'Debug test failed',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });

    // OAuth discovery endpoints (available even without OAuth enabled)
    this.setupOAuthDiscoveryRoutes();

    // OAuth routes will be set up in initialize() method

    // Streamable HTTP routes will be set up in initialize() method
    // after OAuth provider setup

    // Session management routes
    this.setupSessionRoutes();

    // Catch-all error handler with enhanced logging
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    this.app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
      const requestId = (req as Request & { requestId?: string }).requestId || 'unknown';

      logger.error("Express error handler caught error", {
        requestId,
        errorName: error.name,
        errorMessage: error.message,
        method: req.method,
        path: req.path,
        stack: error.stack
      });

      // Log additional context for auth errors
      if (error.message.includes('auth') || error.message.includes('token') || error.message.includes('Bearer')) {
        const authHeaderPresent = !!req.headers.authorization;
        let sanitizedAuth: string | undefined;

        if (req.headers.authorization) {
          sanitizedAuth = req.headers.authorization.startsWith('Bearer ')
            ? `Bearer ${req.headers.authorization.substring(7, 19)}...${req.headers.authorization.substring(req.headers.authorization.length - 8)}`
            : req.headers.authorization.substring(0, 20) + '...';
        }

        logger.error("Auth error context", {
          requestId,
          authHeaderPresent,
          sanitizedAuth
        });
      }

      // Don't send response if headers already sent
      if (!res.headersSent) {
        const statusCode = error.name === 'UnauthorizedError' || error.message.includes('auth') ? 401 : 500;
        logger.debug("Sending error response", { requestId, statusCode });

        if (statusCode === 401) {
          res.status(401).json({
            error: 'Unauthorized',
            message: EnvironmentConfig.isDevelopment() ? error.message : 'Something went wrong',
            requestId: requestId,
            timestamp: new Date().toISOString()
          });
        } else {
          res.status(statusCode).json({
            error: 'Internal server error',
            message: EnvironmentConfig.isDevelopment() ? error.message : 'Something went wrong',
            requestId: requestId,
            timestamp: new Date().toISOString()
          });
        }
      } else {
        logger.warn("Headers already sent, cannot send error response", { requestId });
      }
    });
  }


  /**
   * Set up OAuth discovery endpoints (RFC 8414, RFC 9728, OpenID Connect Discovery)
   */
  private setupOAuthDiscoveryRoutes(): void {
    // Helper function to get base URL for the current request
    const getBaseUrl = (req: Request): string => {
      const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
      const host = req.headers['x-forwarded-host'] || req.headers.host || `${this.options.host}:${this.options.port}`;
      return `${protocol}://${host}`;
    };

    // Helper to set anti-caching headers for OAuth endpoints per RFC 6749 and RFC 9700
    const setAntiCachingHeaders = (res: Response): void => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    };

    // OAuth 2.0 Authorization Server Metadata (RFC 8414)
    this.app.get('/.well-known/oauth-authorization-server', async (req: Request, res: Response) => {
      try {
        if (!this.oauthProvider) {
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
        const discoveryMetadata = createOAuthDiscoveryMetadata(this.oauthProvider, baseUrl, {
          enableResumability: this.options.enableResumability,
          toolDiscoveryEndpoint: `${baseUrl}${this.options.endpoint}`
        });

        const metadata = discoveryMetadata.generateAuthorizationServerMetadata();
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
    this.app.get('/.well-known/oauth-protected-resource', async (req: Request, res: Response) => {
      try {
        if (!this.oauthProvider) {
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
        const discoveryMetadata = createOAuthDiscoveryMetadata(this.oauthProvider, baseUrl, {
          enableResumability: this.options.enableResumability,
          toolDiscoveryEndpoint: `${baseUrl}${this.options.endpoint}`
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
    this.app.get('/.well-known/oauth-protected-resource/mcp', async (req: Request, res: Response) => {
      try {
        const baseUrl = getBaseUrl(req);

        if (!this.oauthProvider) {
          // Return MCP metadata even without OAuth configured
          setAntiCachingHeaders(res);
          res.json({
            resource: baseUrl,
            authorization_servers: [],
            mcp_version: '1.18.0',
            transport_capabilities: ['stdio', 'streamable_http'],
            tool_discovery_endpoint: `${baseUrl}${this.options.endpoint}`,
            supported_tool_types: ['function', 'text_generation', 'analysis'],
            scopes_supported: ['mcp:read', 'mcp:write'],
            session_management: {
              resumability_supported: this.options.enableResumability || false
            },
            message: 'OAuth provider not configured'
          });
          return;
        }

        const discoveryMetadata = createOAuthDiscoveryMetadata(this.oauthProvider, baseUrl, {
          enableResumability: this.options.enableResumability,
          toolDiscoveryEndpoint: `${baseUrl}${this.options.endpoint}`
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
    this.app.get('/.well-known/openid-configuration', async (req: Request, res: Response) => {
      try {
        if (!this.oauthProvider) {
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
        const discoveryMetadata = createOAuthDiscoveryMetadata(this.oauthProvider, baseUrl, {
          enableResumability: this.options.enableResumability,
          toolDiscoveryEndpoint: `${baseUrl}${this.options.endpoint}`
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
    this.app.use('/.well-known', (req: Request, res: Response) => {
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

  /**
   * Set up OAuth authentication routes with multi-provider support
   */
  private async setupOAuthRoutes(): Promise<void> {
    // Create OAuth provider from environment
    const provider = await OAuthProviderFactory.createFromEnvironment();
    if (!provider) {
      const env = EnvironmentConfig.get();
      const providerType = env.OAUTH_PROVIDER;

      if (!providerType) {
        throw new Error('OAuth authentication is required but no OAuth provider is configured. Set OAUTH_PROVIDER environment variable (google, github, or microsoft) and provide the corresponding credentials.');
      } else {
        throw new Error(`OAuth authentication is required but the configured provider "${providerType}" could not be initialized. Check your OAuth credentials and configuration.`);
      }
    }
    this.oauthProvider = provider;

    const endpoints = this.oauthProvider.getEndpoints();

    // Generic auth endpoint for test discovery
    this.app.get('/auth', (req: Request, res: Response) => {
      res.json({
        message: 'OAuth authentication endpoint',
        providers: ['google', 'github', 'microsoft'],
        endpoints: endpoints
      });
    });

    // OAuth authorization endpoint
    const authHandler = async (req: Request, res: Response) => {
      try {
        await this.oauthProvider!.handleAuthorizationRequest(req, res);
      } catch (error) {
        logger.error("OAuth authorization error", error);
        res.status(500).json({ error: 'Authorization failed' });
      }
    };
    this.app.get(endpoints.authEndpoint, authHandler);

    // Generic OAuth authorize endpoint (for MCP Inspector compatibility)
    this.app.get('/authorize', authHandler);

    // OAuth callback endpoint
    const callbackHandler = async (req: Request, res: Response) => {
      try {
        await this.oauthProvider!.handleAuthorizationCallback(req, res);
      } catch (error) {
        logger.error("OAuth callback error", error);
        res.status(500).json({ error: 'Authorization callback failed' });
      }
    };
    this.app.get(endpoints.callbackEndpoint, callbackHandler);

    // Universal OAuth 2.0 token handler (RFC 6749 Section 3.2)
    // Implements OAuth 2.0 Token Endpoint for authorization_code and refresh_token grants
    // Supports both JSON and form data (RFC 6749 Section 4.1.3 and 6.1)
    const universalTokenHandler = async (req: Request, res: Response) => {
      try {
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
          if (this.oauthProvider && 'handleTokenExchange' in this.oauthProvider) {
            // Type assertion for providers that implement handleTokenExchange
            const provider = this.oauthProvider as OAuthProvider & {
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
          await this.oauthProvider!.handleTokenRefresh(req, res);
        } else {
          // Invalid grant type (RFC 6749 Section 5.2)
          res.status(400).json({
            error: 'unsupported_grant_type',
            error_description: 'Supported grant types: authorization_code, refresh_token'
          });
        }
      } catch (error) {
        logger.error("OAuth universal token handler error", error);
        res.status(500).json({
          error: 'server_error',
          error_description: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        });
      }
    };

    // Use universal handler for both provider-specific refresh endpoint and generic token endpoint
    this.app.post(endpoints.refreshEndpoint, universalTokenHandler);

    // Generic OAuth 2.0 token endpoint (RFC 6749 Section 3.2) - uses same universal handler
    this.app.post('/token', universalTokenHandler);

    // Logout endpoint
    const logoutHandler = async (req: Request, res: Response) => {
      try {
        await this.oauthProvider!.handleLogout(req, res);
      } catch (error) {
        logger.error("Logout error", error);
        res.status(500).json({ error: 'Logout failed' });
      }
    };
    this.app.post(endpoints.logoutEndpoint, logoutHandler);
  }

  /**
   * Set up Streamable HTTP endpoints for MCP communication
   */
  private setupStreamableHTTPRoutes(): void {
    // Create custom auth middleware with logging
    const authMiddleware = this.options.requireAuth && this.oauthProvider
      ? (req: Request, res: Response, next: NextFunction) => {
          const requestId = (req as Request & { requestId?: string }).requestId || 'unknown';
          logger.debug("Auth middleware verifying Bearer token", { requestId });

          const bearerAuthMiddleware = requireBearerAuth({ verifier: this.oauthProvider! });
          bearerAuthMiddleware(req, res, (error?: unknown) => {
            if (error) {
              logger.error("Auth failed", {
                requestId,
                error: error instanceof Error ? error.message : error
              });
              return next(error);
            }

            const authInfo = (req as AuthenticatedRequest).auth;
            if (authInfo) {
              const userInfo = authInfo.extra?.userInfo as OAuthUserInfo | undefined;
              logger.info("Auth success", {
                requestId,
                clientId: authInfo.clientId,
                scopes: authInfo.scopes?.join(', ') || 'none',
                user: userInfo ? (userInfo.email || userInfo.sub || 'unknown') : undefined
              });
            } else {
              logger.warn("Auth info missing despite successful verification", { requestId });
            }

            next();
          });
        }
      : (req: Request, res: Response, next: NextFunction) => {
          const requestId = (req as Request & { requestId?: string }).requestId || 'unknown';
          logger.debug("Auth middleware bypassed (auth not required)", { requestId });
          next();
        };

    // Streamable HTTP endpoint (GET, POST, DELETE)
    const mcpHandler = async (req: Request, res: Response): Promise<void> => {
      const requestId = (req as Request & { requestId?: string }).requestId || 'unknown';

      try {
        logger.debug("MCP handler starting Streamable HTTP processing", {
          requestId,
          method: req.method,
          authRequired: this.options.requireAuth
        });

        // Handle DELETE method for session cleanup
        if (req.method === 'DELETE') {
          await this.handleSessionCleanup(req, res, requestId);
          return;
        }

        // Log JSON-RPC details for POST requests
        this.logJsonRpcRequest(req, requestId);

        // Get or create transport for the session
        const transport = await this.getOrCreateTransport(req, requestId);

        logger.debug("Handling request with Streamable HTTP transport", { requestId });

        // Set up response monitoring
        const { originalWrite, originalEnd, responseDataCaptured } = this.setupResponseMonitoring(res, requestId);

        // Connect transport to MCP server
        await this.connectTransportToServer(transport, requestId);

        // Process the request
        await this.processTransportRequest(transport, req, res, requestId);

        logger.debug("Response data captured", {
          requestId,
          captured: responseDataCaptured.captured
        });

        // Restore original methods
        res.write = originalWrite;
        res.end = originalEnd;

      } catch (error) {
        logger.error("Streamable HTTP request error", {
          requestId,
          error,
          stack: error instanceof Error ? error.stack : 'No stack trace'
        });

        if (!res.headersSent) {
          const statusCode = (error as Error & { statusCode?: number }).statusCode || 500;
          logger.debug("Sending error response", { requestId, statusCode });

          if (statusCode === 503) {
            res.status(503).json({
              error: 'Service temporarily unavailable',
              message: 'MCP server handler not initialized',
              requestId
            });
          } else {
            res.status(500).json({ error: 'Failed to process Streamable HTTP request' });
          }
        } else {
          logger.warn("Response already sent, cannot send error response", { requestId });
        }
      }
    };
    this.app.all(this.options.endpoint, authMiddleware, mcpHandler);
  }

  /**
   * Handle DELETE requests for session cleanup
   */
  private async handleSessionCleanup(req: Request, res: Response, requestId: string): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string;

    if (!sessionId) {
      logger.warn("DELETE request missing mcp-session-id header", { requestId });
      res.status(400).json({
        error: 'Bad Request',
        message: 'DELETE requests require mcp-session-id header',
        requestId: requestId,
        timestamp: new Date().toISOString()
      });
      return;
    }

    logger.info("Session cleanup requested", { requestId, sessionId });

    if (this.sessionTransports.has(sessionId)) {
      const transport = this.sessionTransports.get(sessionId)!;

      try {
        await transport.close();
        logger.debug("Transport closed for session", { requestId, sessionId });
      } catch (error) {
        logger.error("Error closing transport for session", {
          requestId,
          sessionId,
          error
        });
      }

      this.sessionTransports.delete(sessionId);
      this.sessionManager.closeSession(sessionId);

      logger.info("Session successfully cleaned up", { requestId, sessionId });
      res.status(200).json({
        message: 'Session successfully terminated',
        sessionId: sessionId,
        requestId: requestId,
        timestamp: new Date().toISOString()
      });
    } else {
      logger.warn("Session not found or already cleaned up", { requestId, sessionId });
      res.status(404).json({
        error: 'Session Not Found',
        message: `Session ${sessionId} not found or already terminated`,
        sessionId: sessionId,
        requestId: requestId,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Log JSON-RPC request details for debugging
   */
  private logJsonRpcRequest(req: Request, requestId: string): void {
    if (req.method === 'POST' && req.body) {
      try {
        const jsonrpcRequest = req.body;
        if (jsonrpcRequest.jsonrpc && jsonrpcRequest.method) {
          logger.debug("JSON-RPC request", {
            requestId,
            method: jsonrpcRequest.method,
            id: jsonrpcRequest.id,
            version: jsonrpcRequest.jsonrpc
          });

          if (jsonrpcRequest.params) {
            if (jsonrpcRequest.method === 'initialize') {
              logger.debug("Initialize request", {
                requestId,
                protocolVersion: jsonrpcRequest.params.protocolVersion,
                clientInfo: jsonrpcRequest.params.clientInfo,
                capabilities: jsonrpcRequest.params.capabilities
              });
            } else if (jsonrpcRequest.method === 'tools/list') {
              logger.debug("Tools list request", { requestId });
            } else if (jsonrpcRequest.method === 'tools/call') {
              logger.debug("Tool call", {
                requestId,
                toolName: jsonrpcRequest.params.name,
                arguments: jsonrpcRequest.params.arguments
              });
            } else {
              const paramsStr = JSON.stringify(jsonrpcRequest.params);
              logger.debug("JSON-RPC params", {
                requestId,
                params: paramsStr.length > 200 ? paramsStr.substring(0, 200) : paramsStr,
                truncated: paramsStr.length > 200
              });
            }
          }
        } else {
          logger.warn("Non-JSON-RPC request body detected", { requestId });
        }
      } catch (error) {
        logger.error("Failed to parse JSON-RPC request", { requestId, error });
      }
    }
  }

  /**
   * Get existing transport or create a new one for the session
   */
  private async getOrCreateTransport(req: Request, requestId: string): Promise<StreamableHTTPServerTransport> {
    const existingSessionId = req.headers['mcp-session-id'] as string;

    if (existingSessionId && this.sessionTransports.has(existingSessionId)) {
      logger.debug("Reusing existing transport for session", {
        requestId,
        sessionId: existingSessionId
      });
      return this.sessionTransports.get(existingSessionId)!;
    }

    logger.debug("Creating new transport for session", {
      requestId,
      sessionId: existingSessionId || 'new'
    });
    const transport = this.createNewTransport(req, requestId);

    // Store transport for future session reuse (will be updated with actual sessionId in handleSessionInitialized)
    if (existingSessionId) {
      this.sessionTransports.set(existingSessionId, transport);
    }

    return transport;
  }

  /**
   * Create a new StreamableHTTPServerTransport
   */
  private createNewTransport(req: Request, requestId: string): StreamableHTTPServerTransport {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => {
        const sessionId = this.sessionManager.generateSessionId();
        logger.debug("Generated session ID", { requestId, sessionId });
        return sessionId;
      },
      onsessioninitialized: async (sessionId: string) => {
        // Store transport with the actual generated session ID
        this.sessionTransports.set(sessionId, transport);
        logger.debug("Stored transport for session", { requestId, sessionId });
        await this.handleSessionInitialized(req, sessionId, requestId);
      },
      onsessionclosed: async (sessionId: string) => {
        await this.handleSessionClosed(sessionId, requestId);
      },
      enableJsonResponse: this.options.enableJsonResponse ?? EnvironmentConfig.get().MCP_LEGACY_CLIENT_SUPPORT,
      eventStore: this.options.enableResumability
        ? EventStoreFactory.createEventStore('memory')
        : undefined,
      allowedHosts: this.options.allowedHosts,
      allowedOrigins: this.options.allowedOrigins,
      enableDnsRebindingProtection: !!(this.options.allowedHosts || this.options.allowedOrigins),
    });

    return transport;
  }

  /**
   * Handle session initialization
   */
  private async handleSessionInitialized(req: Request, sessionId: string, requestId: string): Promise<void> {
    const authInfo = (req as AuthenticatedRequest).auth;

    logger.info("New Streamable HTTP session initialized", {
      requestId,
      sessionId,
      authStatus: authInfo ? 'authenticated' : 'anonymous'
    });

    if (authInfo) {
      logger.debug("Session auth details", {
        requestId,
        clientId: authInfo.clientId,
        scopes: authInfo.scopes?.join(', ') || 'none'
      });
    }

    try {
      this.sessionManager.createSession(authInfo);
      const stats = this.sessionManager.getStats();
      logger.info("Session stats", {
        requestId,
        totalSessions: stats.totalSessions,
        activeSessions: stats.activeSessions
      });
    } catch (error) {
      logger.error("Failed to create session", { requestId, error });
    }
  }

  /**
   * Handle session closure
   */
  private async handleSessionClosed(sessionId: string, requestId: string): Promise<void> {
    logger.info("Streamable HTTP session closed", { requestId, sessionId });

    this.sessionTransports.delete(sessionId);
    logger.debug("Removed transport for session", { requestId, sessionId });

    try {
      this.sessionManager.closeSession(sessionId);
      const stats = this.sessionManager.getStats();
      logger.info("Session stats after close", {
        requestId,
        totalSessions: stats.totalSessions,
        activeSessions: stats.activeSessions
      });
    } catch (error) {
      logger.error("Failed to close session", { requestId, error });
    }
  }

  /**
   * Set up response monitoring to capture transport output
   */
  private setupResponseMonitoring(res: Response, requestId: string): {
    originalWrite: typeof res.write;
    originalEnd: typeof res.end;
    responseDataCaptured: { captured: boolean };
  } {
    const responseDataCaptured = { captured: false };
    const originalWrite = res.write;
    const originalEnd = res.end;

    res.write = function(chunk: unknown, encodingOrCallback?: BufferEncoding | ((error: Error | null | undefined) => void), cb?: (error: Error | null | undefined) => void): boolean {
      const chunkStr = chunk ? chunk.toString() : 'empty';
      logger.debug("Transport writing to response", {
        requestId,
        chunkPreview: chunkStr.substring(0, 200),
        truncated: chunkStr.length > 200
      });
      responseDataCaptured.captured = true;
      return originalWrite.call(this, chunk, encodingOrCallback as never, cb);
    };

    res.end = function(chunkOrCallback?: unknown | (() => void), encodingOrCallback?: BufferEncoding | (() => void), cb?: () => void): typeof res {
      const hasChunk = chunkOrCallback && typeof chunkOrCallback !== 'function';
      const chunkStr = hasChunk ? chunkOrCallback.toString() : 'no final chunk';
      logger.debug("Transport ending response", {
        requestId,
        chunkPreview: hasChunk ? chunkStr.substring(0, 200) : chunkStr,
        truncated: hasChunk && chunkStr.length > 200
      });
      responseDataCaptured.captured = true;
      return originalEnd.call(this, chunkOrCallback, encodingOrCallback as never, cb);
    };

    return { originalWrite, originalEnd, responseDataCaptured };
  }

  /**
   * Connect transport to MCP server handler
   */
  private async connectTransportToServer(transport: StreamableHTTPServerTransport, requestId: string): Promise<void> {
    if (!this.streamableTransportHandler) {
      logger.warn("No MCP server handler available", { requestId });
      const error = new Error('MCP server handler not initialized') as Error & { statusCode: number };
      error.statusCode = 503;
      throw error;
    }

    logger.debug("Connecting transport to MCP server handler", { requestId });

    const mcpHandlerPromise = this.streamableTransportHandler(transport);
    logger.debug("MCP server handler started", { requestId });

    const mcpTimeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('MCP server handler timeout after 30s')), 30000);
    });

    try {
      await Promise.race([mcpHandlerPromise, mcpTimeoutPromise]);
      logger.debug("MCP server handler completed, transport connected", { requestId });
    } catch (error) {
      logger.error("MCP server handler error", { requestId, error });
      throw error;
    }
  }

  /**
   * Process the request using the transport
   */
  private async processTransportRequest(transport: StreamableHTTPServerTransport, req: Request, res: Response, requestId: string): Promise<void> {
    logger.debug("Before transport.handleRequest", {
      requestId,
      headersSent: res.headersSent,
      responseFinished: res.finished
    });

    const transportPromise = transport.handleRequest(req, res, req.method === 'POST' ? req.body : undefined);
    logger.debug("Transport.handleRequest started", { requestId });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Transport handleRequest timeout after 30s')), 30000);
    });

    try {
      await Promise.race([transportPromise, timeoutPromise]);
      logger.debug("Transport handled request successfully", { requestId });
    } catch (error) {
      logger.error("Transport handleRequest error", { requestId, error });
      throw error;
    }

    logger.debug("After transport.handleRequest", {
      requestId,
      headersSent: res.headersSent,
      responseFinished: res.finished
    });
  }

  /**
   * Set up session management routes
   */
  private setupSessionRoutes(): void {
    // Get active sessions (admin endpoint)
    const sessionsHandler = (req: Request, res: Response) => {
      const sessions = this.sessionManager.getActiveSessions();
      const stats = this.sessionManager.getStats();

      res.json({
        sessions: sessions.map(s => ({
          sessionId: s.sessionId,
          createdAt: new Date(s.createdAt).toISOString(),
          lastActivity: new Date(s.lastActivity).toISOString(),
          hasAuth: !!s.authInfo,
          metadata: s.metadata,
        })),
        stats,
      });
    };
    this.app.get('/admin/sessions', sessionsHandler);

    // Close a specific session (admin endpoint)
    const deleteSessionHandler = (req: Request, res: Response) => {
      const { sessionId } = req.params;
      if (!sessionId) {
        res.status(400).json({ error: 'Session ID is required' });
        return;
      }
      const closed = this.sessionManager.closeSession(sessionId);

      if (closed) {
        res.json({ success: true, message: `Session ${sessionId} closed` });
      } else {
        res.status(404).json({ error: 'Session not found' });
      }
    };
    this.app.delete('/admin/sessions/:sessionId', deleteSessionHandler);

    // Admin metrics endpoint (matches Vercel API)
    const metricsHandler = (req: Request, res: Response) => {
      const sessionStats = this.sessionManager.getStats();
      const oauthProvider = process.env.OAUTH_PROVIDER || 'google';
      const hasOAuthCredentials = EnvironmentConfig.checkOAuthCredentials(oauthProvider);
      const llmProviders = EnvironmentConfig.checkLLMProviders();

      const metrics = {
        timestamp: new Date().toISOString(),
        platform: 'express-standalone',
        performance: {
          uptime_seconds: process.uptime(),
          memory_usage: process.memoryUsage(),
          cpu_usage: process.cpuUsage(),
        },
        deployment: {
          mode: 'standalone',
          version: process.env.npm_package_version || '1.0.0',
          node_version: process.version,
          environment: process.env.NODE_ENV || 'development',
        },
        configuration: {
          oauth_provider: oauthProvider,
          oauth_configured: hasOAuthCredentials,
          llm_providers: llmProviders,
          transport_mode: 'streamable_http',
        },
        sessions: sessionStats,
        endpoints: {
          health: '/health',
          mcp: '/mcp',
          auth: '/auth',
          admin: '/admin',
        }
      };

      res.json(metrics);
    };
    this.app.get('/admin/metrics', metricsHandler);
  }

  /**
   * Register callback for Streamable HTTP transport events
   */
  onStreamableHTTPTransport(handler: (transport: StreamableHTTPServerTransport) => Promise<void>): void {
    this.streamableTransportHandler = handler;
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const securityConfig = EnvironmentConfig.getSecurityConfig();

      // Use HTTPS in production or when explicitly required
      if (securityConfig.requireHttps) {
        logger.warn("HTTPS required but not yet implemented, starting with HTTP");
      }

      this.server = createServer(this.app);

      this.server.on('error', (error: Error) => {
        logger.error("HTTP server error", error);
        reject(error);
      });

      this.server.listen(this.options.port, this.options.host, () => {
        logger.info("Streamable HTTP server listening", {
          host: this.options.host,
          port: this.options.port
        });
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((error?: Error) => {
        if (error) {
          reject(error);
        } else {
          logger.info("Streamable HTTP server stopped");
          this.sessionManager.destroy();
          resolve();
        }
      });
    });
  }

  /**
   * Get the Express app for testing or customization
   */
  getApp(): Express {
    return this.app;
  }

  /**
   * Get session manager for external access
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  // OAuth and LLM provider checking now handled by EnvironmentConfig
}
