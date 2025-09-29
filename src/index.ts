#!/usr/bin/env node

// NOTE: Observability is initialized via --import flag in package.json (see dev:http script)
// This ensures auto-instrumentation hooks are registered before any modules load

import { Server } from "@modelcontextprotocol/sdk/server/index.js";

// Import LLM components
import { LLMManager } from "./llm/manager.js";

// Import new transport system
import { EnvironmentConfig } from "./config/environment.js";
import { TransportFactory } from "./transport/factory.js";
import { setupMCPServer } from "./server/mcp-setup.js";

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

    // Initialize LLM manager (gracefully handle missing API keys)
    try {
      await llmManager.initialize();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn("LLM initialization failed - LLM tools will be unavailable", {
        error: errorMessage,
        suggestion: "Set API keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY"
      });
    }

    // Setup MCP server with shared logic (used by both regular server and serverless functions)
    await setupMCPServer(server, llmManager);

    // Create and start transport
    const transportManager = TransportFactory.createFromEnvironment();

    // Initialize transport with server and LLM manager
    await transportManager.initialize(server, llmManager);

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
