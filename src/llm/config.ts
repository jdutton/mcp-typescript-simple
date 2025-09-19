/**
 * LLM configuration management
 */

import { SecretManager } from '../secrets/types.js';
import { LLMConfig, LLMProvider } from './types.js';

export class LLMConfigManager {
  constructor(private secretManager: SecretManager) {}

  async loadConfig(): Promise<LLMConfig> {
    try {
      const [claudeKey, openaiKey, geminiKey] = await Promise.all([
        this.secretManager.getSecret('ANTHROPIC_API_KEY'),
        this.secretManager.getSecret('OPENAI_API_KEY'),
        this.secretManager.getSecret('GOOGLE_API_KEY')
      ]);

      const defaultProvider = await this.getDefaultProvider();

      return {
        defaultProvider,
        providers: {
          claude: {
            apiKey: claudeKey,
            defaultModel: 'claude-3-haiku-20240307',
            models: {
              'claude-3-haiku-20240307': { maxTokens: 4096, available: true },
              'claude-3-sonnet-20240229': { maxTokens: 4096, available: true },
              'claude-3-opus-20240229': { maxTokens: 4096, available: true }
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load LLM configuration: ${errorMessage}`);
    }
  }

  async getProviderConfig(provider: LLMProvider): Promise<{ apiKey: string; defaultModel: string; models: any }> {
    const config = await this.loadConfig();
    return config.providers[provider];
  }

  async getModelConfig(provider: LLMProvider, model?: string): Promise<{ model: string; maxTokens: number }> {
    const config = await this.loadConfig();
    const providerConfig = config.providers[provider];

    // Use provided model, tool default, or provider default
    const selectedModel = model || providerConfig.defaultModel;

    // Validate model exists for this provider
    if (!(selectedModel in providerConfig.models)) {
      throw new Error(`Model '${selectedModel}' not available for provider '${provider}'`);
    }

    // Get model configuration safely
    const modelConfig = (providerConfig.models as any)[selectedModel];

    // Check if model is marked as available
    if (!modelConfig.available) {
      throw new Error(`Model '${selectedModel}' is not available for provider '${provider}'`);
    }

    return {
      model: selectedModel,
      maxTokens: modelConfig.maxTokens
    };
  }

  async getAvailableModels(provider: LLMProvider): Promise<string[]> {
    const config = await this.loadConfig();
    const providerConfig = config.providers[provider];

    return Object.entries(providerConfig.models)
      .filter(([, config]) => config.available)
      .map(([model]) => model);
  }

  private async getDefaultProvider(): Promise<LLMProvider> {
    try {
      const defaultProvider = await this.secretManager.getSecret('LLM_DEFAULT_PROVIDER');
      if (['claude', 'openai', 'gemini'].includes(defaultProvider)) {
        return defaultProvider as LLMProvider;
      }
    } catch {
      // If not specified, fall back to default
    }

    return 'claude'; // Default to Claude Haiku for speed
  }

  async validateConfig(): Promise<boolean> {
    try {
      const config = await this.loadConfig();

      // Check that at least one provider has a valid API key
      const hasValidProvider = Object.values(config.providers).some(
        provider => provider.apiKey && provider.apiKey.length > 0
      );

      if (!hasValidProvider) {
        console.error('No valid LLM providers configured - need at least one API key');
        return false;
      }

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('LLM configuration validation failed:', errorMessage);
      return false;
    }
  }
}