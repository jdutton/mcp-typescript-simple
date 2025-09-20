/**
 * Vercel serverless function for MCP Streamable HTTP transport
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { TieredSecretManager } from "../build/secrets/tiered-manager.js";
import { LLMManager } from "../build/llm/manager.js";
import { setupMCPServer } from "../build/server/mcp-setup.js";

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

  console.log('🚀 Initializing MCP server for Vercel...');

  // Initialize secret manager and LLM manager
  const secretManager = new TieredSecretManager();
  const llmManager = new LLMManager(secretManager);

  // Initialize LLM manager (gracefully handle missing API keys)
  try {
    await llmManager.initialize();
    console.log(`🤖 LLM providers available: ${llmManager.getAvailableProviders().join(", ")}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn("⚠️ LLM initialization failed - LLM tools will be unavailable:", errorMessage);
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

  console.log('✅ MCP server initialized successfully');
  return { server, llmManager };
}

/**
 * Vercel serverless function handler
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startTime = Date.now();
  const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    console.log(`📡 [${requestId}] MCP request: ${req.method} ${req.url} from ${req.headers['user-agent'] || 'unknown'}`);

    // Set CORS headers for browser requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Last-Event-ID');
    res.setHeader('X-Request-ID', requestId);

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      console.log(`✅ [${requestId}] CORS preflight handled`);
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
        console.log(`🔗 New Streamable HTTP session initialized: ${sessionId}`);
      },
      onsessionclosed: async (sessionId: string) => {
        console.log(`🔌 Streamable HTTP session closed: ${sessionId}`);
      },
      enableJsonResponse: false, // Use streaming for better UX
      eventStore: undefined, // For now, disable resumability in serverless
      allowedOrigins: process.env.ALLOWED_ORIGINS?.split(','),
      allowedHosts: process.env.ALLOWED_HOSTS?.split(','),
      enableDnsRebindingProtection: !!(process.env.ALLOWED_HOSTS || process.env.ALLOWED_ORIGINS),
    });

    // Handle the request with the transport
    await transport.handleRequest(req as any, res as any, req.method === 'POST' ? req.body : undefined);

    // Connect the transport to the MCP server
    await server.connect(transport);

    const duration = Date.now() - startTime;
    console.log(`✅ [${requestId}] MCP request completed in ${duration}ms`);

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ [${requestId}] MCP serverless function error after ${duration}ms:`, error);

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}