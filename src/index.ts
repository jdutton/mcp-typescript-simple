#!/usr/bin/env node

// NOTE: Observability is initialized via --import flag in package.json (see dev:http script)
// This ensures auto-instrumentation hooks are registered before any modules load

import { Server } from "@modelcontextprotocol/sdk/server/index.js";

// Import package-based tools
import { ToolRegistry } from "@mcp-typescript-simple/tools";
import { basicTools } from "@mcp-typescript-simple/example-tools-basic";
import { LLMManager } from "@mcp-typescript-simple/tools-llm";
import { createLLMTools } from "@mcp-typescript-simple/example-tools-llm";

// Import new transport system
import { EnvironmentConfig } from "./config/environment.js";
import { TransportFactory } from "./transport/factory.js";
import { setupMCPServerWithRegistry } from "./server/mcp-setup-registry.js";

// Import structured logger
import { logger } from "./utils/logger.js";

// Initialize LLM manager
const llmManager = new LLMManager();

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

async function main() {
  try {
    // Load environment configuration
    const config = EnvironmentConfig.get();
    const mode = EnvironmentConfig.getTransportMode();

    logger.info(`Starting MCP TypeScript Simple server in ${mode} mode`, {
      mode,
      environment: config.NODE_ENV
    });

    // Log configuration for debugging
    EnvironmentConfig.logConfiguration();

    // Create tool registry with basic tools
    const toolRegistry = new ToolRegistry();
    toolRegistry.merge(basicTools);
    logger.info("Basic tools loaded", { count: basicTools.list().length });

    // Initialize LLM manager and add LLM tools (gracefully handle missing API keys)
    try {
      await llmManager.initialize();
      const llmTools = createLLMTools(llmManager);
      toolRegistry.merge(llmTools);
      logger.info("LLM tools loaded", { count: llmTools.list().length });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn("LLM initialization failed - LLM tools will be unavailable", {
        error: errorMessage,
        suggestion: "Set API keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY"
      });
    }

    // Setup MCP server with tool registry (new package-based architecture)
    await setupMCPServerWithRegistry(server, toolRegistry);

    // Create and start transport
    const transportManager = TransportFactory.createFromEnvironment();

    // Initialize transport with server (tools are now in registry, no need for llmManager)
    await transportManager.initialize(server);

    // Start the transport
    await transportManager.start();

    // Display status information
    const availableProviders = llmManager.getAvailableProviders();
    logger.info("MCP server ready", {
      transport: transportManager.getInfo(),
      llmProviders: availableProviders.length > 0 ? availableProviders : null,
      basicToolsOnly: availableProviders.length === 0
    });

    // Handle graceful shutdown
    const handleShutdown = async (signal: string) => {
      logger.info("Received shutdown signal, shutting down gracefully", { signal });
      try {
        await transportManager.stop();
        logger.info("Server stopped successfully");
        process.exit(0);
      } catch (error) {
        logger.error("Error during shutdown", error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  } catch (error) {
    logger.error("Server startup failed", error);
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error("Unhandled server error", error);
  process.exit(1);
});
