/**
 * Vercel serverless function for MCP Streamable HTTP transport
 */

// CRITICAL: Must be first import to initialize OTEL before any other code
// This enables OCSF audit events via ConsoleLogRecordExporter → Vercel logs
import '@mcp-typescript-simple/observability/register';

import { VercelRequest, VercelResponse } from '@vercel/node';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
// requireBearerAuth not needed in Vercel adapter - auth handled via OAuth providers
// import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { LLMManager } from "@mcp-typescript-simple/tools-llm";
import { ToolRegistry } from "@mcp-typescript-simple/tools";
import { basicTools } from "@mcp-typescript-simple/example-tools-basic";
import { createLLMTools } from "@mcp-typescript-simple/example-tools-llm";
import { setupMCPServerWithRegistry } from "@mcp-typescript-simple/server";
import { MCPInstanceManager } from "@mcp-typescript-simple/http-server";
import { EnvironmentConfig } from "@mcp-typescript-simple/config/environment";
import { OAuthProviderFactory } from "@mcp-typescript-simple/auth/factory";
import { OAuthProvider } from "@mcp-typescript-simple/auth/providers/types";
import { logger } from "@mcp-typescript-simple/observability/logger";

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
    const availableProviders = llmManager.getAvailableProviders();

    // Only register LLM tools if at least one provider has an API key
    if (availableProviders.length > 0) {
      registry.merge(createLLMTools(llmManager));
      logger.info("LLM tools registered successfully", { providers: availableProviders });
    } else {
      logger.info("No LLM providers available - skipping LLM tools registration");
    }
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

  // CRITICAL: Use createAsync() to enable Redis-backed session storage
  // The synchronous constructor defaults to MemoryMCPMetadataStore,
  // which breaks horizontal scalability in Vercel serverless
  instanceManagerInstance = await MCPInstanceManager.createAsync(toolRegistry);

  logger.info("MCP instance manager initialized");
  return instanceManagerInstance;
}

/**
 * Validate OAuth bearer token and extract auth info
 * Returns auth info if valid, throws error if invalid
 */
async function validateBearerToken(
  req: VercelRequest,
  requestId: string,
  oauthProviders: Map<string, OAuthProvider>
): Promise<{ provider: string; userId?: string; email?: string }> {
  logger.debug("Validating bearer token (multi-provider)", { requestId, providerCount: oauthProviders.size });

  // Validate Bearer token
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    logger.warn("Missing or invalid Authorization header", { requestId });
    throw new Error('Unauthorized: Bearer token required');
  }

  // Look up token in token stores to find which provider issued it (secure - local lookup only)
  const token = authHeader.substring(7);
  let providerType: string | undefined;
  let correctProvider: OAuthProvider | undefined;

  for (const [type, provider] of oauthProviders.entries()) {
    try {
      const hasToken = await provider.hasToken(token);
      if (hasToken) {
        providerType = type;
        correctProvider = provider;
        logger.debug("Token belongs to provider", { provider: type, requestId });
        break;
      }
    } catch (error) {
      logger.debug("Token lookup failed for provider", { provider: type, requestId, error });
      continue;
    }
  }

  if (!correctProvider || !providerType) {
    logger.warn("Token not found in any provider token store", { requestId });
    throw new Error('Unauthorized: Invalid or expired access token');
  }

  // Verify token with the correct provider
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
    throw new Error('Unauthorized: Token verification failed');
  }

  // Extract auth info for metadata
  const userInfo = authResult.extra?.userInfo as { sub?: string; email?: string } | undefined;
  return {
    provider: providerType,
    userId: userInfo?.sub,
    email: userInfo?.email,
  };
}

/**
 * Create new MCP transport and server for initialization request
 */
