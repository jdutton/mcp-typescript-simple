/**
 * Vercel serverless function for MCP Streamable HTTP transport
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { LLMManager } from "../packages/tools-llm/dist/index.js";
import { ToolRegistry } from "../packages/tools/dist/index.js";
import { basicTools } from "../packages/example-tools-basic/dist/index.js";
import { createLLMTools } from "../packages/example-tools-llm/dist/index.js";
import { setupMCPServerWithRegistry } from "../packages/server/dist/index.js";
import { MCPInstanceManager } from "../build/server/mcp-instance-manager.js";
import { EnvironmentConfig } from "../build/config/environment.js";
import { OAuthProviderFactory } from "../build/auth/factory.js";
import { OAuthProvider } from "../build/auth/providers/types.js";
import { logger } from "../build/observability/logger.js";

// Global LLM manager instance for reuse (it's stateless and expensive to create)
let llmManagerInstance: LLMManager | null = null;

// Global tool registry for reuse
let toolRegistryInstance: ToolRegistry | null = null;

// Global OAuth providers map for multi-provider authentication
let oauthProvidersInstance: Map<string, OAuthProvider> | null = null;

// Global MCP instance manager for horizontal scalability
let instanceManagerInstance: MCPInstanceManager | null = null;

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
 * Get or initialize tool registry (singleton)
 */
async function getToolRegistry(): Promise<ToolRegistry> {
  if (toolRegistryInstance) {
    return toolRegistryInstance;
  }

  logger.info("Initializing tool registry for Vercel");
  const registry = new ToolRegistry();

  // Add basic tools (always available)
  registry.merge(basicTools);

  // Try to add LLM tools if available
  try {
    const llmManager = await getLLMManager();
    registry.merge(createLLMTools(llmManager));
    logger.info("LLM tools registered successfully");
  } catch (error) {
    logger.warn("LLM tools not available", { error });
  }

  toolRegistryInstance = registry;
  return registry;
}

/**
 * Get or initialize OAuth providers (singleton - multi-provider support)
 */
async function getOAuthProviders(): Promise<Map<string, OAuthProvider> | null> {
  if (oauthProvidersInstance) {
    return oauthProvidersInstance;
  }

  try {
    const providers = await OAuthProviderFactory.createAllFromEnvironment();
    if (providers && providers.size > 0) {
      oauthProvidersInstance = providers;
      logger.info("Multi-provider OAuth initialized for MCP endpoint", {
        providers: Array.from(providers.keys()),
        count: providers.size
      });
      return providers;
    }
    return null;
  } catch (error) {
    logger.warn("OAuth providers initialization failed - auth will not be enforced", { error });
    return null;
  }
}

/**
 * Get or initialize MCP instance manager (singleton)
 */
async function getInstanceManager(): Promise<MCPInstanceManager> {
  if (instanceManagerInstance) {
    return instanceManagerInstance;
  }

  logger.info("Initializing MCP instance manager for Vercel");
  const toolRegistry = await getToolRegistry();

  // Instance manager auto-detects Redis when available
  instanceManagerInstance = new MCPInstanceManager(toolRegistry);

  logger.info("MCP instance manager initialized");
  return instanceManagerInstance;
}

/**
 * Vercel serverless function handler
 * Uses MCP instance manager for horizontal scalability
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Last-Event-ID, mcp-session-id, mcp-protocol-version');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id, mcp-protocol-version');
    res.setHeader('X-Request-ID', requestId);

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      logger.debug("CORS preflight handled", { requestId });
      res.status(200).end();
      return;
    }

    // Get instance manager
    const instanceManager = await getInstanceManager();

    // Check for existing session ID
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId) {
      // Session exists - get or reconstruct from metadata
      try {
        const instance = await instanceManager.getOrRecreateInstance(sessionId, {
          enableJsonResponse: EnvironmentConfig.get().MCP_LEGACY_CLIENT_SUPPORT,
          allowedOrigins: process.env.ALLOWED_ORIGINS?.split(','),
          allowedHosts: process.env.ALLOWED_HOSTS?.split(','),
        });

        logger.debug("Reusing/reconstructed transport for session", { sessionId, requestId });
        transport = instance.transport;
      } catch (error) {
        logger.error("Failed to reconstruct session", { sessionId, requestId, error });
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Session not found or expired',
          },
          id: null,
        });
        return;
      }
    } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
      // New initialization request - create new transport and server
      logger.debug("Creating new transport for initialize request", { requestId });

      // Check authentication if OAuth is configured (multi-provider support)
      const oauthProviders = await getOAuthProviders();
      const requireAuth = !!(oauthProviders && oauthProviders.size > 0);
      let authInfo: { provider: string; userId?: string; email?: string } | undefined;

      if (requireAuth && oauthProviders) {
        logger.debug("Validating bearer token (multi-provider)", { requestId, providerCount: oauthProviders.size });

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

        // Look up token in token stores to find which provider issued it (secure - local lookup only)
        const token = authHeader.substring(7);
        let providerType: string | undefined;
        let correctProvider: OAuthProvider | undefined;

        for (const [type, provider] of oauthProviders.entries()) {
          // Check if this provider's token store has this token
          // This calls hasToken() which is a local store lookup, NOT an API call
          try {
            const hasToken = await provider.hasToken(token);

            if (hasToken) {
              providerType = type;
              correctProvider = provider;
              logger.debug("Token belongs to provider", { provider: type, requestId });
              break;
            }
          } catch (error) {
            // Token not in this provider's store, continue
            logger.debug("Token lookup failed for provider", { provider: type, requestId, error });
            continue;
          }
        }

        if (!correctProvider || !providerType) {
          logger.warn("Token not found in any provider token store", { requestId });
          res.status(401).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Unauthorized: Invalid or expired access token',
            },
            id: null,
          });
          return;
        }

        // Now verify ONLY with the correct provider (secure - no token leakage)
        logger.debug("Verifying token with correct provider", { provider: providerType, requestId });
        let authResult;
        try {
          authResult = await correctProvider.verifyAccessToken(token);
        } catch (error) {
          logger.warn("Token verification failed", {
            requestId,
            provider: providerType,
            error: error instanceof Error ? error.message : error
          });
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

        // Extract auth info for metadata
        const userInfo = authResult.extra?.userInfo as { sub?: string; email?: string } | undefined;
        authInfo = {
          provider: providerType,
          userId: userInfo?.sub,
          email: userInfo?.email,
        };
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

          // Store session metadata for horizontal scalability
          await instanceManager.storeSessionMetadata(newSessionId, authInfo);
        },
        onsessionclosed: async (closedSessionId: string) => {
          logger.info("Transport session closed", { sessionId: closedSessionId, requestId });
          // Metadata cleanup is handled by instance manager
        },
        enableJsonResponse: EnvironmentConfig.get().MCP_LEGACY_CLIENT_SUPPORT,
        eventStore: undefined,
        allowedOrigins: process.env.ALLOWED_ORIGINS?.split(','),
        allowedHosts: process.env.ALLOWED_HOSTS?.split(','),
        enableDnsRebindingProtection: !!(process.env.ALLOWED_HOSTS || process.env.ALLOWED_ORIGINS),
      });

      // Create new server using tool registry
      const toolRegistry = await getToolRegistry();
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

      // Setup server with tools from registry
      await setupMCPServerWithRegistry(server, toolRegistry, logger);

      // Connect server to transport
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