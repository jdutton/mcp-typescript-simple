/**
 * Tool definition types for MCP framework
 */

import { Tool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z, ZodType } from 'zod';

/**
 * Tool handler function that processes tool input and returns a result
 */
export type ToolHandler<TInput = unknown> = (
  input: TInput
) => Promise<CallToolResult>;

/**
 * Tool definition with type-safe input schema
 *
 * This is a wrapper around the MCP SDK Tool type that provides:
 * - Type inference from Zod schemas
 * - Runtime validation
 * - Testability (can invoke handler directly)
 * - Compatibility with standard MCP Tool type
 */
export interface ToolDefinition<TInput = unknown> {
  /** Tool name - used for invocation */
  name: string;

  /** Human-readable description of what the tool does */
  description: string;

  /** Zod schema for input validation and type inference */
  inputSchema: ZodType<TInput>;

  /** Handler function that processes the tool invocation */
  handler: ToolHandler<TInput>;
}

/**
 * Convert a ToolDefinition to the standard MCP SDK Tool type
 */
export function toMCPTool<TInput>(definition: ToolDefinition<TInput>): Tool {
  // Convert Zod schema to JSON Schema for MCP SDK
  // Note: This is a simplified conversion - may need zodToJsonSchema library for complex schemas
  const jsonSchema = zodToJsonSchema(definition.inputSchema);

  return {
    name: definition.name,
    description: definition.description,
    inputSchema: jsonSchema as any, // Type assertion needed for MCP SDK compatibility
  };
}

/**
 * Simple Zod to JSON Schema converter for basic types
 * For production, consider using zod-to-json-schema library
 */
function zodToJsonSchema(schema: ZodType<any>): Record<string, any> {
  // Try to get the JSON schema directly if available
  const zodDef = (schema as any)._def;

  if (zodDef?.typeName === 'ZodObject') {
    const shape = zodDef.shape();
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const propSchema = value as ZodType<any>;
      properties[key] = zodToJsonSchema(propSchema);

      // Check if field is optional
      if ((propSchema as any)._def?.typeName !== 'ZodOptional') {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  if (zodDef?.typeName === 'ZodString') {
    const description = zodDef.description;
    return {
      type: 'string',
      ...(description ? { description } : {}),
    };
  }

  if (zodDef?.typeName === 'ZodNumber') {
    const description = zodDef.description;
    return {
      type: 'number',
      ...(description ? { description } : {}),
    };
  }

  if (zodDef?.typeName === 'ZodBoolean') {
    const description = zodDef.description;
    return {
      type: 'boolean',
      ...(description ? { description } : {}),
    };
  }

  if (zodDef?.typeName === 'ZodEnum') {
    const description = zodDef.description;
    return {
      type: 'string',
      enum: zodDef.values,
      ...(description ? { description } : {}),
    };
  }

  if (zodDef?.typeName === 'ZodOptional') {
    return zodToJsonSchema(zodDef.innerType);
  }

  // Fallback for unknown types
  return { type: 'object' };
}
