/**
 * LLM Tool Infrastructure
 *
 * Core infrastructure for building LLM-powered MCP tools.
 * Does NOT include actual tool implementations - those are in example packages.
 */

// Export LLM manager and configuration
export { LLMManager } from './llm/manager.js';
export { LLMConfigManager } from './llm/config.js';

// Export LLM types
export type {
  LLMRequest,
  LLMResponse,
  LLMProvider,
  LLMConfig,
  AnyModel,
  ClaudeModel,
  OpenAIModel,
  GeminiModel,
  ModelsForProvider
} from './llm/types.js';

export {
  DEFAULT_TOOL_LLM_MAPPING,
  isValidModelForProvider,
  getDefaultModelForProvider
} from './llm/types.js';
