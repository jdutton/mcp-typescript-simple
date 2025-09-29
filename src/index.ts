#!/usr/bin/env node

// Initialize observability FIRST - must be before other imports for auto-instrumentation
import { initializeObservability } from "./observability/index.js";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";

// Import LLM components
import { LLMManager } from "./llm/manager.js";

// Import new transport system
import { EnvironmentConfig } from "./config/environment.js";
import { TransportFactory } from "./transport/factory.js";
import { setupMCPServer } from "./server/mcp-setup.js";

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
    // Initialize observability first
    await initializeObservability();

    // Load environment configuration
    const config = EnvironmentConfig.get();
    const mode = EnvironmentConfig.getTransportMode();

    console.error(`🚀 Starting MCP TypeScript Simple server in ${mode} mode`);
    console.error(`📊 Environment: ${config.NODE_ENV}`);

    // Log configuration for debugging
    EnvironmentConfig.logConfiguration();

    // Initialize LLM manager (gracefully handle missing API keys)
    try {
      await llmManager.initialize();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("⚠️  LLM initialization failed - LLM tools will be unavailable:", errorMessage);
      console.error("💡 To enable LLM tools, set API keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY");
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
    console.error(`🔗 Transport: ${transportManager.getInfo()}`);

    const availableProviders = llmManager.getAvailableProviders();
    if (availableProviders.length > 0) {
      console.error(`🤖 LLM providers available: ${availableProviders.join(", ")}`);
    } else {
      console.error("📝 Basic tools only (no LLM providers configured)");
    }

    // Handle graceful shutdown
    const handleShutdown = async (signal: string) => {
      console.error(`\n⚠️  Received ${signal}, shutting down gracefully...`);
      try {
        await transportManager.stop();
        console.error("✅ Server stopped successfully");
        process.exit(0);
      } catch (error) {
        console.error("❌ Error during shutdown:", error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));

  } catch (error) {
    console.error("❌ Server startup failed:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
