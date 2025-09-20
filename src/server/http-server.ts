/**
 * HTTP server for handling SSE connections with OAuth authentication
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { Server as HttpsServer } from 'https';
import helmet from 'helmet';
import cors from 'cors';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { EnvironmentConfig } from '../config/environment.js';
import { OAuthProviderFactory } from '../auth/factory.js';
import { OAuthProvider } from '../auth/providers/types.js';

export interface HttpServerOptions {
  port: number;
  host: string;
  endpoint: string;
  requireAuth: boolean;
  allowedOrigins?: string[];
  allowedHosts?: string[];
  sessionSecret: string;
}

/**
 * HTTP server that provides SSE endpoints with OAuth authentication
 */
export class MCPHttpServer {
  private app: Express;
  private server?: HttpServer | HttpsServer;
  private oauthProvider?: OAuthProvider;
  private sseConnectionHandler?: (transport: SSEServerTransport) => Promise<void>;

  constructor(private options: HttpServerOptions) {
    this.app = express();
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
      crossOriginEmbedderPolicy: false, // Required for SSE
    }));

    // CORS configuration
    const corsOptions: cors.CorsOptions = {
      origin: this.options.allowedOrigins || ['http://localhost:3000', 'http://localhost:8080'],
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
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
   * Set up routes for OAuth and SSE endpoints
   */
  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        mode: 'sse',
        auth: this.options.requireAuth ? 'enabled' : 'disabled',
      });
    });

    // OAuth routes (only if auth is required)
    if (this.options.requireAuth) {
      this.setupOAuthRoutes();
    }

    // SSE routes
    this.setupSSERoutes();

    // Catch-all error handler
    this.app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
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
   * Set up SSE endpoints for MCP communication
   */
  private setupSSERoutes(): void {
    const authMiddleware = this.options.requireAuth && this.oauthProvider
      ? requireBearerAuth({ verifier: this.oauthProvider })
      : (req: Request, res: Response, next: NextFunction) => next();

    // SSE connection endpoint (GET)
    this.app.get(this.options.endpoint, authMiddleware, async (req: Request, res: Response) => {
      try {
        const sseTransport = new SSEServerTransport(
          this.options.endpoint + '/message',
          res,
          {
            allowedOrigins: this.options.allowedOrigins,
            allowedHosts: this.options.allowedHosts,
            enableDnsRebindingProtection: !!this.options.allowedHosts || !!this.options.allowedOrigins,
          }
        );

        await sseTransport.start();

        if (this.sseConnectionHandler) {
          await this.sseConnectionHandler(sseTransport);
        }

        // Handle connection cleanup on request close
        req.on('close', () => {
          sseTransport.close().catch(console.error);
        });

      } catch (error) {
        console.error('SSE connection error:', error);
        res.status(500).json({ error: 'Failed to establish SSE connection' });
      }
    });

    // SSE message endpoint (POST)
    this.app.post(this.options.endpoint + '/message', authMiddleware, async (req: Request, res: Response) => {
      try {
        // This endpoint is handled by the SSE transport itself
        // We need to route the request to the appropriate transport instance
        // This will be implemented when we have session management

        res.status(200).json({ success: true });
      } catch (error) {
        console.error('SSE message error:', error);
        res.status(500).json({ error: 'Failed to process message' });
      }
    });
  }

  /**
   * Register callback for SSE connection events
   */
  onSSEConnection(handler: (transport: SSEServerTransport) => Promise<void>): void {
    this.sseConnectionHandler = handler;
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const securityConfig = EnvironmentConfig.getSecurityConfig();

      // Use HTTPS in production or when explicitly required
      if (securityConfig.requireHttps) {
        // For development, you'd want to provide SSL certificates
        // For now, we'll start with HTTP and add HTTPS support later
        console.warn('⚠️  HTTPS required but not yet implemented. Starting with HTTP.');
      }

      this.server = createServer(this.app);

      this.server.on('error', (error: Error) => {
        console.error('HTTP server error:', error);
        reject(error);
      });

      this.server.listen(this.options.port, this.options.host, () => {
        console.error(`📡 HTTP server listening on ${this.options.host}:${this.options.port}`);
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
          console.error('📡 HTTP server stopped');
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
}