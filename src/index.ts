#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

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

// Legacy tool definitions (will be removed after testing)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const availableProviders = llmManager.getAvailableProviders();
  const hasLLM = availableProviders.length > 0;

  const basicTools = [
    {
      name: "hello",
      description: "Say hello to someone",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The name of the person to greet",
          },
        },
        required: ["name"],
      },
    } as Tool,
    {
      name: "echo",
      description: "Echo back the provided message",
      inputSchema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message to echo back",
          },
        },
        required: ["message"],
      },
    } as Tool,
    {
      name: "current-time",
      description: "Get the current time",
      inputSchema: {
        type: "object",
        properties: {},
      },
    } as Tool,
  ];

  const llmTools = hasLLM ? [
    {
      name: "chat",
      description: "Chat with an AI assistant (Claude Haiku - fast responses)",
      inputSchema: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message to send to the AI assistant"
          }
        },
        required: ["message"]
      }
    } as Tool,
    {
      name: "analyze",
      description: "Analyze text for sentiment, themes, or structure (GPT-4 - deep analysis)",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text to analyze"
          }
        },
        required: ["text"]
      }
    } as Tool,
    {
      name: "summarize",
      description: "Summarize text in various formats and lengths (Gemini Flash - cost-effective)",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The text to summarize"
          }
        },
        required: ["text"]
      }
    } as Tool,
    {
      name: "explain",
      description: "Explain topics, concepts, or code at different levels (Claude - clear explanations)",
      inputSchema: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "The topic, concept, or code to explain"
          }
        },
        required: ["topic"]
      }
    } as Tool,
  ] : [];

  return {
    tools: [...basicTools, ...llmTools],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // Basic tools
      case "hello": {
        const { name: personName } = args as { name: string };
        return {
          content: [
            {
              type: "text",
              text: `Hello, ${personName}! Welcome to the MCP TypeScript Simple server with AI capabilities.`,
            },
          ],
        };
      }

      case "echo": {
        const { message } = args as { message: string };
        return {
          content: [
            {
              type: "text",
              text: `Echo: ${message}`,
            },
          ],
        };
      }

      case "current-time": {
        const now = new Date().toISOString();
        return {
          content: [
            {
              type: "text",
              text: `Current time: ${now}`,
            },
          ],
        };
      }

      // LLM-powered tools
      case "chat": {
        const { handleChatTool, parseChatToolInput } = await import('./tools/llm/chat.js');
        const parsedArgs = parseChatToolInput(args);
        return await handleChatTool(parsedArgs, llmManager);
      }

      case "analyze": {
        const { handleAnalyzeTool, parseAnalyzeToolInput } = await import('./tools/llm/analyze.js');
        const parsedArgs = parseAnalyzeToolInput(args);
        return await handleAnalyzeTool(parsedArgs, llmManager);
      }

      case "summarize": {
        const { handleSummarizeTool, parseSummarizeToolInput } = await import('./tools/llm/summarize.js');
        const parsedArgs = parseSummarizeToolInput(args);
        return await handleSummarizeTool(parsedArgs, llmManager);
      }

      case "explain": {
        const { handleExplainTool, parseExplainToolInput } = await import('./tools/llm/explain.js');
        const parsedArgs = parseExplainToolInput(args);
        return await handleExplainTool(parsedArgs, llmManager);
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Tool execution error for ${name}:`, errorMessage);

    // For unknown tools, let the error bubble up to MCP framework
    if (errorMessage.includes('Unknown tool')) {
      throw error;
    }

    // For other errors, return error content in response
    const errorPayload = {
      tool: name,
      code: 'TOOL_EXECUTION_ERROR',
      message: errorMessage
    };
    return {
      content: [
        {
          type: "text",
          text: `Error executing tool '${name}': ${errorMessage}`,
        },
        {
          type: 'json',
          json: { error: errorPayload }
        }
      ],
    };
  }
});

async function main() {
  try {
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

    // Initialize transport with server
    await transportManager.initialize(server);

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
