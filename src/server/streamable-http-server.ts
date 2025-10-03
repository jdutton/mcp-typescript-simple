/**
 * HTTP server for handling Streamable HTTP transport with OAuth authentication
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer, Server as HttpServer } from 'http';
import helmet from 'helmet';
import cors from 'cors';
import * as OpenApiValidator from 'express-openapi-validator';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { EnvironmentConfig } from '../config/environment.js';
import { OAuthProviderFactory } from '../auth/factory.js';
import { OAuthProvider, OAuthUserInfo } from '../auth/providers/types.js';
import { SessionManager } from '../session/session-manager.js';
import { EventStoreFactory } from '../session/event-store.js';
import { ClientStoreFactory } from '../auth/client-store-factory.js';
import { OAuthRegisteredClientsStore } from '../auth/stores/client-store-interface.js';
import { TokenStoreFactory } from '../auth/token-store-factory.js';
import { InitialAccessTokenStore } from '../auth/stores/token-store-interface.js';
import { MCPInstanceManager } from './mcp-instance-manager.js';
import { LLMManager } from '../llm/manager.js';
import { setupDiscoveryRoutes } from './routes/discovery-routes.js';
import { setupOAuthRoutes } from './routes/oauth-routes.js';
import { setupHealthRoutes } from './routes/health-routes.js';
import { setupAdminRoutes } from './routes/admin-routes.js';
import { setupAdminTokenRoutes } from './routes/admin-token-routes.js';
import { setupDocsRoutes } from './routes/docs-routes.js';
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
  private clientStore?: OAuthRegisteredClientsStore;
  private tokenStore?: InitialAccessTokenStore;
  private sessionManager: SessionManager;
  private llmManager: LLMManager;
  private instanceManager: MCPInstanceManager;
  private streamableTransportHandler?: (transport: StreamableHTTPServerTransport) => Promise<void>;

  constructor(private options: StreamableHttpServerOptions) {
    this.app = express();

    // Create session manager with optional event store
    const eventStore = options.enableResumability
      ? EventStoreFactory.createEventStore('memory')
      : undefined;

    this.sessionManager = new SessionManager(eventStore);

    // Create LLM manager for tool support
    this.llmManager = new LLMManager();

    // Create MCP instance manager for horizontal scalability
    this.instanceManager = new MCPInstanceManager(this.llmManager);

    this.setupMiddleware();

    // Setup health and utility routes
    setupHealthRoutes(this.app, this.sessionManager, this.oauthProvider, {
      enableResumability: this.options.enableResumability,
      enableJsonResponse: this.options.enableJsonResponse
    });
  }

  /**
   * Initialize async components like OAuth and client store
   */
  async initialize(): Promise<void> {
    // Initialize LLM manager (gracefully handle missing API keys)
    try {
      await this.llmManager.initialize();
    } catch (error) {
      logger.warn('LLM manager initialization failed, LLM tools will be unavailable', { error });
      // Continue - basic tools still work without LLM providers
    }

    // Initialize client store for OAuth Dynamic Client Registration
    this.clientStore = ClientStoreFactory.create();

    // Initialize token store for protected DCR endpoints
    this.tokenStore = TokenStoreFactory.create();

    // OAuth routes (only if auth is required)
    if (this.options.requireAuth) {
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

      // Setup OAuth authentication routes
      setupOAuthRoutes(this.app, this.oauthProvider, this.clientStore);
    }

    // OAuth discovery routes (available even without auth)
    this.setupOAuthDiscoveryRoutes();

    // Admin token management routes (for protected DCR)
    const devMode = process.env.MCP_DEV_SKIP_AUTH === 'true';
    setupAdminTokenRoutes(this.app, this.tokenStore, this.clientStore, { devMode });

    // Documentation routes (OpenAPI, Swagger UI, Redoc) - available without auth
    setupDocsRoutes(this.app);

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
          scriptSrc: [
            "'self'",
            "'unsafe-inline'",
            "'unsafe-eval'", // Required for Swagger UI
            "https://cdn.redoc.ly", // Redoc CDN
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://fonts.googleapis.com", // Google Fonts for Redoc
          ],
          fontSrc: [
            "'self'",
            "https://fonts.gstatic.com", // Google Fonts for Redoc
          ],
          imgSrc: [
            "'self'",
            "data:", // Allow data URIs for Swagger UI
            "https:", // Allow HTTPS images
          ],
          connectSrc: ["'self'"],
          workerSrc: ["'self'", "blob:"], // Allow workers for Redoc
          upgradeInsecureRequests: null, // Disable for localhost development
        },
      },
      crossOriginEmbedderPolicy: false, // Required for streaming
      crossOriginResourcePolicy: false, // Required for Safari to fetch docs
      strictTransportSecurity: false, // Disable HSTS for localhost development
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
      origin: (origin, callback) => {
        // Allow requests with no origin (same-origin requests, curl, etc.)
        if (!origin) {
          return callback(null, true);
        }

        // Check against allowed origins
        const allowedOrigins = this.options.allowedOrigins || defaultOrigins;
        if (allowedOrigins.indexOf(origin) !== -1) {
          return callback(null, true);
        }

        return callback(new Error('Not allowed by CORS'));
      },
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

    // OpenAPI request/response validation (DISABLED)
    // The validator is disabled because:
    // 1. It breaks MCP Inspector during development
    // 2. It exposes stack traces on 404 errors
    // 3. MCP endpoints don't follow standard REST patterns that OpenAPI expects
    // 4. It interferes with unit tests that expect specific error codes
    //
    // Instead, we rely on:
    // - Integration tests for protocol compliance
    // - Manual testing with MCP Inspector
    // - TypeScript for type safety
    //
    // If spec validation is needed, run it separately with tools like Spectral or Redocly
    const enableOpenApiValidator = false;

    if (enableOpenApiValidator) {
      this.app.use(
        OpenApiValidator.middleware({
          apiSpec: './openapi.yaml',
          validateRequests: true,
          validateResponses: false,
          validateSecurity: false,
          ignorePaths: /^\/(api-docs|docs|openapi\.(json|yaml)|authorize|token|mcp|stream|health)($|\/.*)/i,
          validateApiSpec: false,
        })
      );

      this.app.use((err: Error & { status?: number; errors?: unknown[] }, req: Request, res: Response, next: NextFunction) => {
        if (err.status === 400 && err.errors) {
          logger.warn('OpenAPI validation error', {
            path: req.path,
            method: req.method,
            errors: err.errors,
          });
          res.status(400).json({
            error: 'validation_error',
            message: err.message,
            errors: err.errors,
          });
          return;
        }
        next(err);
      });
    }

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
    // Admin and session management routes
    setupAdminRoutes(this.app, this.sessionManager);

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
    setupDiscoveryRoutes(this.app, this.oauthProvider, {
      endpoint: this.options.endpoint,
      host: this.options.host,
      port: this.options.port,
      enableResumability: this.options.enableResumability
    });
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

    // Session cleanup is now handled by instance manager's onSessionClosed callback
    // We just need to notify the session manager
    this.sessionManager.closeSession(sessionId);

    logger.info("Session successfully cleaned up", { requestId, sessionId });
    res.status(200).json({
      message: 'Session successfully terminated',
      sessionId: sessionId,
      requestId: requestId,
      timestamp: new Date().toISOString()
    });
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
   * Get existing instance or reconstruct from metadata
   */
  private async getOrCreateTransport(req: Request, requestId: string): Promise<StreamableHTTPServerTransport> {
    const existingSessionId = req.headers['mcp-session-id'] as string;

    if (existingSessionId) {
      // Session exists - use instance manager to get or reconstruct
      try {
        const instance = await this.instanceManager.getOrRecreateInstance(existingSessionId, {
          enableJsonResponse: this.options.enableJsonResponse,
          enableResumability: this.options.enableResumability,
          allowedHosts: this.options.allowedHosts,
          allowedOrigins: this.options.allowedOrigins,
        });

        logger.debug("Reusing/reconstructed transport for session", {
          requestId,
          sessionId: existingSessionId
        });

        return instance.transport;
      } catch (error) {
        logger.error("Failed to reconstruct session", {
          requestId,
          sessionId: existingSessionId,
          error
        });
        throw error;
      }
    }

    // New session - create transport (session ID will be generated in transport)
    logger.debug("Creating new transport for session", {
      requestId,
      sessionId: 'new'
    });
    return this.createNewTransport(req, requestId);
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
        await this.handleSessionInitialized(req, sessionId, requestId, transport);
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
  private async handleSessionInitialized(req: Request, sessionId: string, requestId: string, _transport: StreamableHTTPServerTransport): Promise<void> {
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

      // Store session metadata in instance manager for horizontal scalability
      await this.instanceManager.storeSessionMetadata(sessionId, authInfo ? {
        provider: authInfo.extra?.provider as string || 'unknown',
        userId: authInfo.extra?.userInfo ? (authInfo.extra.userInfo as OAuthUserInfo).sub : undefined,
        email: authInfo.extra?.userInfo ? (authInfo.extra.userInfo as OAuthUserInfo).email : undefined,
      } : undefined);

    } catch (error) {
      logger.error("Failed to create session", { requestId, error });
    }
  }

  /**
   * Handle session closure
   */
  private async handleSessionClosed(sessionId: string, requestId: string): Promise<void> {
    logger.info("Streamable HTTP session closed", { requestId, sessionId });

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

    // Note: Instance manager's cleanup is automatic via cleanup timer
    // Metadata is deleted by MCPInstanceManager when session is closed
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

    // Create timeout with cleanup to prevent memory leak
    let timeoutId: NodeJS.Timeout | undefined;
    const mcpTimeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('MCP server handler timeout after 30s')), 30000);
    });

    try {
      await Promise.race([mcpHandlerPromise, mcpTimeoutPromise]);
      logger.debug("MCP server handler completed, transport connected", { requestId });
    } catch (error) {
      logger.error("MCP server handler error", { requestId, error });
      throw error;
    } finally {
      // Always clear timeout to prevent memory leak
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
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

    // Create timeout with cleanup to prevent memory leak
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Transport handleRequest timeout after 30s')), 30000);
    });

    try {
      await Promise.race([transportPromise, timeoutPromise]);
      logger.debug("Transport handled request successfully", { requestId });
    } catch (error) {
      logger.error("Transport handleRequest error", { requestId, error });
      throw error;
    } finally {
      // Always clear timeout to prevent memory leak
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }

    logger.debug("After transport.handleRequest", {
      requestId,
      headersSent: res.headersSent,
      responseFinished: res.finished
    });
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

      this.server.close(async (error?: Error) => {
        if (error) {
          reject(error);
        } else {
          logger.info("Streamable HTTP server stopped");
          this.sessionManager.destroy();

          // Dispose instance manager resources
          this.instanceManager.dispose();

          // Cleanup client store resources
          if (this.clientStore && 'dispose' in this.clientStore && typeof this.clientStore.dispose === 'function') {
            await this.clientStore.dispose();
          }

          // Cleanup OAuth provider resources
          if (this.oauthProvider && 'dispose' in this.oauthProvider && typeof this.oauthProvider.dispose === 'function') {
            this.oauthProvider.dispose();
          }

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
