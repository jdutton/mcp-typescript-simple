/**
 * LLM manager using official provider SDKs
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { LLMConfigManager } from './config.js';
import { LLMRequest, LLMResponse, LLMProvider, DEFAULT_TOOL_LLM_MAPPING, isValidModelForProvider, getDefaultModelForProvider, AnyModel } from './types.js';
import { SecretManager } from '../secrets/types.js';

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
      let response: unknown;
      let content: string;

      if (provider === 'claude') {
        const messages: Array<{ role: string; content: string }> = [];
        messages.push({ role: 'user', content: request.message });

        const createParams: any = {
          model: modelConfig.model,
          max_tokens: request.maxTokens || modelConfig.maxTokens,
          temperature: request.temperature ?? defaultTemperature,
          messages: messages
        };

        // Add system prompt as a separate parameter for Claude
        if (request.systemPrompt) {
          createParams.system = request.systemPrompt;
        }

        response = await (client as any).messages.create(createParams);
        content = (response as any).content[0]?.text || 'No response';
      } else if (provider === 'openai') {
        const messages: Array<{ role: string; content: string }> = [];
        if (request.systemPrompt) {
          messages.push({ role: 'system', content: request.systemPrompt });
        }
        messages.push({ role: 'user', content: request.message });

        response = await (client as any).chat.completions.create({
          model: modelConfig.model,
          messages: messages,
          temperature: request.temperature ?? defaultTemperature,
          max_tokens: request.maxTokens || modelConfig.maxTokens
        });
        content = (response as any).choices[0]?.message?.content || 'No response';
      } else if (provider === 'gemini') {
        const model = (client as any).getGenerativeModel({ model: modelConfig.model });
        let prompt = request.message;
        if (request.systemPrompt) {
          prompt = `${request.systemPrompt}\n\n${request.message}`;
        }

        response = await model.generateContent(prompt);
        content = (response as any).response.text() || 'No response';
      } else {
        throw new Error(`Unsupported provider: ${provider}`);
      }

      const llmResponse: LLMResponse = {
        content,
        provider,
        model: modelConfig.model,
        usage: (response as any).usage,
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