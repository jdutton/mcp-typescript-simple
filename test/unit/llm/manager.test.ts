import { vi } from 'vitest';

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
  cacheTtl: 300_000,
  maxRetries: 2
};


const setupConfigSpies = (config: LLMConfig = baseConfig) => {
  vi.spyOn(LLMConfigManager.prototype, 'loadConfig').mockResolvedValue(config);
  vi
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
  vi.restoreAllMocks();
});

describe('LLMManager', () => {
  const createManager = () => {
    setupConfigSpies();
    return new LLMManager();
  };

  it('initializes clients based on config and caches completions', async () => {
    const manager = createManager();

    const openaiCreate = vi.fn(async () => ({
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

  it('falls back to Claude when default provider fails (no explicit provider requested)', async () => {
    const manager = createManager();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

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

    // Configure default provider to be OpenAI (via mocking)
    vi.spyOn(manager as any, 'getDefaultProvider').mockResolvedValue('openai');

    const openaiCreate = vi.fn(async () => {
      throw new Error('openai failure');
    });
    const anthropicCreate = vi.fn(async () => anthropicResponse);

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

    // NO explicit provider - should use default (openai) and fallback to claude
    const response = await manager.complete({ message: 'Fallback' });

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

    // summarize tool prefers gemini with gemini-2.5-flash
    const result = manager.getProviderForTool('summarize');
    expect(result.provider).toBe('gemini');
    expect(result.model).toBe('gemini-2.5-flash');
  });

  it('falls back to available provider without incompatible model when preferred provider unavailable', async () => {
    setupConfigSpies();
    const manager = new LLMManager();

    // Initialize with only Claude available (no Gemini client)
    const claudeClient = {
      messages: {
        create: vi.fn(async () => ({
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
          create: vi.fn()
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
      messages: { create: vi.fn() }
    };

    (manager as unknown as { clients: Record<string, unknown> }).clients = {
      claude: claudeClient
    };

    const result = manager.getProviderForTool('summarize');

    // Verify we don't get gemini model with claude provider
    if (result.model) {
      expect(result.model).not.toBe('gemini-2.5-flash');
      expect(result.model).not.toBe('gemini-2.5-flash-lite');
      expect(result.model).not.toBe('gemini-2.0-flash');
    }
  });
});

describe('LLMManager error handling', () => {
  const mockConfig: LLMConfig = baseConfig;

  beforeEach(() => {
    setupConfigSpies(mockConfig);
  });

  it('fails loudly when explicitly requested provider fails (no fallback)', async () => {
    const manager = new LLMManager();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const openAiError = new Error('OpenAI down');
    const openAiClient = {
      chat: {
        completions: {
          create: vi.fn(async () => {
            throw openAiError;
          })
        }
      }
    };

    const claudeClient = {
      messages: {
        create: vi.fn(async () => ({ content: [{ type: 'text', text: 'Should not be called' }] }))
      }
    };

    (manager as unknown as { clients: Record<string, unknown> }).clients = {
      openai: openAiClient,
      claude: claudeClient
    };

    // When provider is explicitly requested, it should fail instead of falling back
    await expect(
      manager.complete({ provider: 'openai', message: 'hello' })
    ).rejects.toThrow('LLM request failed: OpenAI down');

    expect(openAiClient.chat.completions.create).toHaveBeenCalledTimes(1);
    // Claude should NOT be called because provider was explicitly requested
    expect(claudeClient.messages.create).not.toHaveBeenCalled();
  });

  it('throws a descriptive error when fallback provider is unavailable', async () => {
    const manager = new LLMManager();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const openAiClient = {
      chat: {
        completions: {
          create: vi.fn(async () => {
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
    ).rejects.toThrow("LLM request failed: OpenAI down");
  });

  it('surfaces errors from Claude when no fallback is available', async () => {
    const manager = new LLMManager();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const claudeClient = {
      messages: {
        create: vi.fn(async () => {
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
