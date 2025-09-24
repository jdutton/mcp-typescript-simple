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
      console.log(`📥 [${requestId}] ${new Date().toISOString()} ${req.method} ${req.path}`);
      console.log(`📋 [${requestId}] Client: ${req.ip} | User-Agent: ${req.headers['user-agent'] || 'unknown'}`);
      console.log(`🔐 [${requestId}] Auth: ${sanitizedAuth}`);
      console.log(`📊 [${requestId}] Content-Type: ${req.headers['content-type'] || 'none'} | Body Size: ${req.headers['content-length'] || 'unknown'}`);

      if (req.headers.accept) {
        console.log(`📨 [${requestId}] Accept: ${req.headers.accept}`);
      }

      // Log request body for MCP endpoint (with size limit)
      if (req.path === this.options.endpoint && req.method === 'POST' && req.body) {
        try {
          const bodyStr = JSON.stringify(req.body);
          if (bodyStr.length < 1000) {
            console.log(`📤 [${requestId}] Request Body: ${bodyStr}`);
          } else {
            console.log(`📤 [${requestId}] Request Body: ${bodyStr.substring(0, 500)}... (truncated, total: ${bodyStr.length} chars)`);
          }
        } catch (error) {
          console.log(`📤 [${requestId}] Request Body: [Unable to stringify: ${error}]`);
        }
      }

      // Hook into multiple response methods to capture all responses
      const mcpEndpoint = this.options.endpoint;

      // Hook res.send()
      const originalSend = res.send;
      res.send = function(data) {
        const duration = Date.now() - startTime;
        console.log(`📤 [${requestId}] Response (send): ${res.statusCode} ${res.statusMessage} (${duration}ms)`);

        // Log response body for MCP endpoint (with size limit)
        if (req.path === mcpEndpoint && data) {
          try {
            const responseStr = typeof data === 'string' ? data : JSON.stringify(data);
            if (responseStr.length < 1000) {
              console.log(`📥 [${requestId}] Response Body: ${responseStr}`);
            } else {
              console.log(`📥 [${requestId}] Response Body: ${responseStr.substring(0, 500)}... (truncated, total: ${responseStr.length} chars)`);
            }
          } catch (error) {
            console.log(`📥 [${requestId}] Response Body: [Unable to stringify: ${error}]`);
          }
        }

        return originalSend.call(this, data);
      };

      // Hook res.write() for streaming responses
      const originalWrite = res.write;
      res.write = function(chunk: unknown, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) {
        if (req.path === mcpEndpoint) {
          console.log(`📡 [${requestId}] Streaming chunk written: ${chunk ? chunk.toString().substring(0, 200) : 'empty'}${chunk && chunk.toString().length > 200 ? '...' : ''}`);
        }
        return originalWrite.call(this, chunk, encoding as BufferEncoding, callback);
      };

      // Hook res.end() for final response
      const originalEnd = res.end;
      res.end = function(chunk?: unknown, encoding?: BufferEncoding | (() => void), callback?: () => void) {
        const duration = Date.now() - startTime;
        console.log(`🏁 [${requestId}] Response ended: ${res.statusCode} (${duration}ms)`);

        if (req.path === mcpEndpoint) {
          const contentType = res.getHeader('content-type');
          const contentLength = res.getHeader('content-length');
          console.log(`📋 [${requestId}] Final Headers: Content-Type: ${contentType || 'none'}, Content-Length: ${contentLength || 'none'}`);

          if (chunk && req.path === mcpEndpoint) {
            try {
              const chunkStr = chunk.toString();
              if (chunkStr.length < 500) {
                console.log(`📥 [${requestId}] Final chunk: ${chunkStr}`);
              } else {
                console.log(`📥 [${requestId}] Final chunk: ${chunkStr.substring(0, 200)}... (truncated)`);
              }
            } catch (error) {
              console.log(`📥 [${requestId}] Final chunk: [Unable to stringify: ${error}]`);
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
      const hasOAuthCredentials = EnvironmentConfig.checkOAuthCredentialsLegacy(oauthProvider);

      // Check LLM providers
      const llmProviders = EnvironmentConfig.checkLLMProvidersLegacy();

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

      console.error(`❌ [${requestId}] Express Error Handler: ${error.name}: ${error.message}`);
      console.error(`📍 [${requestId}] Request: ${req.method} ${req.path}`);
      console.error(`🔍 [${requestId}] Error Stack:`, error.stack);

      // Log additional context for auth errors
      if (error.message.includes('auth') || error.message.includes('token') || error.message.includes('Bearer')) {
        console.error(`🔐 [${requestId}] Auth Error Context - Auth Header Present: ${!!req.headers.authorization}`);
        if (req.headers.authorization) {
          const sanitizedAuth = req.headers.authorization.startsWith('Bearer ')
            ? `Bearer ${req.headers.authorization.substring(7, 19)}...${req.headers.authorization.substring(req.headers.authorization.length - 8)}`
            : req.headers.authorization.substring(0, 20) + '...';
          console.error(`🔐 [${requestId}] Sanitized Auth Header: ${sanitizedAuth}`);
        }
      }

      // Don't send response if headers already sent
      if (!res.headersSent) {
        const statusCode = error.name === 'UnauthorizedError' || error.message.includes('auth') ? 401 : 500;
        console.log(`📤 [${requestId}] Sending error response: ${statusCode}`);

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
        console.log(`⚠️ [${requestId}] Headers already sent, cannot send error response`);
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

    // OAuth 2.0 Authorization Server Metadata (RFC 8414)
    this.app.get('/.well-known/oauth-authorization-server', async (req: Request, res: Response) => {
      try {
        if (!this.oauthProvider) {
          // Return minimal metadata indicating OAuth is not configured
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
        res.json(metadata);
      } catch (error) {
        console.error('OAuth authorization server metadata error:', error);
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
        res.json(metadata);
      } catch (error) {
        console.error('OAuth protected resource metadata error:', error);
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
          res.json({
            resource: baseUrl,
            authorization_servers: [],
            mcp_version: '1.18.0',
            transport_capabilities: ['stdio', 'streamable_http'],
            tool_discovery_endpoint: `${baseUrl}${this.options.endpoint}`,
            supported_tool_types: ['function', 'text_generation', 'analysis'],
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
        res.json(metadata);
      } catch (error) {
        console.error('MCP protected resource metadata error:', error);
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
        res.json(metadata);
      } catch (error) {
        console.error('OpenID Connect configuration error:', error);
        res.status(500).json({
          error: 'Failed to generate OpenID Connect configuration',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // 404 handler for unknown discovery endpoints
    this.app.use('/.well-known', (req: Request, res: Response) => {
      // If we get here, none of the specific endpoints matched
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
      throw new Error('OAuth provider could not be created from environment configuration');
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
        console.error('OAuth authorization error:', error);
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
        console.error('OAuth callback error:', error);
        res.status(500).json({ error: 'Authorization callback failed' });
      }
    };
    this.app.get(endpoints.callbackEndpoint, callbackHandler);

    // Universal OAuth token handler (supports both JSON and form data)
    const universalTokenHandler = async (req: Request, res: Response) => {
      try {
        console.log(`[OAuth Debug] Universal token handler - Content-Type: ${req.headers['content-type']}`);
        console.log(`[OAuth Debug] Request body:`, req.body);

        // Extract parameters (works for both form data and JSON)
        const { grant_type, refresh_token } = req.body;

        // Determine operation based on grant_type
        if (grant_type === 'authorization_code') {
          // Authorization code exchange - delegate to provider's handleTokenExchange
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
          // Token refresh - delegate to provider's handleTokenRefresh
          await this.oauthProvider!.handleTokenRefresh(req, res);
        } else {
          res.status(400).json({
            error: 'unsupported_grant_type',
            error_description: 'Supported grant types: authorization_code, refresh_token'
          });
        }
      } catch (error) {
        console.error('OAuth universal token handler error:', error);
        res.status(500).json({
          error: 'server_error',
          error_description: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        });
      }
    };

    // Use universal handler for both provider-specific refresh endpoint and generic token endpoint
    this.app.post(endpoints.refreshEndpoint, universalTokenHandler);

    // Generic OAuth token endpoint (uses same universal handler)
    this.app.post('/token', universalTokenHandler);

    // Logout endpoint
    const logoutHandler = async (req: Request, res: Response) => {
      try {
        await this.oauthProvider!.handleLogout(req, res);
      } catch (error) {
        console.error('Logout error:', error);
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
          console.log(`🔐 [${requestId}] Auth Middleware: Verifying Bearer token`);

          const bearerAuthMiddleware = requireBearerAuth({ verifier: this.oauthProvider! });
          bearerAuthMiddleware(req, res, (error?: unknown) => {
            if (error) {
              console.error(`❌ [${requestId}] Auth Failed:`, error instanceof Error ? error.message : error);
              return next(error);
            }

            const authInfo = (req as AuthenticatedRequest).auth;
            if (authInfo) {
              console.log(`✅ [${requestId}] Auth Success: token validated`);
              console.log(`👤 [${requestId}] Client ID: ${authInfo.clientId}`);
              console.log(`🔑 [${requestId}] Scopes: ${authInfo.scopes?.join(', ') || 'none'}`);
              if (authInfo.extra?.userInfo) {
                const userInfo = authInfo.extra.userInfo as OAuthUserInfo;
                console.log(`👨‍💼 [${requestId}] User: ${userInfo.email || userInfo.sub || 'unknown'}`);
              }
            } else {
              console.log(`⚠️ [${requestId}] Auth Info: No auth info set despite successful verification`);
            }

            next();
          });
        }
      : (req: Request, res: Response, next: NextFunction) => {
          const requestId = (req as Request & { requestId?: string }).requestId || 'unknown';
          console.log(`🔓 [${requestId}] Auth Middleware: Bypassed (auth not required)`);
          next();
        };

    // Streamable HTTP endpoint (GET, POST, DELETE)
    const mcpHandler = async (req: Request, res: Response) => {
      const requestId = (req as Request & { requestId?: string }).requestId || 'unknown';

      try {
        console.log(`🔗 [${requestId}] MCP Handler: Starting Streamable HTTP processing`);
        console.log(`🔧 [${requestId}] Method: ${req.method} | Auth Required: ${this.options.requireAuth}`);

        // Log JSON-RPC details for POST requests
        if (req.method === 'POST' && req.body) {
          try {
            const jsonrpcRequest = req.body;
            if (jsonrpcRequest.jsonrpc && jsonrpcRequest.method) {
              console.log(`📋 [${requestId}] JSON-RPC Method: ${jsonrpcRequest.method} | ID: ${jsonrpcRequest.id} | Version: ${jsonrpcRequest.jsonrpc}`);

              if (jsonrpcRequest.params) {
                if (jsonrpcRequest.method === 'initialize') {
                  console.log(`🚀 [${requestId}] Initialize Request - Protocol: ${jsonrpcRequest.params.protocolVersion}`);
                  console.log(`🎯 [${requestId}] Client Info: ${JSON.stringify(jsonrpcRequest.params.clientInfo)}`);
                  console.log(`⚙️ [${requestId}] Capabilities: ${JSON.stringify(jsonrpcRequest.params.capabilities)}`);
                } else if (jsonrpcRequest.method === 'tools/list') {
                  console.log(`🛠️ [${requestId}] Tools List Request`);
                } else if (jsonrpcRequest.method === 'tools/call') {
                  console.log(`🔧 [${requestId}] Tool Call: ${jsonrpcRequest.params.name}`);
                  console.log(`📝 [${requestId}] Tool Args: ${JSON.stringify(jsonrpcRequest.params.arguments)}`);
                } else {
                  console.log(`📦 [${requestId}] Params: ${JSON.stringify(jsonrpcRequest.params).substring(0, 200)}${JSON.stringify(jsonrpcRequest.params).length > 200 ? '...' : ''}`);
                }
              }
            } else {
              console.log(`⚠️ [${requestId}] Non-JSON-RPC request body detected`);
            }
          } catch (error) {
            console.log(`❌ [${requestId}] Failed to parse JSON-RPC request: ${error}`);
          }
        }

        // Create Streamable HTTP transport for this request
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => {
            const sessionId = this.sessionManager.generateSessionId();
            console.log(`🔑 [${requestId}] Generated session ID: ${sessionId}`);
            return sessionId;
          },
          onsessioninitialized: async (sessionId: string) => {
            const authInfo = (req as AuthenticatedRequest).auth;
            console.log(`🔗 [${requestId}] New Streamable HTTP session initialized: ${sessionId}`);
            console.log(`👤 [${requestId}] Auth Status: ${authInfo ? 'authenticated' : 'anonymous'}`);

            if (authInfo) {
              console.log(`🎫 [${requestId}] Session Auth Details - Client: ${authInfo.clientId}, Scopes: ${authInfo.scopes?.join(', ') || 'none'}`);
            }

            try {
              this.sessionManager.createSession(authInfo);
              const stats = this.sessionManager.getStats();
              console.log(`📊 [${requestId}] Session Stats - Total: ${stats.totalSessions}, Active: ${stats.activeSessions}`);
            } catch (error) {
              console.error(`❌ [${requestId}] Failed to create session: ${error}`);
            }
          },
          onsessionclosed: async (sessionId: string) => {
            console.log(`🔌 [${requestId}] Streamable HTTP session closed: ${sessionId}`);

            try {
              this.sessionManager.closeSession(sessionId);
              const stats = this.sessionManager.getStats();
              console.log(`📊 [${requestId}] Session Stats After Close - Total: ${stats.totalSessions}, Active: ${stats.activeSessions}`);
            } catch (error) {
              console.error(`❌ [${requestId}] Failed to close session: ${error}`);
            }
          },
          enableJsonResponse: this.options.enableJsonResponse ?? EnvironmentConfig.get().MCP_LEGACY_CLIENT_SUPPORT, // Enable JSON responses for legacy client compatibility
          eventStore: this.options.enableResumability
            ? EventStoreFactory.createEventStore('memory')
            : undefined,
          allowedHosts: this.options.allowedHosts,
          allowedOrigins: this.options.allowedOrigins,
          enableDnsRebindingProtection: !!(this.options.allowedHosts || this.options.allowedOrigins),
        });

        console.log(`📡 [${requestId}] Handling request with Streamable HTTP transport`);

        // Add detailed response monitoring
        let responseDataCaptured = false;

        // Hook into the underlying HTTP response to capture what the transport writes
        const originalWrite = res.write;
        const originalEnd = res.end;

        res.write = function(chunk: unknown, encodingOrCallback?: BufferEncoding | ((error: Error | null | undefined) => void), cb?: (error: Error | null | undefined) => void): boolean {
          console.log(`✍️ [${requestId}] Transport writing to response: ${chunk ? chunk.toString().substring(0, 200) : 'empty'}${chunk && chunk.toString().length > 200 ? '...' : ''}`);
          responseDataCaptured = true;
          return originalWrite.call(this, chunk, encodingOrCallback as never, cb);
        };

        res.end = function(chunkOrCallback?: unknown | (() => void), encodingOrCallback?: BufferEncoding | (() => void), cb?: () => void): typeof res {
          console.log(`🏁 [${requestId}] Transport ending response: ${chunkOrCallback && typeof chunkOrCallback !== 'function' ? chunkOrCallback.toString().substring(0, 200) : 'no final chunk'}${chunkOrCallback && typeof chunkOrCallback !== 'function' && chunkOrCallback.toString().length > 200 ? '...' : ''}`);
          responseDataCaptured = true;
          return originalEnd.call(this, chunkOrCallback, encodingOrCallback as never, cb);
        };

        // Connect every transport to the MCP server - this is how Streamable HTTP is supposed to work
        if (this.streamableTransportHandler) {
          console.log(`🔌 [${requestId}] Connecting transport to MCP server handler`);

          const mcpHandlerPromise = this.streamableTransportHandler(transport);
          console.log(`⏳ [${requestId}] MCP server handler started...`);

          // Add timeout for MCP handler
          const mcpTimeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('MCP server handler timeout after 30s')), 30000);
          });

          try {
            await Promise.race([mcpHandlerPromise, mcpTimeoutPromise]);
            console.log(`🎯 [${requestId}] MCP server handler completed - transport now connected to server`);
          } catch (error) {
            console.error(`❌ [${requestId}] MCP server handler error:`, error);
            throw error;
          }
        } else {
          console.log(`⚠️ [${requestId}] No MCP server handler available - this will cause the request to hang!`);

          // If no handler is available, we should send an error response
          if (!res.headersSent) {
            console.log(`📤 [${requestId}] Sending 'no handler' error response`);
            res.status(503).json({
              error: 'Service temporarily unavailable',
              message: 'MCP server handler not initialized',
              requestId
            });
          }
          return; // Don't continue with handleRequest if no handler
        }

        // Now handle the request with the transport (which is connected to the MCP server)
        console.log(`🔍 [${requestId}] Before transport.handleRequest - Headers sent: ${res.headersSent}, Response finished: ${res.finished}`);

        const transportPromise = transport.handleRequest(req, res, req.method === 'POST' ? req.body : undefined);
        console.log(`⏳ [${requestId}] Transport.handleRequest started...`);

        // Add timeout to detect hanging
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Transport handleRequest timeout after 30s')), 30000);
        });

        try {
          await Promise.race([transportPromise, timeoutPromise]);
          console.log(`✅ [${requestId}] Transport handled request successfully`);
        } catch (error) {
          console.error(`❌ [${requestId}] Transport handleRequest error:`, error);
          throw error;
        }

        console.log(`🔍 [${requestId}] After transport.handleRequest - Headers sent: ${res.headersSent}, Response finished: ${res.finished}`);
        console.log(`📊 [${requestId}] Response data captured: ${responseDataCaptured}`);

        // Restore original methods
        res.write = originalWrite;
        res.end = originalEnd;

      } catch (error) {
        console.error(`❌ [${requestId}] Streamable HTTP request error:`, error);
        console.error(`🔍 [${requestId}] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');

        if (!res.headersSent) {
          console.log(`📤 [${requestId}] Sending error response: 500`);
          res.status(500).json({ error: 'Failed to process Streamable HTTP request' });
        } else {
          console.log(`⚠️ [${requestId}] Response already sent, cannot send error response`);
        }
      }
    };
    this.app.all(this.options.endpoint, authMiddleware, mcpHandler);
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
      const hasOAuthCredentials = EnvironmentConfig.checkOAuthCredentialsLegacy(oauthProvider);
      const llmProviders = EnvironmentConfig.checkLLMProvidersLegacy();

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
        console.warn('⚠️  HTTPS required but not yet implemented. Starting with HTTP.');
      }

      this.server = createServer(this.app);

      this.server.on('error', (error: Error) => {
        console.error('HTTP server error:', error);
        reject(error);
      });

      this.server.listen(this.options.port, this.options.host, () => {
        console.error(`📡 Streamable HTTP server listening on ${this.options.host}:${this.options.port}`);
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
          console.error('📡 Streamable HTTP server stopped');
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
