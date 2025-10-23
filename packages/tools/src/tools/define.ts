/**
 * Helper function for defining tools with type inference
 */

import { ZodType } from 'zod';
import { ToolDefinition, ToolHandler } from './types.js';

/**
 * Define a tool with automatic type inference from Zod schema
 *
 * Example:
 * ```typescript
 * const myTool = defineTool({
 *   name: 'greet',
 *   description: 'Greet someone by name',
 *   inputSchema: z.object({
 *     name: z.string().describe('Name of person to greet')
 *   }),
 *   handler: async ({ name }) => ({
 *     content: [{ type: 'text', text: `Hello, ${name}!` }]
 *   })
 * });
 * ```
 */
export function defineTool<TInput>(config: {
  name: string;
  description: string;
  inputSchema: ZodType<TInput>;
  handler: ToolHandler<TInput>;
}): ToolDefinition<TInput> {
  return {
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    handler: config.handler,
  };
}
