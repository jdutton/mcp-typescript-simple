/**
 * LLM manager using official provider SDKs
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  Message as AnthropicMessage,
  MessageCreateParamsNonStreaming,
  MessageParam as AnthropicMessageParam,
  TextBlock
} from '@anthropic-ai/sdk/resources/messages/messages.js';
import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming
} from 'openai/resources/chat/completions/completions.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { GenerateContentRequest, GenerateContentResult } from '@google/generative-ai';
import { LLMConfigManager } from './config.js';
import {
  LLMRequest,
  LLMResponse,
  LLMProvider,
  DEFAULT_TOOL_LLM_MAPPING,
  isValidModelForProvider,
  getDefaultModelForProvider,
  AnyModel,
  ModelsForProvider
} from './types.js';
import { logger } from '../utils/logger.js';

type ProviderClientRegistry = {
  claude: Anthropic;
  openai: OpenAI;
  gemini: GoogleGenerativeAI;
};

type ClaudeRequestParams = MessageCreateParamsNonStreaming;
type ClaudeResponse = AnthropicMessage;
type ClaudeMessageParam = AnthropicMessageParam;
type OpenAIRequestParams = ChatCompletionCreateParamsNonStreaming;
type OpenAIResponse = ChatCompletion;
type GeminiResponse = GenerateContentResult;

export class LLMManager {
  private configManager: LLMConfigManager;
  private clients: Partial<ProviderClientRegistry> = {};
  private cache = new Map<string, { response: LLMResponse; expires: Date }>();

  constructor() {
    this.configManager = new LLMConfigManager();
  }

  async initialize(): Promise<void> {
    const config = await this.configManager.loadConfig();

    // Initialize Claude client
    if (config.providers.claude.apiKey) {
      try {
        const anthropic = new Anthropic({
          apiKey: config.providers.claude.apiKey,
        });
        this.clients.claude = anthropic;
        logger.info('Claude client initialized', { provider: 'claude' });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn('Failed to initialize Claude client', { provider: 'claude', error: errorMessage });
      }
    }

    // Initialize OpenAI client
    if (config.providers.openai.apiKey) {
      try {
        const openai = new OpenAI({
          apiKey: config.providers.openai.apiKey,
        });
        this.clients.openai = openai;
        logger.info('OpenAI client initialized', { provider: 'openai' });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn('Failed to initialize OpenAI client', { provider: 'openai', error: errorMessage });
      }
    }

    // Initialize Gemini client
    if (config.providers.gemini.apiKey) {
      try {
        const genAI = new GoogleGenerativeAI(config.providers.gemini.apiKey);
        this.clients.gemini = genAI;
        logger.info('Gemini client initialized', { provider: 'gemini' });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn('Failed to initialize Gemini client', { provider: 'gemini', error: errorMessage });
      }
    }

    if (this.getAvailableProviders().length === 0) {
      throw new Error('No LLM clients could be initialized - check your API keys');
    }

    logger.info('LLM Manager initialized', { providerCount: this.getAvailableProviders().length, providers: this.getAvailableProviders() });
  }

  async complete(request: LLMRequest & { _fallbackAttempted?: boolean }): Promise<LLMResponse> {
    const startTime = Date.now();
    const provider = request.provider || await this.getDefaultProvider();

    // Resolve model selection with validation
    const resolvedModel = await this.resolveModel(provider, request.model);

    // Check cache first (cache key includes model)
    const cacheKey = await this.getCacheKey(request, provider, resolvedModel);
    const cached = this.getCachedResponse(cacheKey);
    if (cached) {
      return {
        ...cached,
        responseTime: Date.now() - startTime
      };
    }

    try {
      const fullConfig = await this.configManager.loadConfig();
      const modelConfig = await this.configManager.getModelConfig(provider, resolvedModel);
      const defaultTemperature = fullConfig.defaultTemperature ?? 0.7;

      const llmResponse = await this.dispatchRequest(
        provider,
        request,
        modelConfig.model,
        modelConfig.maxTokens,
        defaultTemperature,
        startTime
      );

      this.setCachedResponse(cacheKey, llmResponse);

      return llmResponse;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('LLM request failed', { provider, error: errorMessage });

      // IMPORTANT: Only fallback if the provider was NOT explicitly requested
      // If user/tool explicitly chose a provider, let it fail loudly so they know there's a problem
      // Only fallback when using default provider selection (tool mapping fallback scenario)
      if (!request._fallbackAttempted && !request.provider) {
        const fallbackProvider = this.getFallbackProvider(provider);
        if (fallbackProvider) {
          logger.info('Trying fallback provider (original was default, not explicitly requested)', { originalProvider: provider, fallbackProvider });
          // Remove model when falling back to different provider to avoid invalid combinations
          // Mark that we've attempted a fallback to prevent infinite loops
          return this.complete({ ...request, provider: fallbackProvider, model: undefined, _fallbackAttempted: true });
        }
      }

      throw new Error(`LLM request failed: ${errorMessage}`);
    }
  }

  /**
   * Get fallback provider when the requested provider fails
   * Returns undefined if no fallback is available or if we're already on the last fallback
   */
  private getFallbackProvider(currentProvider: LLMProvider): LLMProvider | undefined {
    const fallbackOrder: LLMProvider[] = ['claude', 'openai', 'gemini'];
    const currentIndex = fallbackOrder.indexOf(currentProvider);

    // Try providers in order after the current one
    for (let i = currentIndex + 1; i < fallbackOrder.length; i++) {
      const candidate = fallbackOrder[i];
      if (candidate && this.isProviderAvailable(candidate)) {
        return candidate;
      }
    }

    // Try providers before the current one
    for (let i = 0; i < currentIndex; i++) {
      const candidate = fallbackOrder[i];
      if (candidate && this.isProviderAvailable(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  /**
   * Get the optimal LLM provider and model for a specific tool
   */
  getProviderForTool(toolName: string): { provider: LLMProvider; model?: AnyModel } {
    const mapping = DEFAULT_TOOL_LLM_MAPPING[toolName];
    if (mapping) {
      // Only use tool-specific provider/model if that provider is available
      if (this.isProviderAvailable(mapping.provider)) {
        return { provider: mapping.provider, model: mapping.model };
      }
      // Fall back to first available provider without a specific model
      const availableProvider = this.getAvailableProviders()[0];
      if (availableProvider) {
        return { provider: availableProvider };
      }
    }
    return { provider: 'claude' };
  }

  /**
   * Resolve the model to use for a request
   */
  private async resolveModel<T extends LLMProvider>(
    provider: T,
    requestedModel?: AnyModel
  ): Promise<ModelsForProvider<T>> {
    if (requestedModel) {
      if (!isValidModelForProvider(provider, requestedModel)) {
        throw new Error(`Model '${requestedModel}' is not valid for provider '${provider}'`);
      }
      return requestedModel as ModelsForProvider<T>;
    }

    const defaultModel = getDefaultModelForProvider(provider);
    if (!isValidModelForProvider(provider, defaultModel)) {
      throw new Error(`Default model '${defaultModel}' is not valid for provider '${provider}'`);
    }

    return defaultModel as ModelsForProvider<T>;
  }

  /**
   * Check if a provider is available
   */
  isProviderAvailable(provider: LLMProvider): boolean {
    return Boolean(this.clients[provider]);
  }

  /**
   * Get list of available providers
   */
  getAvailableProviders(): LLMProvider[] {
    return (Object.keys(this.clients) as LLMProvider[]).filter(
      (provider) => Boolean(this.clients[provider])
    );
  }

  /**
   * Clear the response cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; providers: string[] } {
    return {
      size: this.cache.size,
      providers: this.getAvailableProviders()
    };
  }

  /**
   * Get available models for a specific provider
   */
  async getAvailableModels(provider: LLMProvider): Promise<string[]> {
    if (!this.isProviderAvailable(provider)) {
      return [];
    }

    const config = await this.configManager.loadConfig();
    const providerConfig = config.providers[provider];

    return Object.keys(providerConfig.models).filter(modelName => {
      const modelConfig = providerConfig.models[modelName as keyof typeof providerConfig.models];
      return modelConfig && (modelConfig as { available?: boolean }).available !== false;
    });
  }

  /**
   * Get formatted schema information for tool descriptions
   */
  async getSchemaInfo(): Promise<{
    providers: Array<{ name: LLMProvider; models: string[] }>;
    defaultProvider: LLMProvider;
  }> {
    const availableProviders = this.getAvailableProviders();
    const config = await this.configManager.loadConfig();

    const providersWithModels = await Promise.all(
      availableProviders.map(async (provider) => ({
        name: provider,
        models: await this.getAvailableModels(provider)
      }))
    );

    return {
      providers: providersWithModels,
      defaultProvider: config.defaultProvider
    };
  }

  private async dispatchRequest<T extends LLMProvider>(
    provider: T,
    request: LLMRequest,
    model: ModelsForProvider<T>,
    maxTokens: number,
    defaultTemperature: number,
    startTime: number
  ): Promise<LLMResponse> {
    if (!isValidModelForProvider(provider, model)) {
      throw new Error(`Model '${model}' is not valid for provider '${provider}'`);
    }

    if (provider === 'claude') {
      return this.completeWithClaude(
        this.requireClient('claude'),
        request,
        model as ModelsForProvider<'claude'>,
        maxTokens,
        defaultTemperature,
        startTime
      );
    }

    if (provider === 'openai') {
      return this.completeWithOpenAI(
        this.requireClient('openai'),
        request,
        model as ModelsForProvider<'openai'>,
        maxTokens,
        defaultTemperature,
        startTime
      );
    }

    if (provider === 'gemini') {
      return this.completeWithGemini(
        this.requireClient('gemini'),
        request,
        model as ModelsForProvider<'gemini'>,
        maxTokens,
        defaultTemperature,
        startTime
      );
    }

    return this.assertNever(provider);
  }

  private requireClient<T extends LLMProvider>(provider: T): ProviderClientRegistry[T] {
    const client = this.clients[provider];
    if (!client) {
      throw new Error(`LLM provider '${provider}' not available`);
    }
    return client;
  }

  private assertNever(value: never): never {
    throw new Error(`Unsupported provider: ${String(value)}`);
  }

  private async completeWithClaude(
    client: ProviderClientRegistry['claude'],
    request: LLMRequest,
    model: ModelsForProvider<'claude'>,
    maxTokens: number,
    defaultTemperature: number,
    startTime: number
  ): Promise<LLMResponse> {
    const messages: ClaudeMessageParam[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: request.message }]
      }
    ];

    const createParams: ClaudeRequestParams = {
      model,
      max_tokens: request.maxTokens ?? maxTokens,
      temperature: request.temperature ?? defaultTemperature,
      messages,
      stream: false
    };

    if (request.systemPrompt) {
      createParams.system = request.systemPrompt;
    }

    const response = await client.messages.create(createParams);
    const content = this.extractClaudeText(response);
    const usage = this.buildUsageFromClaude(response);

    return this.buildResponse('claude', model, content, usage, startTime);
  }

  private async completeWithOpenAI(
    client: ProviderClientRegistry['openai'],
    request: LLMRequest,
    model: ModelsForProvider<'openai'>,
    maxTokens: number,
    defaultTemperature: number,
    startTime: number
  ): Promise<LLMResponse> {
    const messages: OpenAIRequestParams['messages'] = [];

    if (request.systemPrompt) {
      messages?.push({ role: 'system', content: request.systemPrompt });
    }

    messages?.push({ role: 'user', content: request.message });

    const payload: OpenAIRequestParams = {
      model,
      messages,
      temperature: request.temperature ?? defaultTemperature,
      max_tokens: request.maxTokens ?? maxTokens,
      stream: false
    };

    const response = await client.chat.completions.create(payload);

    const content = response.choices[0]?.message?.content ?? 'No response';
    const usage = this.buildUsageFromOpenAI(response);

    return this.buildResponse('openai', model, content, usage, startTime);
  }

  private async completeWithGemini(
    client: ProviderClientRegistry['gemini'],
    request: LLMRequest,
    model: ModelsForProvider<'gemini'>,
    maxTokens: number,
    defaultTemperature: number,
    startTime: number
  ): Promise<LLMResponse> {
    const modelInstance = client.getGenerativeModel({ model });
    const prompt = request.systemPrompt
      ? `${request.systemPrompt}\n\n${request.message}`
      : request.message;

    const payload: GenerateContentRequest = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: request.temperature ?? defaultTemperature,
        maxOutputTokens: request.maxTokens ?? maxTokens
      }
    };

    const response = await modelInstance.generateContent(payload);

    const content = response.response?.text() ?? 'No response';
    const usage = this.buildUsageFromGemini(response);

    return this.buildResponse('gemini', model, content, usage, startTime);
  }

  private extractClaudeText(response: ClaudeResponse): string {
    const textBlock = response.content.find(
      (block): block is TextBlock => block.type === 'text'
    );

    if (textBlock && typeof textBlock.text === 'string') {
      return textBlock.text;
    }

    return 'No response';
  }

  private buildUsageFromClaude(response: ClaudeResponse): LLMResponse['usage'] {
    const usage = response.usage;
    if (!usage) {
      return undefined;
    }

    const promptTokens = usage.input_tokens ?? 0;
    const completionTokens = usage.output_tokens ?? 0;

    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens
    };
  }

  private buildUsageFromOpenAI(response: OpenAIResponse): LLMResponse['usage'] {
    const usage = response.usage;
    if (!usage) {
      return undefined;
    }

    return {
      promptTokens: usage.prompt_tokens ?? 0,
      completionTokens: usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0)
    };
  }

  private buildUsageFromGemini(response: GeminiResponse): LLMResponse['usage'] {
    const usage = response.response?.usageMetadata;
    if (!usage) {
      return undefined;
    }

    return {
      promptTokens: usage.promptTokenCount ?? 0,
      completionTokens: usage.candidatesTokenCount ?? 0,
      totalTokens: usage.totalTokenCount ?? (usage.promptTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0)
    };
  }

  private buildResponse(
    provider: LLMProvider,
    model: AnyModel,
    content: string,
    usage: LLMResponse['usage'] | undefined,
    startTime: number
  ): LLMResponse {
    return {
      content,
      provider,
      model,
      usage,
      responseTime: Date.now() - startTime
    };
  }

  private async getDefaultProvider(): Promise<LLMProvider> {
    const config = await this.configManager.loadConfig();
    return config.defaultProvider;
  }

  private async getCacheKey(request: LLMRequest, provider: LLMProvider, model: AnyModel): Promise<string> {
    const fullConfig = await this.configManager.loadConfig();
    const defaultTemperature = fullConfig.defaultTemperature ?? 0.7;

    const key = {
      message: request.message,
      systemPrompt: request.systemPrompt || '',
      temperature: request.temperature ?? defaultTemperature,
      provider,
      model
    };
    return JSON.stringify(key);
  }

  private getCachedResponse(cacheKey: string): LLMResponse | null {
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > new Date()) {
      return cached.response;
    }

    // Remove expired cache entry
    if (cached) {
      this.cache.delete(cacheKey);
    }

    return null;
  }

  private setCachedResponse(cacheKey: string, response: LLMResponse): void {
    this.cache.set(cacheKey, {
      response,
      expires: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
    });
  }
}
