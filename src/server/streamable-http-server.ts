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
import { OAuthProvider } from '../auth/providers/types.js';
import { SessionManager } from '../session/session-manager.js';
import { EventStoreFactory } from '../session/event-store.js';

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
    this.setupRoutes();
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

    // CORS configuration
    const corsOptions: cors.CorsOptions = {
      origin: this.options.allowedOrigins || ['http://localhost:3000', 'http://localhost:8080'],
      credentials: true,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Last-Event-ID'],
    };
    this.app.use(cors(corsOptions));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Request logging
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      console.error(`${new Date().toISOString()} ${req.method} ${req.path} - ${req.ip}`);
      next();
    });
  }

  /**
   * Set up routes for OAuth and Streamable HTTP endpoints
   */
  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      const sessionStats = this.sessionManager.getStats();

      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        mode: 'streamable_http',
        auth: this.options.requireAuth ? 'enabled' : 'disabled',
        sessions: sessionStats,
        features: {
          resumability: this.options.enableResumability || false,
          jsonResponse: this.options.enableJsonResponse || false,
        },
      });
    });

    // OAuth routes (only if auth is required)
    if (this.options.requireAuth) {
      this.setupOAuthRoutes();
    }

    // Streamable HTTP routes
    this.setupStreamableHTTPRoutes();

    // Session management routes
    this.setupSessionRoutes();

    // Catch-all error handler
    this.app.use((error: Error, req: Request, res: Response) => {
      console.error('Express error:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: EnvironmentConfig.isDevelopment() ? error.message : 'Something went wrong',
      });
    });
  }

  /**
   * Set up OAuth authentication routes with multi-provider support
   */
  private setupOAuthRoutes(): void {
    // Create OAuth provider from environment
    const provider = OAuthProviderFactory.createFromEnvironment();
    if (!provider) {
      throw new Error('OAuth provider could not be created from environment configuration');
    }
    this.oauthProvider = provider;

    const endpoints = this.oauthProvider.getEndpoints();

    // OAuth authorization endpoint
    this.app.get(endpoints.authEndpoint, async (req: Request, res: Response) => {
      try {
        await this.oauthProvider!.handleAuthorizationRequest(req, res);
      } catch (error) {
        console.error('OAuth authorization error:', error);
        res.status(500).json({ error: 'Authorization failed' });
      }
    });

    // OAuth callback endpoint
    this.app.get(endpoints.callbackEndpoint, async (req: Request, res: Response) => {
      try {
        await this.oauthProvider!.handleAuthorizationCallback(req, res);
      } catch (error) {
        console.error('OAuth callback error:', error);
        res.status(500).json({ error: 'Authorization callback failed' });
      }
    });

    // Token refresh endpoint
    this.app.post(endpoints.refreshEndpoint, async (req: Request, res: Response) => {
      try {
        await this.oauthProvider!.handleTokenRefresh(req, res);
      } catch (error) {
        console.error('Token refresh error:', error);
        res.status(401).json({ error: 'Token refresh failed' });
      }
    });

    // Logout endpoint
    this.app.post(endpoints.logoutEndpoint, async (req: Request, res: Response) => {
      try {
        await this.oauthProvider!.handleLogout(req, res);
      } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ error: 'Logout failed' });
      }
    });
  }

  /**
   * Set up Streamable HTTP endpoints for MCP communication
   */
  private setupStreamableHTTPRoutes(): void {
    const authMiddleware = this.options.requireAuth && this.oauthProvider
      ? requireBearerAuth({ verifier: this.oauthProvider })
      : (req: Request, res: Response, next: NextFunction) => next();

    // Streamable HTTP endpoint (GET, POST, DELETE)
    this.app.all(this.options.endpoint, authMiddleware, async (req: Request, res: Response) => {
      try {
        // Create Streamable HTTP transport for this request
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => this.sessionManager.generateSessionId(),
          onsessioninitialized: async (sessionId: string) => {
            const authInfo = (req as AuthenticatedRequest).auth;
            this.sessionManager.createSession(authInfo);
            console.log(`🔗 New Streamable HTTP session initialized: ${sessionId}`);
          },
          onsessionclosed: async (sessionId: string) => {
            this.sessionManager.closeSession(sessionId);
            console.log(`🔌 Streamable HTTP session closed: ${sessionId}`);
          },
          enableJsonResponse: this.options.enableJsonResponse,
          eventStore: this.options.enableResumability
            ? EventStoreFactory.createEventStore('memory')
            : undefined,
          allowedHosts: this.options.allowedHosts,
          allowedOrigins: this.options.allowedOrigins,
          enableDnsRebindingProtection: !!(this.options.allowedHosts || this.options.allowedOrigins),
        });

        // Handle the request with the transport
        await transport.handleRequest(req, res, req.method === 'POST' ? req.body : undefined);

        // Connect the transport to the MCP server if handler is available
        if (this.streamableTransportHandler) {
          await this.streamableTransportHandler(transport);
        }

      } catch (error) {
        console.error('Streamable HTTP request error:', error);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to process Streamable HTTP request' });
        }
      }
    });
  }

  /**
   * Set up session management routes
   */
  private setupSessionRoutes(): void {
    // Get active sessions (admin endpoint)
    this.app.get('/admin/sessions', (req: Request, res: Response) => {
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
    });

    // Close a specific session (admin endpoint)
    this.app.delete('/admin/sessions/:sessionId', (req: Request, res: Response) => {
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
}
