/**
 * LLM configuration management
 */

import { EnvironmentConfig } from '../config/environment.js';
import { LLMConfig, LLMProvider, ProviderModelMap, ModelsForProvider } from './types.js';
import { logger } from '../utils/logger.js';

type ProviderConfigMap = LLMConfig['providers'];

export class LLMConfigManager {
  constructor() {}

  async loadConfig(): Promise<LLMConfig> {
    const env = EnvironmentConfig.get();

    const claudeKey = env.ANTHROPIC_API_KEY || '';
    const openaiKey = env.OPENAI_API_KEY || '';
    const geminiKey = env.GOOGLE_API_KEY || '';

    const emptyKeys: string[] = [];
    if (!claudeKey) {
      emptyKeys.push('ANTHROPIC_API_KEY');
    }
    if (!openaiKey) {
      emptyKeys.push('OPENAI_API_KEY');
    }
    if (!geminiKey) {
      emptyKeys.push('GOOGLE_API_KEY');
    }

    if (emptyKeys.length > 0) {
      logger.warn('Missing LLM API key values', { missingKeys: emptyKeys });
    }

    const defaultProvider = await this.getDefaultProvider();

      return {
        defaultProvider,
        providers: {
          claude: {
            apiKey: claudeKey,
            defaultModel: 'claude-3-5-haiku-20241022', // Latest Haiku
            models: {
              'claude-3-5-haiku-20241022': { maxTokens: 8192, available: true },      // Latest Haiku
              'claude-3-haiku-20240307': { maxTokens: 4096, available: true },        // Previous Haiku
              'claude-sonnet-4-5-20250929': { maxTokens: 8192, available: true },    // Latest Sonnet
              'claude-3-7-sonnet-20250219': { maxTokens: 8192, available: true }     // Previous Sonnet
            }
          },
          openai: {
            apiKey: openaiKey,
            defaultModel: 'gpt-4',
            models: {
              'gpt-3.5-turbo': { maxTokens: 4096, available: true },
              'gpt-4': { maxTokens: 4096, available: true },
              'gpt-4-turbo': { maxTokens: 4096, available: true },
              'gpt-4o': { maxTokens: 4096, available: true },
              'gpt-4o-mini': { maxTokens: 4096, available: true }
            }
          },
          gemini: {
            apiKey: geminiKey,
            defaultModel: 'gemini-1.5-flash',
            models: {
              'gemini-1.5-flash': { maxTokens: 4096, available: true },
              'gemini-1.5-pro': { maxTokens: 4096, available: true },
              'gemini-1.0-pro': { maxTokens: 4096, available: true }
            }
          }
        },
        timeout: 30000, // 30 seconds

        // Default temperature used when a request does not provide one
        defaultTemperature: 0.7,
        cacheEnabled: true,
        cacheTtl: 5 * 60 * 1000, // 5 minutes
        maxRetries: 2
      };
  }


  async getProviderConfig<T extends LLMProvider>(provider: T): Promise<ProviderConfigMap[T]> {
    const config = await this.loadConfig();
    return config.providers[provider];
  }

  async getModelConfig<T extends LLMProvider>(
    provider: T,
    model?: ModelsForProvider<T>
  ): Promise<{ model: ProviderModelMap[T]; maxTokens: number }> {
    const providerConfig = await this.getProviderConfig(provider);
    const selectedModel = (model ?? providerConfig.defaultModel) as ProviderModelMap[T];
    const modelsForProvider = providerConfig.models as Record<ModelsForProvider<T>, { maxTokens: number; available: boolean }>;
    const modelConfig = modelsForProvider[selectedModel];

    if (!modelConfig) {
      throw new Error(`Model '${selectedModel}' is not available for provider '${provider}'`);
    }

    if (!modelConfig.available) {
      throw new Error(`Model '${selectedModel}' is not available for provider '${provider}'`);
    }

    return {
      model: selectedModel,
      maxTokens: modelConfig.maxTokens
    };
  }

  async getAvailableModels(provider: LLMProvider): Promise<string[]> {
    const providerConfig = await this.getProviderConfig(provider);

    return Object.entries(providerConfig.models)
      .filter(([, config]) => config.available)
      .map(([model]) => model);
  }

  private async getDefaultProvider(): Promise<LLMProvider> {
    const env = EnvironmentConfig.get();
    const defaultProvider = env.LLM_DEFAULT_PROVIDER || process.env.LLM_DEFAULT_PROVIDER;

    if (defaultProvider && ['claude', 'openai', 'gemini'].includes(defaultProvider)) {
      return defaultProvider as LLMProvider;
    }

    return 'claude'; // Default to Claude Haiku for speed
  }

  async validateConfig(): Promise<boolean> {
    try {
      const config = await this.loadConfig();

      // Check that at least one provider has a valid API key
      const missingProviders: string[] = [];
      let hasValidProvider = false;

      for (const [providerName, provider] of Object.entries(config.providers)) {
        const normalizedKey = provider.apiKey?.trim?.() ?? '';
        const hasKey = normalizedKey.length > 0;

        if (hasKey) {
          hasValidProvider = true;
        } else {
          missingProviders.push(providerName);
        }
      }

      if (!hasValidProvider) {
        logger.error('No valid LLM providers configured - need at least one API key');
        return false;
      }

      if (missingProviders.length > 0) {
        logger.warn('Missing API keys for providers', { missingProviders });
      }

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('LLM configuration validation failed', { error: errorMessage });
      return false;
    }
  }
}
