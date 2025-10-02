import { jest } from '@jest/globals';
import { LLMManager } from '../../../src/llm/manager.js';
import { LLMConfigManager } from '../../../src/llm/config.js';
import type { LLMConfig, LLMProvider } from '../../../src/llm/types.js';

const baseConfig: LLMConfig = {
  defaultProvider: 'claude',
  providers: {
    claude: {
      apiKey: 'claude-key',
      defaultModel: 'claude-3-5-haiku-20241022',
      models: {
        'claude-3-5-haiku-20241022': { maxTokens: 8192, available: true },
        'claude-3-haiku-20240307': { maxTokens: 4096, available: true },
        'claude-sonnet-4-5-20250929': { maxTokens: 8192, available: true },
        'claude-3-7-sonnet-20250219': { maxTokens: 8192, available: true }
      }
    },
    openai: {
      apiKey: 'openai-key',
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
      apiKey: 'gemini-key',
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
  cacheTtl: 300_000,
  maxRetries: 2
};


const setupConfigSpies = (config: LLMConfig = baseConfig) => {
  jest.spyOn(LLMConfigManager.prototype, 'loadConfig').mockResolvedValue(config);
  jest
    .spyOn(LLMConfigManager.prototype, 'getModelConfig')
    .mockImplementation(async (provider: LLMProvider, model?: string) => {
      const providerConfig = config.providers[provider];
      const selectedModel = (model ?? providerConfig.defaultModel) as keyof typeof providerConfig.models;
      const models = providerConfig.models as Record<string, { maxTokens: number; available: boolean }>;
      const entry = models[selectedModel as string];
      if (!entry) {
        throw new Error(`Model '${String(model)}' not available for provider '${provider}'`);
      }
      return { model: selectedModel, maxTokens: entry.maxTokens };
    });
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('LLMManager', () => {
  const createManager = () => {
    setupConfigSpies();
    return new LLMManager();
  };

  it('initializes clients based on config and caches completions', async () => {
    const manager = createManager();

    const openaiCreate = jest.fn(async () => ({
      choices: [{ message: { content: 'response' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
    }));

    (manager as unknown as { clients: Record<string, unknown> }).clients = {
      openai: {
        chat: {
          completions: { create: openaiCreate }
        }
      }
    };

    const request = { message: 'Hi', provider: 'openai' as const };

    const first = await manager.complete(request);
    const second = await manager.complete(request);

    expect(first.content).toBe('response');
    expect(second.content).toBe('response');
    expect(openaiCreate).toHaveBeenCalledTimes(1);
  });

  it('falls back to Claude when requested provider fails', async () => {
    const manager = createManager();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});

    const anthropicResponse = {
      content: [{ type: 'text', text: 'fallback' }],
      usage: {
        input_tokens: 5,
        output_tokens: 10,
        cache_creation: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        server_tool_use: null,
        service_tier: null
      }
    };

    const openaiCreate = jest.fn(async () => {
      throw new Error('openai failure');
    });
    const anthropicCreate = jest.fn(async () => anthropicResponse);

    (manager as unknown as { clients: Record<string, unknown> }).clients = {
      openai: {
        chat: {
          completions: { create: openaiCreate }
        }
      },
      claude: {
        messages: { create: anthropicCreate }
      }
    };

    const response = await manager.complete({ message: 'Fallback', provider: 'openai' });

    expect(response.provider).toBe('claude');
    expect(openaiCreate).toHaveBeenCalled();
    expect(anthropicCreate).toHaveBeenCalled();
  });
});

describe('LLMManager getProviderForTool', () => {
  it('returns the preferred provider and model when available', async () => {
    setupConfigSpies();
    const manager = new LLMManager();
    await manager.initialize();

    // summarize tool prefers gemini with gemini-1.5-flash
    const result = manager.getProviderForTool('summarize');
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-1.5-flash');
  });

  it('falls back to available provider without incompatible model when preferred provider unavailable', async () => {
    setupConfigSpies();
    const manager = new LLMManager();

    // Initialize with only Claude available (no Gemini client)
    const claudeClient = {
      messages: {
        create: jest.fn(async () => ({
          content: [{ type: 'text', text: 'response' }],
          usage: { input_tokens: 10, output_tokens: 20 }
        }))
      }
    };

    (manager as unknown as { clients: Record<string, unknown> }).clients = {
      claude: claudeClient
    };

    // summarize tool prefers gemini, but only claude is available
    const result = manager.getProviderForTool('summarize');

    // Should fallback to claude WITHOUT the gemini model
    expect(result.provider).toBe('claude');
    expect(result.model).toBeUndefined(); // No model specified, will use provider default
  });

  it('returns claude as default when tool has no mapping', async () => {
    setupConfigSpies();
    const manager = new LLMManager();

    const openaiClient = {
      chat: {
        completions: {
          create: jest.fn()
        }
      }
    };

    (manager as unknown as { clients: Record<string, unknown> }).clients = {
      openai: openaiClient
    };

    const result = manager.getProviderForTool('unknown-tool');
    expect(result.provider).toBe('claude');
    expect(result.model).toBeUndefined();
  });

  it('prevents invalid provider/model combinations', async () => {
    setupConfigSpies();
    const manager = new LLMManager();

    const claudeClient = {
      messages: { create: jest.fn() }
    };

    (manager as unknown as { clients: Record<string, unknown> }).clients = {
      claude: claudeClient
    };

    const result = manager.getProviderForTool('summarize');

    // Verify we don't get gemini model with claude provider
    if (result.model) {
      expect(result.model).not.toBe('gemini-1.5-flash');
      expect(result.model).not.toBe('gemini-1.5-pro');
      expect(result.model).not.toBe('gemini-1.0-pro');
    }
  });
});

describe('LLMManager error handling', () => {
  const mockConfig: LLMConfig = baseConfig;

  beforeEach(() => {
    setupConfigSpies(mockConfig);
  });

  it('falls back to Claude when the requested provider fails', async () => {
    const manager = new LLMManager();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});

    const openAiError = new Error('OpenAI down');
    const openAiClient = {
      chat: {
        completions: {
          create: jest.fn(async () => {
            throw openAiError;
          })
        }
      }
    };

    const claudeResponse = {
      content: [{ type: 'text', text: 'Fallback response' }],
      usage: {
        input_tokens: 12,
        output_tokens: 6,
        cache_creation: null,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        server_tool_use: null,
        service_tier: null
      }
    };
    const claudeClient = {
      messages: {
        create: jest.fn(async () => claudeResponse)
      }
    };

    (manager as unknown as { clients: Record<string, unknown> }).clients = {
      openai: openAiClient,
      claude: claudeClient
    };

    const result = await manager.complete({ provider: 'openai', message: 'hello' });

    expect(openAiClient.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(claudeClient.messages.create).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe('claude');
    expect(result.content).toBe('Fallback response');
    expect(result.usage).toEqual({ promptTokens: 12, completionTokens: 6, totalTokens: 18 });
  });

  it('throws a descriptive error when fallback provider is unavailable', async () => {
    const manager = new LLMManager();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});

    const openAiClient = {
      chat: {
        completions: {
          create: jest.fn(async () => {
            throw new Error('OpenAI down');
          })
        }
      }
    };

    (manager as unknown as { clients: Record<string, unknown> }).clients = {
      openai: openAiClient
    };

    await expect(
      manager.complete({ provider: 'openai', message: 'hello' })
    ).rejects.toThrow("LLM request failed: LLM provider 'claude' not available");
  });

  it('surfaces errors from Claude when no fallback is available', async () => {
    const manager = new LLMManager();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});

    const claudeClient = {
      messages: {
        create: jest.fn(async () => {
          throw new Error('Claude offline');
        })
      }
    };

    (manager as unknown as { clients: Record<string, unknown> }).clients = {
      claude: claudeClient
    };

    await expect(
      manager.complete({ provider: 'claude', message: 'hello' })
    ).rejects.toThrow('LLM request failed: Claude offline');

    expect(claudeClient.messages.create).toHaveBeenCalledTimes(1);
  });
});
