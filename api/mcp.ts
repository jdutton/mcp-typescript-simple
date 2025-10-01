/**
 * Vercel serverless function for MCP Streamable HTTP transport
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { LLMManager } from "../build/llm/manager.js";
import { setupMCPServer } from "../build/server/mcp-setup.js";
import { EnvironmentConfig } from "../build/config/environment.js";
import { logger } from "../build/utils/logger.js";

// Global instances for reuse across function invocations
let serverInstance: Server | null = null;
let llmManagerInstance: LLMManager | null = null;

/**
 * Initialize MCP server for serverless environment
 */
async function initializeMCPServer(): Promise<{ server: Server; llmManager: LLMManager }> {
  if (serverInstance && llmManagerInstance) {
    return { server: serverInstance, llmManager: llmManagerInstance };
  }

  logger.info("Initializing MCP server for Vercel");

  // Initialize LLM manager
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

  // Setup server with tools (this function should be extracted from index.ts)
  await setupMCPServer(server, llmManager);

  // Cache instances for reuse
  serverInstance = server;
  llmManagerInstance = llmManager;

  logger.info("MCP server initialized successfully");
  return { server, llmManager };
}

/**
 * Vercel serverless function handler
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Last-Event-ID');
    res.setHeader('X-Request-ID', requestId);

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      logger.debug("CORS preflight handled", { requestId });
      res.status(200).end();
      return;
    }

    // Initialize MCP server
    const { server } = await initializeMCPServer();

    // Create Streamable HTTP transport for this request
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => {
        // Generate session ID using crypto.randomUUID or fallback
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
          return crypto.randomUUID();
        }
        // Fallback for environments without crypto.randomUUID
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      },
      onsessioninitialized: async (sessionId: string) => {
        logger.info("Streamable HTTP session initialized", { sessionId });
      },
      onsessionclosed: async (sessionId: string) => {
        logger.info("Streamable HTTP session closed", { sessionId });
      },
      enableJsonResponse: EnvironmentConfig.get().MCP_LEGACY_CLIENT_SUPPORT, // Enable JSON responses for legacy client compatibility (e.g., MCP Inspector)
      eventStore: undefined, // For now, disable resumability in serverless
      allowedOrigins: process.env.ALLOWED_ORIGINS?.split(','),
      allowedHosts: process.env.ALLOWED_HOSTS?.split(','),
      enableDnsRebindingProtection: !!(process.env.ALLOWED_HOSTS || process.env.ALLOWED_ORIGINS),
    });

    // Connect the transport to the MCP server BEFORE handling the request
    // This is the correct order per MCP SDK documentation
    await server.connect(transport);

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
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}