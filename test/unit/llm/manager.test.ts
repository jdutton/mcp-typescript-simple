import { jest } from '@jest/globals';
import { LLMManager } from '../../../src/llm/manager.js';
import type { LLMConfig } from '../../../src/llm/types.js';
import type { SecretManager } from '../../../src/secrets/types.js';

describe('LLMManager', () => {
  const baseConfig: LLMConfig = {
    defaultProvider: 'claude',
    providers: {
      claude: {
        apiKey: 'claude-key',
        defaultModel: 'claude-3-haiku-20240307',
        models: {
          'claude-3-haiku-20240307': { maxTokens: 4096, available: true },
          'claude-3-sonnet-20240229': { maxTokens: 4096, available: true },
          'claude-3-opus-20240229': { maxTokens: 4096, available: true }
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
    timeout: 30000,
    defaultTemperature: 0.7,
    cacheEnabled: true,
    cacheTtl: 300000,
    maxRetries: 2
  };

  const createManager = () => {
    const secretManager = {
      getSecret: jest.fn(async () => 'key')
    } as any;
    const manager = new LLMManager(secretManager as SecretManager);
    const configManager = {
      loadConfig: jest.fn(async () => baseConfig),
      getModelConfig: jest.fn(async (provider: string, model?: string) => {
        if (provider === 'openai') {
          return { model: model ?? 'gpt-4', maxTokens: 4096 };
        }
        return { model: model ?? 'claude-3-haiku-20240307', maxTokens: 4096 };
      })
    } as any;
    (manager as any).configManager = configManager;
    return { manager, configManager } as const;
  };

  it('initializes clients based on config and caches completions', async () => {
    const { manager } = createManager();

    const openaiCreate = jest.fn(async () => ({
      choices: [{ message: { content: 'response' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
    }));

    (manager as any).clients = new Map([
      ['openai', {
        chat: {
          completions: { create: openaiCreate }
        }
      }]
    ]);

    const request = { message: 'Hi', provider: 'openai' as const };

    const first = await manager.complete(request);
    const second = await manager.complete(request);

    expect(first.content).toBe('response');
    expect(second.content).toBe('response');
    expect(openaiCreate).toHaveBeenCalledTimes(1);
  });

  it('falls back to claude when requested provider fails', async () => {
    const { manager, configManager } = createManager();

    const anthropicResponse = {
      content: [{ type: 'text', text: 'fallback' }],
      usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 }
    };

    const openaiCreate = jest.fn(async () => { throw new Error('openai failure'); });
    const anthropicCreate = jest.fn(async () => anthropicResponse);

    (manager as any).clients = new Map([
      ['openai', {
        chat: {
          completions: { create: openaiCreate }
        }
      }],
      ['claude', {
        messages: { create: anthropicCreate }
      }]
    ]);

    (configManager as any).getModelConfig = jest.fn(async (provider: string) => {
      if (provider === 'openai') {
        return { model: 'gpt-4', maxTokens: 4096 };
      }
      return { model: 'claude-3-haiku-20240307', maxTokens: 4096 };
    });

    const response = await manager.complete({ message: 'Fallback', provider: 'openai' });

    expect(response.provider).toBe('claude');
    expect(openaiCreate).toHaveBeenCalled();
    expect(anthropicCreate).toHaveBeenCalled();
  });
});
