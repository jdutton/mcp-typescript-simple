/**
 * LLM integration types and interfaces
 */

export interface LLMConfig {
  /**
   * Default provider to use
   */
  defaultProvider: LLMProvider;

  /**
   * Provider configurations
   */
  providers: {
    claude: ClaudeConfig;
    openai: OpenAIConfig;
    gemini: GeminiConfig;
  };

  /**
   * Request timeout in milliseconds
   */
  timeout: number;

  /**
   * Default temperature to use for LLM requests when not specified (0-2)
   */
  defaultTemperature: number;

  /**
   * Whether to enable response caching
   */
  cacheEnabled: boolean;

  /**
   * Cache TTL in milliseconds
   */
  cacheTtl: number;

  /**
   * Maximum retries for failed requests
   */
  maxRetries: number;
}

export type LLMProvider = 'claude' | 'openai' | 'gemini';

// Define available models for each provider
// Updated to Claude 4/3.5 models (September 2025)
export type ClaudeModel =
  | 'claude-3-5-haiku-20241022'      // Latest Haiku (Oct 2024)
  | 'claude-3-haiku-20240307'         // Previous Haiku (Mar 2024) - still supported
  | 'claude-sonnet-4-5-20250929'     // Latest Sonnet (Sep 2025)
  | 'claude-3-7-sonnet-20250219';    // Previous Sonnet (Feb 2025) - still supported

export type OpenAIModel = 'gpt-3.5-turbo' | 'gpt-4' | 'gpt-4-turbo' | 'gpt-4o' | 'gpt-4o-mini';
// Gemini model names - October 2025 current models
// NOTE: All Gemini 1.5 and 1.0 models have been RETIRED as of October 2025
export type GeminiModel =
  | 'gemini-2.5-flash'          // Stable, recommended for production (best price/performance)
  | 'gemini-2.5-flash-lite'     // Faster, cheaper variant
  | 'gemini-2.0-flash';         // Previous generation, still supported

// Type-safe provider-model mapping
export interface ProviderModelMap {
  claude: ClaudeModel;
  openai: OpenAIModel;
  gemini: GeminiModel;
}

// Utility type to get valid models for a provider
export type ModelsForProvider<T extends LLMProvider> = ProviderModelMap[T];

// Union of all possible models
export type AnyModel = ClaudeModel | OpenAIModel | GeminiModel;

export interface ClaudeConfig {
  apiKey: string;
  models: {
    [K in ClaudeModel]: {
      maxTokens: number;
      available: boolean;
    };
  };
  defaultModel: ClaudeModel;
}

export interface OpenAIConfig {
  apiKey: string;
  models: {
    [K in OpenAIModel]: {
      maxTokens: number;
      available: boolean;
    };
  };
  defaultModel: OpenAIModel;
}

export interface GeminiConfig {
  apiKey: string;
  models: {
    [K in GeminiModel]: {
      maxTokens: number;
      available: boolean;
    };
  };
  defaultModel: GeminiModel;
}

// Base LLM request interface
export interface LLMRequest {
  message: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  provider?: LLMProvider;
  model?: AnyModel;
}

// Type-safe LLM request for specific provider
export interface TypedLLMRequest<T extends LLMProvider> {
  message: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  provider: T;
  model?: ModelsForProvider<T>;
}

// Utility type for provider-specific requests
export type ClaudeLLMRequest = TypedLLMRequest<'claude'>;
export type OpenAILLMRequest = TypedLLMRequest<'openai'>;
export type GeminiLLMRequest = TypedLLMRequest<'gemini'>;

export interface LLMResponse {
  content: string;
  provider: LLMProvider;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  responseTime: number;
}

// Enhanced tool mapping with provider and model preferences
export interface ToolLLMMapping {
  [toolName: string]: {
    provider: LLMProvider;
    model?: AnyModel;
    description: string;
  };
}

export const DEFAULT_TOOL_LLM_MAPPING: ToolLLMMapping = {
  'chat': {
    provider: 'claude',
    model: 'claude-3-5-haiku-20241022',
    description: 'Fast responses with Claude 3.5 Haiku'
  },
  'analyze': {
    provider: 'openai',
    model: 'gpt-4o',
    description: 'Deep analysis with GPT-4o'
  },
  'summarize': {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    description: 'Cost-effective summarization with Gemini 2.5 Flash'
  },
  'explain': {
    provider: 'claude',
    model: 'claude-3-7-sonnet-20250219',
    description: 'Clear explanations with Claude 3.7 Sonnet'
  }
};

// Utility functions for model validation
export function isValidModelForProvider<T extends LLMProvider>(
  provider: T,
  model: AnyModel
): model is ModelsForProvider<T> {
  const validModels: Record<LLMProvider, readonly AnyModel[]> = {
    claude: [
      'claude-3-5-haiku-20241022',
      'claude-3-haiku-20240307',
      'claude-sonnet-4-5-20250929',
      'claude-3-7-sonnet-20250219'
    ],
    openai: ['gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo', 'gpt-4o', 'gpt-4o-mini'],
    gemini: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']
  };

  return validModels[provider].includes(model);
}

// Helper function to get default model for a provider
export function getDefaultModelForProvider(provider: LLMProvider): AnyModel {
  const defaults: Record<LLMProvider, AnyModel> = {
    claude: 'claude-3-5-haiku-20241022', // Latest Haiku for speed
    openai: 'gpt-4o-mini', // Cost-effective GPT-4 level performance
    gemini: 'gemini-2.5-flash' // Gemini 2.5 Flash (October 2025)
  };

  return defaults[provider];
}