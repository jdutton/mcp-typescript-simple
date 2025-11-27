/**
 * Tool registry for managing and invoking MCP tools
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { emitOCSFEvent, apiActivityEvent, StatusId, APIActivityId } from '@mcp-typescript-simple/observability/ocsf';
import { ToolDefinition, toMCPTool } from './types.js';

/**
 * Registry for managing MCP tools with type-safe invocation
 *
 * Features:
 * - Tool registration and lookup
 * - Type-safe tool invocation
 * - Input validation via Zod schemas
 * - Standard MCP SDK Tool list generation
 * - Testability (can invoke tools directly without server)
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition<any>> = new Map();

  /**
   * Register a tool in the registry
   */
  add<TInput>(tool: ToolDefinition<TInput>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Get a tool definition by name
   */
  get(name: string): ToolDefinition<any> | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool is registered
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all tool names
   */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get MCP SDK Tool list (for ListTools response)
   */
  list(): Tool[] {
    return Array.from(this.tools.values()).map(toMCPTool);
  }

  /**
   * Invoke a tool by name with runtime validation
   *
   * @param name - Tool name
   * @param args - Tool arguments (will be validated against schema)
   * @returns Tool execution result
   * @throws Error if tool not found or validation fails
   */
  async call(name: string, args: unknown): Promise<CallToolResult> {
    const startTime = Date.now();
    const tool = this.tools.get(name);

    if (!tool) {
      // Emit API Activity event for unknown tool (failure)
      emitOCSFEvent(
        apiActivityEvent(APIActivityId.Other)
          .actor({ user: { name: 'system', uid: 'system' } })
          .api({
            operation: 'invoke',
            service: { name: 'mcp.tool' },
            version: '1.0',
          })
          .status(StatusId.Failure)
          .message(`Unknown tool: ${name}`)
          .resource({ name, type: 'tool' })
          .duration(Date.now() - startTime)
          .build()
      );
      throw new Error(`Unknown tool: ${name}`);
    }

    // Validate input against Zod schema
    const parseResult = tool.inputSchema.safeParse(args);

    if (!parseResult.success) {
      const errors = parseResult.error.errors
        .map(err => `${err.path.join('.')}: ${err.message}`)
        .join(', ');

      // Emit API Activity event for validation failure
      emitOCSFEvent(
        apiActivityEvent(APIActivityId.Other)
          .actor({ user: { name: 'system', uid: 'system' } })
          .api({
            operation: 'invoke',
            service: { name: 'mcp.tool' },
            version: '1.0',
          })
          .status(StatusId.Failure)
          .message(`Invalid input for tool '${name}': ${errors}`)
          .resource({ name, type: 'tool' })
          .duration(Date.now() - startTime)
          .build()
      );
      throw new Error(`Invalid input for tool '${name}': ${errors}`);
    }

    try {
      // Invoke tool handler with validated input
      const result = await tool.handler(parseResult.data);

      // Emit API Activity event for successful tool invocation
      emitOCSFEvent(
        apiActivityEvent(APIActivityId.Other)
          .actor({ user: { name: 'system', uid: 'system' } })
          .api({
            operation: 'invoke',
            service: { name: 'mcp.tool' },
            version: '1.0',
          })
          .status(StatusId.Success)
          .message(`Tool '${name}' executed successfully`)
          .resource({ name, type: 'tool' })
          .duration(Date.now() - startTime)
          .build()
      );

      return result;
    } catch (error) {
      // Emit API Activity event for tool execution failure
      const errorMessage = error instanceof Error ? error.message : String(error);
      emitOCSFEvent(
        apiActivityEvent(APIActivityId.Other)
          .actor({ user: { name: 'system', uid: 'system' } })
          .api({
            operation: 'invoke',
            service: { name: 'mcp.tool' },
            version: '1.0',
          })
          .status(StatusId.Failure)
          .message(`Tool '${name}' execution failed: ${errorMessage}`)
          .resource({ name, type: 'tool' })
          .duration(Date.now() - startTime)
          .build()
      );
      throw error;
    }
  }

  /**
   * Merge another registry into this one
   *
   * @throws Error if there are conflicting tool names
   */
  merge(other: ToolRegistry): void {
    for (const [name, tool] of other.tools) {
      if (this.tools.has(name)) {
        throw new Error(`Cannot merge: tool '${name}' already exists`);
      }
      this.tools.set(name, tool);
    }
  }

  /**
   * Get the number of registered tools
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.tools.clear();
  }
}
