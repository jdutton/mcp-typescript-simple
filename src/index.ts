#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";

// Import secret management and LLM components
import { TieredSecretManager } from "./secrets/tiered-manager.js";
import { LLMManager } from "./llm/manager.js";

// Initialize secret manager and LLM manager
const secretManager = new TieredSecretManager();
const llmManager = new LLMManager(secretManager);

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

// Tool definitions
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
        const { handleChatTool } = await import('./tools/llm/chat.js');
        return await handleChatTool(args as any, llmManager);
      }

      case "analyze": {
        const { handleAnalyzeTool } = await import('./tools/llm/analyze.js');
        return await handleAnalyzeTool(args as any, llmManager);
      }

      case "summarize": {
        const { handleSummarizeTool } = await import('./tools/llm/summarize.js');
        return await handleSummarizeTool(args as any, llmManager);
      }

      case "explain": {
        const { handleExplainTool } = await import('./tools/llm/explain.js');
        return await handleExplainTool(args as any, llmManager);
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
    return {
      content: [
        {
          type: "text",
          text: `Error executing tool '${name}': ${errorMessage}`,
        },
      ],
    };
  }
});

async function main() {
  try {
    // Initialize LLM manager (gracefully handle missing API keys)
    try {
      await llmManager.initialize();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("⚠️  LLM initialization failed - LLM tools will be unavailable:", errorMessage);
      console.error("💡 To enable LLM tools, set API keys: ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY");
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("🚀 MCP TypeScript Simple server running on stdio");

    const availableProviders = llmManager.getAvailableProviders();
    if (availableProviders.length > 0) {
      console.error(`🤖 LLM providers available: ${availableProviders.join(", ")}`);
    } else {
      console.error("📝 Basic tools only (no LLM providers configured)");
    }
  } catch (error) {
    console.error("❌ Server startup failed:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});