async function createNewTransportAndServer(
  requestId: string,
  instanceManager: MCPInstanceManager,
  authInfo?: { provider: string; userId?: string; email?: string }
): Promise<StreamableHTTPServerTransport> {
  logger.debug("Creating new transport for initialize request", { requestId });

  // Create new transport
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
      }
      // SECURITY: Math.random() fallback is safe here - only used when crypto.randomUUID is unavailable
      // Session IDs are opaque tokens, not used for security decisions
      // eslint-disable-next-line sonarjs/pseudo-random
      return 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
    },
    onsessioninitialized: async (newSessionId: string) => {
      logger.info("Transport session initialized", { sessionId: newSessionId, requestId });
      await instanceManager.storeSessionMetadata(newSessionId, authInfo);
    },
    onsessionclosed: async (closedSessionId: string) => {
      logger.info("Transport session closed", { sessionId: closedSessionId, requestId });
    },
    enableJsonResponse: EnvironmentConfig.get().MCP_LEGACY_CLIENT_SUPPORT,
    eventStore: undefined,
    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(','),
    allowedHosts: process.env.ALLOWED_HOSTS?.split(','),
    enableDnsRebindingProtection: !!(process.env.ALLOWED_HOSTS ?? process.env.ALLOWED_ORIGINS),
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

  return transport;
}

/**
 * Handle existing session request
 */
async function handleExistingSession(
  sessionId: string,
  requestId: string,
  instanceManager: MCPInstanceManager
): Promise<StreamableHTTPServerTransport> {
  try {
    const instance = await instanceManager.getOrRecreateInstance(sessionId, {
      enableJsonResponse: EnvironmentConfig.get().MCP_LEGACY_CLIENT_SUPPORT,
      allowedOrigins: process.env.ALLOWED_ORIGINS?.split(','),
      allowedHosts: process.env.ALLOWED_HOSTS?.split(','),
    });

    logger.debug("Reusing/reconstructed transport for session", { sessionId, requestId });
    return instance.transport;
  } catch (error) {
    logger.error("Failed to reconstruct session", { sessionId, requestId, error });
    throw new Error('Session not found or expired');
  }
}

/**
 * Handle new initialization request (creates new transport)
 */
async function handleNewInitialization(
  req: VercelRequest,
  requestId: string,
  instanceManager: MCPInstanceManager
): Promise<StreamableHTTPServerTransport> {
  // Check authentication if OAuth is configured (multi-provider support)
  const oauthProviders = await getOAuthProviders();
  const requireAuth = !!(oauthProviders?.size);
  let authInfo: { provider: string; userId?: string; email?: string } | undefined;

  if (requireAuth && oauthProviders?.size) {
    authInfo = await validateBearerToken(req, requestId, oauthProviders);
  }

  // Create new transport and server
  return await createNewTransportAndServer(requestId, instanceManager, authInfo);
}

/**
 * Vercel serverless function handler
 * Uses MCP instance manager for horizontal scalability
 *
 * Note: Cognitive complexity inherently high for serverless handlers
 * that must handle multiple request types and states in a single entry point
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const startTime = Date.now();
  const requestIdHeader = req.headers['x-request-id'];
  // SECURITY: Math.random() is safe here - used only for request correlation, not cryptographic security
  // eslint-disable-next-line sonarjs/pseudo-random
  const requestId = (Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader) ?? `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

  try {
    logger.debug("MCP serverless request received", {
      requestId,
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent'] ?? 'unknown'
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
    const sessionIdHeader = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sessionIdHeader) ? sessionIdHeader[0] : sessionIdHeader;
    let transport: StreamableHTTPServerTransport;

    if (sessionId) {
      // Session exists - get or reconstruct from metadata
      try {
        transport = await handleExistingSession(sessionId, requestId, instanceManager);
      } catch (error) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : 'Session not found or expired',
          },
          id: null,
        });
        return;
      }
    } else if (!sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
      // New initialization request - create new transport and server
      try {
        transport = await handleNewInitialization(req, requestId, instanceManager);
      } catch (error) {
        res.status(401).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : 'Unauthorized',
          },
          id: null,
        });
        return;
      }
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
    await transport.handleRequest(req as never, res as never, req.method === 'POST' ? req.body : undefined);

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