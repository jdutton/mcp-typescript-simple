/**
 * Echo tool - echoes back the provided message
 *
 * Example tool demonstrating:
 * - Simple passthrough logic
 * - String manipulation
 * - Basic validation
 */

import { defineTool } from '@mcp-typescript-simple/tools';
import { z } from 'zod';

export const echoTool = defineTool({
  name: 'echo',
  description: 'Echo back the provided message',
  inputSchema: z.object({
    message: z.string().describe('The message to echo back'),
  }),
  handler: async ({ message }) => ({
    content: [
      {
        type: 'text',
        text: `Echo: ${message}`,
      },
    ],
  }),
});
