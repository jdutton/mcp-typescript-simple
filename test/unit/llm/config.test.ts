import { jest } from '@jest/globals';
import { LLMConfigManager } from '../../../src/llm/config.js';
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
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(manager.validateConfig()).resolves.toBe(false);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('throws when requesting a model that does not exist for the provider', async () => {
    const secretManager = createSecretManager({
      getSecret: jest.fn<SecretManager['getSecret']>().mockResolvedValue('key')
    });

    const manager = new LLMConfigManager(secretManager);

    await expect(manager.getModelConfig('openai', 'nonexistent'))
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
