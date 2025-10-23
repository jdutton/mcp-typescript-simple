/**
 * Example LLM MCP Tools
 *
 * This package provides example LLM-powered MCP tools for:
 * - **Demonstration**: Show how to integrate LLMs with MCP tools
 * - **Testing**: Validate framework with complex LLM operations
 * - **Reference**: Starting point for building LLM-powered tools
 *
 * These are intentionally generic tools that serve as examples.
 */

import { ToolRegistry } from '@mcp-typescript-simple/tools';
import { LLMManager } from '@mcp-typescript-simple/tools-llm';
import { createChatTool } from './chat.js';
import { createAnalyzeTool } from './analyze.js';
import { createSummarizeTool } from './summarize.js';
import { createExplainTool } from './explain.js';

/**
 * Create LLM tools registry with initialized LLM manager
 *
 * Usage:
 * ```typescript
 * import { createLLMTools } from '@mcp-typescript-simple/example-tools-llm';
 * import { LLMManager } from '@mcp-typescript-simple/tools-llm';
 *
 * const llmManager = new LLMManager();
 * await llmManager.initialize();
 *
 * const llmTools = createLLMTools(llmManager);
 *
 * // Get MCP Tool list
 * const tools = llmTools.list();
 *
 * // Invoke a tool
 * const result = await llmTools.call('chat', {
 *   message: 'Hello!',
 *   provider: 'claude'
 * });
 * ```
 */
export function createLLMTools(llmManager: LLMManager): ToolRegistry {
  const registry = new ToolRegistry();

  // Add all LLM-powered tools
  registry.add(createChatTool(llmManager));
  registry.add(createAnalyzeTool(llmManager));
  registry.add(createSummarizeTool(llmManager));
  registry.add(createExplainTool(llmManager));

  return registry;
}

// Export individual tool creators for custom composition
export { createChatTool } from './chat.js';
export { createAnalyzeTool } from './analyze.js';
export { createSummarizeTool } from './summarize.js';
export { createExplainTool } from './explain.js';
