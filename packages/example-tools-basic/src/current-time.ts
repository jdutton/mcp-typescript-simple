/**
 * Current time tool - returns the current timestamp
 *
 * Example tool demonstrating:
 * - No input parameters (empty schema)
 * - Server-side data generation
 * - ISO 8601 timestamp formatting
 */

import { defineTool } from '@mcp-typescript-simple/tools';
import { z } from 'zod';

export const currentTimeTool = defineTool({
  name: 'current-time',
  description: 'Get the current timestamp',
  inputSchema: z.object({}), // No input required
  handler: async () => {
    const now = new Date();
    return {
      content: [
        {
          type: 'text',
          text: `Current time: ${now.toISOString()}`,
        },
      ],
    };
  },
});
