import { jest } from '@jest/globals';
import { LLMConfigManager } from '../../../src/llm/config.js';
import type { LLMConfig } from '../../../src/llm/types.js';
import type { SecretManager } from '../../../src/secrets/types.js';

const createSecretManager = (overrides: Partial<SecretManager> = {}): SecretManager => ({
  getSecret: jest.fn<SecretManager['getSecret']>().mockResolvedValue(''),
  isAvailable: jest.fn<SecretManager['isAvailable']>().mockResolvedValue(true),
  getName: () => 'mock-secret-manager',
  ...overrides
});

describe('LLMConfigManager', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses claude as default provider when LLM_DEFAULT_PROVIDER secret is missing', async () => {
    const secretManager = createSecretManager({
      getSecret: jest.fn<SecretManager['getSecret']>()
        .mockResolvedValueOnce('anthropic-key')
        .mockResolvedValueOnce('openai-key')
        .mockResolvedValueOnce('gemini-key')
        .mockRejectedValueOnce(new Error('missing default provider'))
    });

    const manager = new LLMConfigManager(secretManager);
    const config = await manager.loadConfig();

    expect(config.defaultProvider).toBe('claude');
    expect(secretManager.getSecret).toHaveBeenCalledWith('LLM_DEFAULT_PROVIDER');
  });

  it('returns false from validateConfig when all provider keys are empty', async () => {
    const secretManager = createSecretManager({
      getSecret: jest.fn<SecretManager['getSecret']>()
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('')
        .mockRejectedValueOnce(new Error('missing default provider'))
    });

    const manager = new LLMConfigManager(secretManager);
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(manager.validateConfig()).resolves.toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  it('logs warnings and continues when some secrets fail to load', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const secretManager = createSecretManager({
      getSecret: jest.fn<SecretManager['getSecret']>()
        .mockRejectedValueOnce(new Error('anthropic missing'))
        .mockResolvedValueOnce('openai-key')
        .mockRejectedValueOnce(new Error('gemini missing'))
        .mockRejectedValueOnce(new Error('default missing'))
    });

    const manager = new LLMConfigManager(secretManager);
    const config = await manager.loadConfig();

    expect(config.providers.claude.apiKey).toBe('');
    expect(config.providers.openai.apiKey).toBe('openai-key');
    expect(config.providers.gemini.apiKey).toBe('');
    const warnMessages = warnSpy.mock.calls.reduce<string[]>((acc, call) => {
      call.forEach(arg => acc.push(String(arg)));
      return acc;
    }, []);
    expect(warnMessages.some(msg => msg.includes('Missing or invalid LLM API keys:'))).toBe(true);
    expect(warnMessages.some(msg => msg.includes('Missing LLM API key values:'))).toBe(true);
  });

  it('validates config and warns when some providers lack keys', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const config: LLMConfig = {
      defaultProvider: 'claude',
      providers: {
        claude: {
          apiKey: 'anthropic-key',
          defaultModel: 'claude-3-haiku-20240307',
          models: {
            'claude-3-haiku-20240307': { maxTokens: 4096, available: true },
            'claude-3-sonnet-20240229': { maxTokens: 4096, available: true },
            'claude-3-opus-20240229': { maxTokens: 4096, available: true }
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
          defaultModel: 'gemini-1.5-flash',
          models: {
            'gemini-1.5-flash': { maxTokens: 4096, available: true },
            'gemini-1.5-pro': { maxTokens: 4096, available: true },
            'gemini-1.0-pro': { maxTokens: 4096, available: true }
          }
        }
      },
      timeout: 30_000,
      defaultTemperature: 0.7,
      cacheEnabled: true,
      cacheTtl: 5 * 60 * 1000,
      maxRetries: 2
    };

    const loadConfigSpy = jest.spyOn(LLMConfigManager.prototype, 'loadConfig').mockResolvedValue(config);
    const manager = new LLMConfigManager(createSecretManager());

    await expect(manager.validateConfig()).resolves.toBe(true);
    expect(loadConfigSpy).toHaveBeenCalledTimes(1);

    const warnMessages = warnSpy.mock.calls.flatMap((call) => call.map((arg) => String(arg)));
    expect(warnSpy).toHaveBeenCalled();
    expect(
      warnMessages.some((message) => message.includes('Missing API keys for provider(s):'))
    ).toBe(true);
    expect(warnMessages.join(' ')).toContain('openai');
    expect(warnMessages.join(' ')).toContain('gemini');
  });

  it('throws when requesting a model that does not exist for the provider', async () => {
    const secretManager = createSecretManager({
      getSecret: jest.fn<SecretManager['getSecret']>().mockResolvedValue('key')
    });

    const manager = new LLMConfigManager(secretManager);

    await expect(manager.getModelConfig('openai', 'nonexistent' as never))
      .rejects.toThrow("Model 'nonexistent' is not available for provider 'openai'");
  });

  it('throws when the selected model is marked unavailable even if defined', async () => {
    const secretManager = createSecretManager({
      getSecret: jest.fn<SecretManager['getSecret']>().mockResolvedValue('key')
    });

    const manager = new LLMConfigManager(secretManager);
    const baseConfig = await manager.loadConfig();
    const defaultModel = baseConfig.providers.openai.defaultModel;
    baseConfig.providers.openai.models[defaultModel].available = false;

    jest.spyOn(manager, 'loadConfig').mockResolvedValue(baseConfig);

    await expect(manager.getModelConfig('openai', defaultModel))
      .rejects.toThrow(`Model '${defaultModel}' is not available for provider 'openai'`);
  });
});
