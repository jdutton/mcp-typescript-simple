/**
 * Shared MCP server setup logic for both regular server and serverless functions
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { LLMManager } from "../llm/manager.js";
import { logger } from "../utils/logger.js";

/**
 * Build dynamic provider/model descriptions based on available providers
 */
function buildProviderDescription(
  schemaInfo: Awaited<ReturnType<LLMManager['getSchemaInfo']>>,
  defaultProvider: string
): string {
  const providerNames = schemaInfo.providers.map(p => p.name).join(', ');
  return `AI provider to use. Available: ${providerNames} (default: ${defaultProvider})`;
}

function buildModelDescription(
  schemaInfo: Awaited<ReturnType<LLMManager['getSchemaInfo']>>
): string {
  const examples = schemaInfo.providers
    .filter(p => p.models.length > 0)
    .map(p => `${p.name}: ${p.models.slice(0, 2).join(', ')}`)
    .join('; ');
  return `Specific model to use (must be valid for the selected provider). Examples: ${examples}`;
}

/**
 * Set up MCP server with tools and handlers
 */
export async function setupMCPServer(server: Server, llmManager: LLMManager): Promise<void> {
  // Tool definitions
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const availableProviders = llmManager.getAvailableProviders();
    const hasLLM = availableProviders.length > 0;

    // Get schema info for dynamic descriptions
    const schemaInfo = hasLLM ? await llmManager.getSchemaInfo() : null;

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
      },
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
      },
      {
        name: "current-time",
        description: "Get the current timestamp",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ];

    // Build tool-specific defaults
    const chatDefaults = hasLLM ? llmManager.getProviderForTool('chat') : null;
    const analyzeDefaults = hasLLM ? llmManager.getProviderForTool('analyze') : null;
    const summarizeDefaults = hasLLM ? llmManager.getProviderForTool('summarize') : null;
    const explainDefaults = hasLLM ? llmManager.getProviderForTool('explain') : null;

    const llmTools = (hasLLM && schemaInfo) ? [
      {
        name: "chat",
        description: "Interactive AI assistant with flexible provider and model selection",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "Your message to the AI assistant",
            },
            system_prompt: {
              type: "string",
              description: "Optional system prompt to customize the assistant's behavior",
            },
            temperature: {
              type: "number",
              description: "Temperature for response generation (0.0-2.0, default: 0.7)",
              minimum: 0,
              maximum: 2,
            },
            provider: {
              type: "string",
              enum: schemaInfo.providers.map(p => p.name),
              description: buildProviderDescription(schemaInfo, chatDefaults?.provider || 'claude'),
            },
            model: {
              type: "string",
              description: buildModelDescription(schemaInfo),
            },
          },
          required: ["message"],
        },
      },
      {
        name: "analyze",
        description: "Deep text analysis with configurable AI models",
        inputSchema: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Text to analyze",
            },
            analysis_type: {
              type: "string",
              enum: ["sentiment", "themes", "structure", "comprehensive", "summary"],
              description: "Type of analysis to perform. Options: sentiment, themes, structure, comprehensive, summary (default: comprehensive)",
            },
            focus: {
              type: "string",
              description: "Specific aspect to focus the analysis on",
            },
            provider: {
              type: "string",
              enum: schemaInfo.providers.map(p => p.name),
              description: buildProviderDescription(schemaInfo, analyzeDefaults?.provider || 'openai'),
            },
            model: {
              type: "string",
              description: buildModelDescription(schemaInfo),
            },
          },
          required: ["text"],
        },
      },
      {
        name: "summarize",
        description: "Text summarization with cost-effective model options",
        inputSchema: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Text to summarize",
            },
            length: {
              type: "string",
              enum: ["brief", "medium", "detailed"],
              description: "Length of the summary. Options: brief, medium, detailed (default: medium)",
            },
            format: {
              type: "string",
              enum: ["paragraph", "bullets", "outline"],
              description: "Format of the summary. Options: paragraph, bullets, outline (default: paragraph)",
            },
            focus: {
              type: "string",
              description: "Specific aspect to focus the summary on",
            },
            provider: {
              type: "string",
              enum: schemaInfo.providers.map(p => p.name),
              description: buildProviderDescription(schemaInfo, summarizeDefaults?.provider || 'gemini'),
            },
            model: {
              type: "string",
              description: buildModelDescription(schemaInfo),
            },
          },
          required: ["text"],
        },
      },
      {
        name: "explain",
        description: "Educational explanations with adaptive AI models",
        inputSchema: {
          type: "object",
          properties: {
            topic: {
              type: "string",
              description: "Topic, concept, or code to explain",
            },
            level: {
              type: "string",
              enum: ["beginner", "intermediate", "advanced"],
              description: "Explanation level. Options: beginner, intermediate, advanced (default: intermediate)",
            },
            context: {
              type: "string",
              description: "Additional context or domain",
            },
            include_examples: {
              type: "boolean",
              description: "Include examples in the explanation (default: true)",
            },
            provider: {
              type: "string",
              enum: schemaInfo.providers.map(p => p.name),
              description: buildProviderDescription(schemaInfo, explainDefaults?.provider || 'claude'),
            },
            model: {
              type: "string",
              description: buildModelDescription(schemaInfo),
            },
          },
          required: ["topic"],
        },
      },
    ] : [];

    return {
      tools: [...basicTools, ...llmTools],
    };
  });

  // Tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "hello": {
          const { name: userName } = args as { name: string };
          return {
            content: [
              {
                type: "text",
                text: `Hello, ${userName}! 👋`,
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
          const now = new Date();
          return {
            content: [
              {
                type: "text",
                text: `Current time: ${now.toISOString()}`,
              },
            ],
          };
        }

        case "chat": {
          const { handleChatTool, parseChatToolInput } = await import('../tools/llm/chat.js');
          const parsedArgs = parseChatToolInput(args);
          return await handleChatTool(parsedArgs, llmManager);
        }

        case "analyze": {
          const { handleAnalyzeTool, parseAnalyzeToolInput } = await import('../tools/llm/analyze.js');
          const parsedArgs = parseAnalyzeToolInput(args);
          return await handleAnalyzeTool(parsedArgs, llmManager);
        }

        case "summarize": {
          const { handleSummarizeTool, parseSummarizeToolInput } = await import('../tools/llm/summarize.js');
          const parsedArgs = parseSummarizeToolInput(args);
          return await handleSummarizeTool(parsedArgs, llmManager);
        }

        case "explain": {
          const { handleExplainTool, parseExplainToolInput } = await import('../tools/llm/explain.js');
          const parsedArgs = parseExplainToolInput(args);
          return await handleExplainTool(parsedArgs, llmManager);
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Tool execution error", { tool: name, error: errorMessage });

      // For unknown tools, let the error bubble up to MCP framework
      if (errorMessage.includes('Unknown tool')) {
        throw error;
      }

      // For other errors, return error content in response
      return {
        content: [
          {
            type: "text",
            text: `Error executing tool '${name}': ${errorMessage}\n\nError details:\n- Tool: ${name}\n- Code: TOOL_EXECUTION_ERROR`,
          }
        ],
      };
    }
  });
}
