/**
 * Vercel serverless function for MCP Streamable HTTP transport
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { LLMManager } from "../build/llm/manager.js";
import { setupMCPServer } from "../build/server/mcp-setup.js";
import { EnvironmentConfig } from "../build/config/environment.js";
import { OAuthProviderFactory } from "../build/auth/factory.js";
import { OAuthProvider } from "../build/auth/providers/types.js";
import { logger } from "../build/observability/logger.js";

// Global LLM manager instance for reuse (it's stateless and expensive to create)
let llmManagerInstance: LLMManager | null = null;

// Global OAuth provider instance for authentication
let oauthProviderInstance: OAuthProvider | null = null;

// Global cache of transports by session ID (per MCP SDK pattern)
const transportCache = new Map<string, StreamableHTTPServerTransport>();

/**
 * Get or initialize LLM manager (singleton)
 */
async function getLLMManager(): Promise<LLMManager> {
  if (llmManagerInstance) {
    return llmManagerInstance;
  }

  logger.info("Initializing LLM manager for Vercel");
  const llmManager = new LLMManager();

  // Initialize LLM manager (gracefully handle missing API keys)
  try {
    await llmManager.initialize();
    logger.info("LLM providers initialized", {
      providers: llmManager.getAvailableProviders()
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("LLM initialization failed - LLM tools will be unavailable", {
      error: errorMessage
    });
  }

  llmManagerInstance = llmManager;
  return llmManager;
}

/**
 * Get or initialize OAuth provider (singleton)
 */
async function getOAuthProvider() {
  if (oauthProviderInstance) {
    return oauthProviderInstance;
  }

  try {
    const provider = await OAuthProviderFactory.createFromEnvironment();
    if (provider) {
      oauthProviderInstance = provider;
      logger.info("OAuth provider initialized", { providerType: provider.getProviderType() });
    }
    return provider;
  } catch (error) {
    logger.warn("OAuth provider initialization failed - auth will not be enforced", { error });
    return null;
  }
}

/**
 * Create a new MCP server for this request
 * Note: Each serverless invocation needs its own server instance with its own transport
 */
async function createMCPServer(): Promise<Server> {
  logger.debug("Creating new MCP server instance for request");

  // Get shared LLM manager
  const llmManager = await getLLMManager();

  // Create MCP server
  const server = new Server(
    {
      name: "mcp-typescript-simple",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Setup server with tools
  await setupMCPServer(server, llmManager);

  logger.debug("MCP server instance created");
  return server;
}

/**
 * Vercel serverless function handler
 * Follows official MCP SDK pattern for session management
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    logger.debug("MCP serverless request received", {
      requestId,
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent'] || 'unknown'
    });

    // Set CORS headers for browser requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Last-Event-ID, mcp-session-id');
    res.setHeader('X-Request-ID', requestId);

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      logger.debug("CORS preflight handled", { requestId });
      res.status(200).end();
      return;
    }

    // Check for existing session ID
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    // Atomic check-and-get to prevent race condition
    const cachedTransport = sessionId ? transportCache.get(sessionId) : undefined;

    if (cachedTransport) {
      // Reuse existing transport (per MCP SDK pattern)
      logger.debug("Reusing cached transport for session", { sessionId, requestId });
      transport = cachedTransport;
    } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
      // New initialization request - create new transport and server
      logger.debug("Creating new transport for initialize request", { requestId });

      // Check authentication if OAuth is configured
      const oauthProvider = await getOAuthProvider();
      const requireAuth = !!oauthProvider;

      if (requireAuth && oauthProvider) {
        logger.debug("Validating bearer token", { requestId });

        // Validate Bearer token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          logger.warn("Missing or invalid Authorization header", { requestId });
          res.status(401).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Unauthorized: Bearer token required',
            },
            id: null,
          });
          return;
        }

        // Verify token with OAuth provider
        try {
          const token = authHeader.substring(7);
          const authResult = await oauthProvider.verifyAccessToken(token);
          if (!authResult) {
            logger.warn("Token verification failed", { requestId });
            res.status(401).json({
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: 'Unauthorized: Invalid bearer token',
              },
              id: null,
            });
            return;
          }
          logger.info("Token verified successfully", {
            requestId,
            clientId: authResult.clientId
          });
        } catch (error) {
          logger.error("Token verification error", { requestId, error });
          res.status(401).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Unauthorized: Token verification failed',
            },
            id: null,
          });
          return;
        }
      }

      // Create new transport
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => {
          if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
          }
          return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        },
        onsessioninitialized: async (newSessionId: string) => {
          logger.info("Transport session initialized", { sessionId: newSessionId, requestId });
          // Store the transport by session ID
          transportCache.set(newSessionId, transport);
        },
        onsessionclosed: async (closedSessionId: string) => {
          logger.info("Transport session closed", { sessionId: closedSessionId, requestId });
          // Remove from cache
          transportCache.delete(closedSessionId);
        },
        enableJsonResponse: EnvironmentConfig.get().MCP_LEGACY_CLIENT_SUPPORT,
        eventStore: undefined,
        allowedOrigins: process.env.ALLOWED_ORIGINS?.split(','),
        allowedHosts: process.env.ALLOWED_HOSTS?.split(','),
        enableDnsRebindingProtection: !!(process.env.ALLOWED_HOSTS || process.env.ALLOWED_ORIGINS),
      });

      // Clean up transport when closed
      transport.onclose = () => {
        if (transport.sessionId) {
          transportCache.delete(transport.sessionId);
          logger.info("Transport cleanup complete", { sessionId: transport.sessionId });
        }
      };

      // Create new server and connect it to the transport
      const server = await createMCPServer();
      await server.connect(transport);
      logger.debug("New server connected to transport", { requestId });
    } else {
      // Invalid request - no valid session ID and not an initialize request
      logger.warn("Invalid request: no session ID and not initialize", {
        requestId,
        hasSessionId: !!sessionId,
        method: req.method,
        isInitialize: req.method === 'POST' ? isInitializeRequest(req.body) : false
      });
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }

    // Handle the request with the transport
    await transport.handleRequest(req as any, res as any, req.method === 'POST' ? req.body : undefined);

    const duration = Date.now() - startTime;
    logger.debug("MCP request completed", { requestId, duration });

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("MCP serverless function error", {
      requestId,
      duration,
      error
    });

    if (!res.headersSent) {
      const isDevelopment = process.env.NODE_ENV !== 'production';

      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: isDevelopment && error instanceof Error
            ? error.message
            : 'Internal server error',
        },
        id: null
      });
    }
  }
}