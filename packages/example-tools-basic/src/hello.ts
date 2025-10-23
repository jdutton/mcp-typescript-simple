/**
 * Hello tool - greets a user by name
 *
 * Example tool demonstrating:
 * - Simple string input
 * - Basic text response
 * - Type-safe schema definition
 */

import { defineTool } from '@mcp-typescript-simple/tools';
import { z } from 'zod';

export const helloTool = defineTool({
  name: 'hello',
  description: 'Say hello to someone',
  inputSchema: z.object({
    name: z.string().describe('The name of the person to greet'),
  }),
  handler: async ({ name }) => ({
    content: [
      {
        type: 'text',
        text: `Hello, ${name}! 👋`,
      },
    ],
  }),
});
