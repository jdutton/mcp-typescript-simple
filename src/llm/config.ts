/**
 * LLM configuration management
 */

import { SecretManager } from '../secrets/types.js';
import { LLMConfig, LLMProvider, ProviderModelMap, ModelsForProvider } from './types.js';

type ProviderConfigMap = LLMConfig['providers'];

export class LLMConfigManager {
  constructor(private secretManager: SecretManager) {}

  async loadConfig(): Promise<LLMConfig> {
    const secretResults = await Promise.allSettled([
      this.secretManager.getSecret('ANTHROPIC_API_KEY'),
      this.secretManager.getSecret('OPENAI_API_KEY'),
      this.secretManager.getSecret('GOOGLE_API_KEY')
    ]);

    const [claudeResult, openaiResult, geminiResult] = secretResults;

    const secretErrors: string[] = [];

    const claudeKey = this.extractSecret(claudeResult, 'ANTHROPIC_API_KEY', secretErrors);
    const openaiKey = this.extractSecret(openaiResult, 'OPENAI_API_KEY', secretErrors);
    const geminiKey = this.extractSecret(geminiResult, 'GOOGLE_API_KEY', secretErrors);

    if (secretErrors.length > 0) {
      console.warn('Missing or invalid LLM API keys:', secretErrors.join('; '));
    }

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
      console.warn('Missing LLM API key values:', emptyKeys.join(', '));
    }

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
  }

  private extractSecret(
    result: PromiseSettledResult<string>,
    key: string,
    errors: string[]
  ): string {
    if (result.status === 'fulfilled') {
      return result.value;
    }

    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    errors.push(`${key}: ${reason}`);
    return '';
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
        console.error('No valid LLM providers configured - need at least one API key');
        return false;
      }

      if (missingProviders.length > 0) {
        console.warn(`Missing API keys for provider(s): ${missingProviders.join(', ')}`);
      }

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('LLM configuration validation failed:', errorMessage);
      return false;
    }
  }
}
