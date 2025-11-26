/**
 * MCP server setup using ToolRegistry (new package-based architecture)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ToolRegistry } from "@mcp-typescript-simple/tools";

/**
 * Optional logger interface for server operations
 */
export interface ServerLogger {
  debug(message: string, data?: unknown): void;
  error(message: string, error?: unknown): void;
}

/**
 * Simple console-based logger fallback
 */
const defaultLogger: ServerLogger = {
  debug: () => {}, // Silent by default
  error: (message: string, error?: unknown) => {
     
    console.error(message, error);
  },
};

/**
 * Set up MCP server with tools from a registry
 *
 * This is the new architecture using extracted packages.
 */
export async function setupMCPServerWithRegistry(
  server: Server,
  registry: ToolRegistry,
  logger: ServerLogger = defaultLogger
): Promise<void> {
  // Tool definitions - get from registry
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = registry.list();
    logger.debug("Listing tools from registry", { count: tools.length, tools: tools.map((t: { name: string }) => t.name) });
    return { tools };
  });

  // Tool call handler - delegate to registry
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      logger.debug("Executing tool from registry", { tool: name });
      return await registry.call(name, args);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Tool execution error", { tool: name, error: errorMessage });

      // For unknown tools, let the error bubble up to MCP framework
      if (errorMessage.includes('Unknown tool') || errorMessage.includes('not found')) {
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
