/**
 * LLM manager using official provider SDKs
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages.js';
import OpenAI from 'openai';
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions/completions.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMConfigManager } from './config.js';
import { LLMRequest, LLMResponse, LLMProvider, DEFAULT_TOOL_LLM_MAPPING, isValidModelForProvider, getDefaultModelForProvider, AnyModel } from './types.js';
import { SecretManager } from '../secrets/types.js';

type AnthropicCreateParams = MessageCreateParamsNonStreaming;
type AnthropicMessageResponse = Message;
type OpenAIChatParams = ChatCompletionCreateParamsNonStreaming;
type OpenAIChatResponse = ChatCompletion;
type GeminiModel = ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
type GeminiResponse = Awaited<ReturnType<GeminiModel['generateContent']>>;

export class LLMManager {
  private configManager: LLMConfigManager;
  private clients: Map<LLMProvider, unknown> = new Map();
  private cache = new Map<string, { response: LLMResponse; expires: Date }>();

  constructor(secretManager: SecretManager) {
    this.configManager = new LLMConfigManager(secretManager);
  }

  async initialize(): Promise<void> {
    const config = await this.configManager.loadConfig();

    // Initialize Claude client
    if (config.providers.claude.apiKey) {
      try {
        const anthropic = new Anthropic({
          apiKey: config.providers.claude.apiKey,
        });
        this.clients.set('claude', anthropic);
        console.log('✅ Claude client initialized');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('⚠️  Failed to initialize Claude client:', errorMessage);
      }
    }

    // Initialize OpenAI client
    if (config.providers.openai.apiKey) {
      try {
        const openai = new OpenAI({
          apiKey: config.providers.openai.apiKey,
        });
        this.clients.set('openai', openai);
        console.log('✅ OpenAI client initialized');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('⚠️  Failed to initialize OpenAI client:', errorMessage);
      }
    }

    // Initialize Gemini client
    if (config.providers.gemini.apiKey) {
      try {
        const genAI = new GoogleGenerativeAI(config.providers.gemini.apiKey);
        this.clients.set('gemini', genAI);
        console.log('✅ Gemini client initialized');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('⚠️  Failed to initialize Gemini client:', errorMessage);
      }
    }

    if (this.clients.size === 0) {
      throw new Error('No LLM clients could be initialized - check your API keys');
    }

    console.log(`🤖 LLM Manager initialized with ${this.clients.size} provider(s)`);
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();
    const provider = request.provider || await this.getDefaultProvider();
    const client = this.clients.get(provider);

    if (!client) {
      throw new Error(`LLM provider '${provider}' not available`);
    }

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
      let rawResponse: unknown;
      let content: string;

      if (provider === 'claude') {
        const anthropicClient = client as Anthropic;
        const messages: AnthropicCreateParams['messages'] = [
          {
            role: 'user',
            content: [{ type: 'text', text: request.message }]
          }
        ];

        const createParams: AnthropicCreateParams = {
          model: modelConfig.model,
          max_tokens: request.maxTokens ?? modelConfig.maxTokens,
          temperature: request.temperature ?? defaultTemperature,
          messages
        };

        if (request.systemPrompt) {
          createParams.system = request.systemPrompt;
        }

        const anthropicResponse = await anthropicClient.messages.create(createParams);
        rawResponse = anthropicResponse;
        content = this.extractAnthropicText(anthropicResponse) ?? 'No response';
      } else if (provider === 'openai') {
        const openaiClient = client as OpenAI;
        const messages: OpenAIChatParams['messages'] = [];
        if (request.systemPrompt) {
          messages.push({ role: 'system', content: request.systemPrompt });
        }
        messages.push({ role: 'user', content: request.message });

        const openaiParams: OpenAIChatParams = {
          model: modelConfig.model,
          temperature: request.temperature ?? defaultTemperature,
          max_tokens: request.maxTokens ?? modelConfig.maxTokens,
          messages
        };

        const openaiResponse = await openaiClient.chat.completions.create(openaiParams);
        rawResponse = openaiResponse;
        content = this.extractOpenAIText(openaiResponse) ?? 'No response';
      } else if (provider === 'gemini') {
        const geminiClient = client as GoogleGenerativeAI;
        const modelInstance: GeminiModel = geminiClient.getGenerativeModel({ model: modelConfig.model });
        const prompt = request.systemPrompt
          ? `${request.systemPrompt}\n\n${request.message}`
          : request.message;

        const geminiResponse = await modelInstance.generateContent(prompt);
        rawResponse = geminiResponse;
        content = this.extractGeminiText(geminiResponse) ?? 'No response';
      } else {
        throw new Error(`Unsupported provider: ${provider}`);
      }

      const llmResponse: LLMResponse = {
        content,
        provider,
        model: modelConfig.model,
        usage: this.extractUsage(provider, rawResponse),
        responseTime: Date.now() - startTime
      };

      // Cache the response
      this.setCachedResponse(cacheKey, llmResponse);

      return llmResponse;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`LLM request failed for provider ${provider}:`, errorMessage);

      // Try fallback provider
      if (provider !== 'claude') {
        console.log('🔄 Trying fallback provider: claude');
        return this.complete({ ...request, provider: 'claude' });
      }

      throw new Error(`LLM request failed: ${errorMessage}`);
    }
  }

  /**
   * Get the optimal LLM provider and model for a specific tool
   */
  getProviderForTool(toolName: string): { provider: LLMProvider; model?: AnyModel } {
    const mapping = DEFAULT_TOOL_LLM_MAPPING[toolName];
    if (mapping) {
      return { provider: mapping.provider, model: mapping.model };
    }
    return { provider: 'claude' };
  }

  /**
   * Resolve the model to use for a request
   */
  private async resolveModel(provider: LLMProvider, requestedModel?: AnyModel): Promise<string> {
    // If a model is explicitly requested, validate it
    if (requestedModel) {
      if (!isValidModelForProvider(provider, requestedModel)) {
        throw new Error(`Model '${requestedModel}' is not valid for provider '${provider}'`);
      }
      return requestedModel;
    }

    // Fall back to provider default
    return getDefaultModelForProvider(provider);
  }

  /**
   * Check if a provider is available
   */
  isProviderAvailable(provider: LLMProvider): boolean {
    return this.clients.has(provider);
  }

  /**
   * Get list of available providers
   */
  getAvailableProviders(): LLMProvider[] {
    return Array.from(this.clients.keys());
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

  private extractAnthropicText(response: AnthropicMessageResponse): string | undefined {
    const firstContent = Array.isArray(response.content) ? response.content[0] : undefined;
    if (firstContent && typeof firstContent === 'object' && 'text' in firstContent) {
      const text = (firstContent as { text?: unknown }).text;
      return typeof text === 'string' ? text : undefined;
    }
    return undefined;
  }

  private extractOpenAIText(response: OpenAIChatResponse): string | undefined {
    const firstChoice = Array.isArray(response.choices) ? response.choices[0] : undefined;
    const messageContent = firstChoice?.message?.content;
    return typeof messageContent === 'string' ? messageContent : undefined;
  }

  private extractGeminiText(response: GeminiResponse): string | undefined {
    const text = response?.response?.text();
    return typeof text === 'string' ? text : undefined;
  }

  private extractUsage(provider: LLMProvider, response: unknown): LLMResponse['usage'] | undefined {
    if (typeof response !== 'object' || response === null) {
      return undefined;
    }

    if (provider === 'claude') {
      const usage = (response as { usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } }).usage;
      if (!usage) {
        return undefined;
      }
      return {
        promptTokens: usage.input_tokens ?? 0,
        completionTokens: usage.output_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0
      };
    }

    if (provider === 'openai') {
      const usage = (response as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }).usage;
      if (!usage) {
        return undefined;
      }
      return {
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0
      };
    }

    if (provider === 'gemini') {
      const usageMetadata = (response as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } }).usageMetadata;
      if (!usageMetadata) {
        return undefined;
      }
      return {
        promptTokens: usageMetadata.promptTokenCount ?? 0,
        completionTokens: usageMetadata.candidatesTokenCount ?? 0,
        totalTokens: usageMetadata.totalTokenCount ?? 0
      };
    }

    return undefined;
  }

  private async getDefaultProvider(): Promise<LLMProvider> {
    const config = await this.configManager.loadConfig();
    return config.defaultProvider;
  }

  private async getCacheKey(request: LLMRequest, provider: LLMProvider, model: string): Promise<string> {
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
