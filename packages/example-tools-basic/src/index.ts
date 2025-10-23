/**
 * Basic MCP Tools - Example Tool Pack
 *
 * This package provides a collection of simple, example MCP tools for:
 * - **Demonstration**: Show how to build MCP tools with the framework
 * - **Testing**: Validate framework functionality
 * - **Reference**: Starting point for building your own tools
 *
 * These tools are intentionally simple and have no real-world utility
 * beyond serving as examples and test fixtures.
 */

import { ToolRegistry } from '@mcp-typescript-simple/tools';
import { helloTool } from './hello.js';
import { echoTool } from './echo.js';
import { currentTimeTool } from './current-time.js';

/**
 * Pre-configured registry with all basic tools
 *
 * Usage:
 * ```typescript
 * import { basicTools } from '@mcp-typescript-simple/tools-basic';
 *
 * // Get MCP Tool list
 * const tools = basicTools.list();
 *
 * // Invoke a tool
 * const result = await basicTools.call('hello', { name: 'World' });
 * ```
 */
export const basicTools = new ToolRegistry();
basicTools.add(currentTimeTool); // Most commonly used for testing
basicTools.add(helloTool);
basicTools.add(echoTool);

// Export individual tools for custom composition
export { helloTool } from './hello.js';
export { echoTool } from './echo.js';
export { currentTimeTool } from './current-time.js';
