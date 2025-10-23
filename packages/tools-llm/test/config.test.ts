import { vi } from 'vitest';

import { LLMConfigManager } from '@mcp-typescript-simple/tools-llm';
import type { LLMConfig } from '@mcp-typescript-simple/tools-llm';
import { EnvironmentConfig } from '@mcp-typescript-simple/config';
import { logger } from '@mcp-typescript-simple/observability';

describe('LLMConfigManager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TODO: These tests need updating - the package has its own logger implementation
  it.skip('uses claude as default provider when LLM_DEFAULT_PROVIDER is not set', async () => {
    const envSpy = vi.spyOn(EnvironmentConfig, 'get').mockReturnValue({
      ANTHROPIC_API_KEY: 'anthropic-key',
      OPENAI_API_KEY: 'openai-key',
      GOOGLE_API_KEY: 'gemini-key',
      LLM_DEFAULT_PROVIDER: undefined
    } as any);

    const manager = new LLMConfigManager();
    const config = await manager.loadConfig();

    expect(config.defaultProvider).toBe('claude');
    expect(envSpy).toHaveBeenCalled();
  });

  it.skip('returns false from validateConfig when all provider keys are empty', async () => {
    const envSpy = vi.spyOn(EnvironmentConfig, 'get').mockReturnValue({
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      GOOGLE_API_KEY: '',
      LLM_DEFAULT_PROVIDER: undefined
    } as any);

    const manager = new LLMConfigManager();
    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    await expect(manager.validateConfig()).resolves.toBe(false);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(loggerWarnSpy).toHaveBeenCalled();
    expect(envSpy).toHaveBeenCalled();
  });

  it.skip('logs warnings and continues when some API keys are missing', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const envSpy = vi.spyOn(EnvironmentConfig, 'get').mockReturnValue({
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: 'openai-key',
      GOOGLE_API_KEY: '',
      LLM_DEFAULT_PROVIDER: undefined
    } as any);

    const manager = new LLMConfigManager();
    const config = await manager.loadConfig();

    expect(config.providers.claude.apiKey).toBe('');
    expect(config.providers.openai.apiKey).toBe('openai-key');
    expect(config.providers.gemini.apiKey).toBe('');
    expect(warnSpy).toHaveBeenCalledWith('Missing LLM API key values', expect.objectContaining({
      missingKeys: expect.arrayContaining(['ANTHROPIC_API_KEY', 'GOOGLE_API_KEY'])
    }));
    expect(envSpy).toHaveBeenCalled();
  });

  it.skip('validates config and warns when some providers lack keys', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const config: LLMConfig = {
      defaultProvider: 'claude',
      providers: {
        claude: {
          apiKey: 'anthropic-key',
          defaultModel: 'claude-3-5-haiku-20241022',
          models: {
            'claude-3-5-haiku-20241022': { maxTokens: 8192, available: true },
            'claude-3-haiku-20240307': { maxTokens: 4096, available: true },
            'claude-sonnet-4-5-20250929': { maxTokens: 8192, available: true },
            'claude-3-7-sonnet-20250219': { maxTokens: 8192, available: true }
          }
        },
        openai: {
          apiKey: '',
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
          apiKey: '',
          defaultModel: 'gemini-2.5-flash',
          models: {
            'gemini-2.5-flash': { maxTokens: 4096, available: true },
            'gemini-2.5-flash-lite': { maxTokens: 4096, available: true },
            'gemini-2.0-flash': { maxTokens: 4096, available: true }
          }
        }
      },
      timeout: 30_000,
      defaultTemperature: 0.7,
      cacheEnabled: true,
      cacheTtl: 5 * 60 * 1000,
      maxRetries: 2
    };

    const loadConfigSpy = vi.spyOn(LLMConfigManager.prototype, 'loadConfig').mockResolvedValue(config);
    const manager = new LLMConfigManager();

    await expect(manager.validateConfig()).resolves.toBe(true);
    expect(loadConfigSpy).toHaveBeenCalledTimes(1);

    // The logger now logs structured data objects instead of concatenated strings
    expect(warnSpy).toHaveBeenCalledWith('Missing API keys for providers', expect.objectContaining({
      missingProviders: expect.arrayContaining(['openai', 'gemini'])
    }));
  });

  it('throws when requesting a model that does not exist for the provider', async () => {
    const envSpy = vi.spyOn(EnvironmentConfig, 'get').mockReturnValue({
      ANTHROPIC_API_KEY: 'key',
      OPENAI_API_KEY: 'key',
      GOOGLE_API_KEY: 'key',
      LLM_DEFAULT_PROVIDER: undefined
    } as any);

    const manager = new LLMConfigManager();

    await expect(manager.getModelConfig('openai', 'nonexistent' as never))
      .rejects.toThrow("Model 'nonexistent' is not available for provider 'openai'");
  });

  it('throws when the selected model is marked unavailable even if defined', async () => {
    const envSpy = vi.spyOn(EnvironmentConfig, 'get').mockReturnValue({
      ANTHROPIC_API_KEY: 'key',
      OPENAI_API_KEY: 'key',
      GOOGLE_API_KEY: 'key',
      LLM_DEFAULT_PROVIDER: undefined
    } as any);

    const manager = new LLMConfigManager();
    const baseConfig = await manager.loadConfig();
    const defaultModel = baseConfig.providers.openai.defaultModel;
    baseConfig.providers.openai.models[defaultModel].available = false;

    vi.spyOn(manager, 'loadConfig').mockResolvedValue(baseConfig);

    await expect(manager.getModelConfig('openai', defaultModel))
      .rejects.toThrow(`Model '${defaultModel}' is not available for provider 'openai'`);
  });

  it('should not include deprecated Claude 3 models (claude-3-sonnet-20240229, claude-3-opus-20240229)', async () => {
    const envSpy = vi.spyOn(EnvironmentConfig, 'get').mockReturnValue({
      ANTHROPIC_API_KEY: 'key',
      OPENAI_API_KEY: 'key',
      GOOGLE_API_KEY: 'key',
      LLM_DEFAULT_PROVIDER: undefined
    } as any);

    const manager = new LLMConfigManager();
    const config = await manager.loadConfig();

    // Deprecated models should not be present
    expect(config.providers.claude.models).not.toHaveProperty('claude-3-sonnet-20240229');
    expect(config.providers.claude.models).not.toHaveProperty('claude-3-opus-20240229');

    // Should have current Claude 4 models instead
    expect(config.providers.claude.models).toHaveProperty('claude-sonnet-4-5-20250929');
    expect(config.providers.claude.models).toHaveProperty('claude-3-5-haiku-20241022');
  });
});
