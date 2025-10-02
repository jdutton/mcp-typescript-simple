/**
 * Comprehensive test suite for summarize tool
 *
 * Tests cover:
 * 1. Default provider/model combinations
 * 2. Provider fallback behavior
 * 3. Explicit provider with default model
 * 4. Provider/model validation
 * 5. Optional parameters (length, format, focus)
 */
import { jest } from '@jest/globals';
import { handleSummarizeTool, type SummarizeToolInput } from '../../../../src/tools/llm/summarize.js';
import { LLMManager } from '../../../../src/llm/manager.js';
import { LLMConfigManager } from '../../../../src/llm/config.js';
import type { LLMConfig, LLMProvider } from '../../../../src/llm/types.js';
import { DEFAULT_TOOL_LLM_MAPPING, isValidModelForProvider } from '../../../../src/llm/types.js';

type ToolResponse = {
  content: Array<{ type: string; text?: string }>;
};

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
      defaultModel: 'gpt-4o-mini',
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

describe('Summarize Tool', () => {
  /**
   * Section 1: Default Configuration Validation
   * Ensures the defaults defined in DEFAULT_TOOL_LLM_MAPPING are valid
   */
  describe('Default Configuration Validation', () => {
    it('should have valid provider/model combination in DEFAULT_TOOL_LLM_MAPPING', () => {
      const defaults = DEFAULT_TOOL_LLM_MAPPING['summarize'];

      expect(defaults).toBeDefined();
      if (!defaults) {
        throw new Error('summarize defaults not defined');
      }

      expect(defaults.provider).toBe('gemini');
      expect(defaults.model).toBe('gemini-2.5-flash');

      // Critical: Verify the default model is valid for the default provider
      if (!defaults.model) {
        throw new Error('default model not defined');
      }
      expect(isValidModelForProvider(defaults.provider, defaults.model)).toBe(true);
    });

    it('should reject invalid provider/model combinations', () => {
      // gemini model with claude provider should be invalid
      expect(isValidModelForProvider('claude', 'gemini-2.5-flash')).toBe(false);

      // claude model with gemini provider should be invalid
      expect(isValidModelForProvider('gemini', 'claude-3-5-haiku-20241022' as any)).toBe(false);
    });
  });

  /**
   * Section 2: Default Behavior (no provider/model specified)
   * Tests tool behavior when using defaults with various availability scenarios
   */
  describe('Default Behavior (no provider/model specified)', () => {
    it('should use default Gemini provider when all providers available', async () => {
      setupConfigSpies();
      const manager = new LLMManager();

      const geminiGenerate = jest.fn(async () => ({
        response: {
          text: () => 'Summary result',
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 20,
            totalTokenCount: 30
          }
        }
      }));

      (manager as any).clients = {
        claude: { messages: { create: jest.fn() } },
        openai: { chat: { completions: { create: jest.fn() } } },
        gemini: { getGenerativeModel: () => ({ generateContent: geminiGenerate }) }
      };

      const input: SummarizeToolInput = {
        text: 'Test text to summarize'
      };

      const result = await handleSummarizeTool(input, manager);

      expect(result.content[0]?.text).toBe('Summary result');
      expect(geminiGenerate).toHaveBeenCalled();
    });

    it('should use default provider and model when only text is provided', async () => {
      const completeMock = jest.fn<() => Promise<any>>().mockResolvedValue({
        content: 'This is a summary.',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        responseTime: 100
      });

      const manager = {
        getProviderForTool: jest.fn().mockReturnValue({
          provider: 'gemini',
          model: 'gemini-2.5-flash'
        }),
        complete: completeMock,
        getAvailableProviders: jest.fn().mockReturnValue(['gemini']),
        clearCache: jest.fn(),
        getCacheStats: jest.fn(),
        initialize: jest.fn(),
        isProviderAvailable: jest.fn().mockReturnValue(true)
      } as unknown as LLMManager;

      const result = await handleSummarizeTool(
        { text: 'Long text to summarize...' },
        manager
      );

      // Verify getProviderForTool was called for 'summarize' tool
      expect(manager.getProviderForTool).toHaveBeenCalledWith('summarize');

      // Verify complete was called with correct provider/model
      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.5-flash'
        })
      );

      // Verify success response
      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe('text');
      expect(result.content[0]!.text).toBe('This is a summary.');
    });

    it('should fallback to Claude when Gemini unavailable', async () => {
      setupConfigSpies();
      const manager = new LLMManager();

      const claudeCreate = jest.fn(async () => ({
        content: [{ type: 'text', text: 'Claude summary' }],
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_creation: null,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          server_tool_use: null,
          service_tier: null
        }
      }));

      (manager as any).clients = {
        claude: { messages: { create: claudeCreate } }
      };

      const input: SummarizeToolInput = {
        text: 'Test text to summarize'
      };

      const result = await handleSummarizeTool(input, manager);

      // Should NOT contain error about invalid model
      expect(result.content[0]?.text).not.toContain('is not valid for provider');
      expect(result.content[0]?.text).not.toContain('SUMMARIZE_TOOL_ERROR');

      // Should successfully use Claude
      expect(result.content[0]?.text).toBe('Claude summary');
      expect(claudeCreate).toHaveBeenCalled();
    });

    it('should fallback to OpenAI when Gemini and Claude unavailable', async () => {
      setupConfigSpies();
      const manager = new LLMManager();

      const openaiCreate = jest.fn(async () => ({
        choices: [{ message: { content: 'OpenAI summary' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      }));

      (manager as any).clients = {
        openai: { chat: { completions: { create: openaiCreate } } }
      };

      const input: SummarizeToolInput = {
        text: 'Test text to summarize'
      };

      const result = await handleSummarizeTool(input, manager);

      expect(result.content[0]?.text).not.toContain('is not valid for provider');
      expect(result.content[0]?.text).toBe('OpenAI summary');
      expect(openaiCreate).toHaveBeenCalled();
    });
  });

  /**
   * Section 3: Explicit Provider with Default Model
   * Tests the critical bug fix: when provider is specified without model,
   * should use that provider's default model, not the tool's default model
   */
  describe('Explicit Provider with Default Model', () => {
    it('should use Claude default model when provider="claude" without explicit model', async () => {
      setupConfigSpies();
      const manager = new LLMManager();

      const claudeCreate = jest.fn(async () => ({
        content: [{ type: 'text', text: 'Claude summary result' }],
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_creation: null,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          server_tool_use: null,
          service_tier: null
        }
      }));

      (manager as any).clients = {
        claude: { messages: { create: claudeCreate } }
      };

      const input: SummarizeToolInput = {
        text: 'Test text to summarize',
        provider: 'claude'
        // NO MODEL SPECIFIED - should use Claude's default
      };

      const result = await handleSummarizeTool(input, manager);

      // Should NOT fail with model validation error
      expect(result.content[0]?.text).not.toContain('Model \'gemini-2.5-flash\' is not valid for provider \'claude\'');
      expect(result.content[0]?.text).not.toContain('SUMMARIZE_TOOL_ERROR');

      // Should successfully use Claude with its default model
      expect(result.content[0]?.text).toBe('Claude summary result');
      expect(claudeCreate).toHaveBeenCalled();

      // Verify it used the correct default model for Claude
      // @ts-ignore
      const callArgs = claudeCreate.mock.calls[0][0];
      // @ts-ignore
      expect(callArgs.model).toBe('claude-3-5-haiku-20241022'); // Claude's default, NOT gemini-2.5-flash
    });

    it('should use OpenAI default model when provider="openai" without explicit model', async () => {
      setupConfigSpies();
      const manager = new LLMManager();

      const openaiCreate = jest.fn(async () => ({
        choices: [{ message: { content: 'OpenAI summary result' } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
      }));

      (manager as any).clients = {
        openai: { chat: { completions: { create: openaiCreate } } }
      };

      const input: SummarizeToolInput = {
        text: 'Test text to summarize',
        provider: 'openai'
        // NO MODEL SPECIFIED
      };

      const result = await handleSummarizeTool(input, manager);

      // Should NOT fail with model validation error
      expect(result.content[0]?.text).not.toContain('Model \'gemini-2.5-flash\' is not valid for provider \'openai\'');
      expect(result.content[0]?.text).not.toContain('SUMMARIZE_TOOL_ERROR');

      // Should successfully use OpenAI with its default model
      expect(result.content[0]?.text).toBe('OpenAI summary result');
      expect(openaiCreate).toHaveBeenCalled();

      // Verify it used the correct default model for OpenAI
      // @ts-ignore
      const callArgs = openaiCreate.mock.calls[0][0];
      // @ts-ignore
      expect(callArgs.model).toBe('gpt-4o-mini'); // OpenAI's default, NOT gemini-2.5-flash
    });

    it('should use Gemini default model when provider="gemini" without explicit model', async () => {
      setupConfigSpies();
      const manager = new LLMManager();

      const geminiGenerate = jest.fn(async () => ({
        response: {
          text: () => 'Gemini summary result',
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 20,
            totalTokenCount: 30
          }
        }
      }));

      let capturedModel: string | undefined;
      (manager as any).clients = {
        gemini: {
          getGenerativeModel: (config: any) => {
            capturedModel = config.model;
            return { generateContent: geminiGenerate };
          }
        }
      };

      const input: SummarizeToolInput = {
        text: 'Test text to summarize',
        provider: 'gemini'
        // NO MODEL SPECIFIED
      };

      const result = await handleSummarizeTool(input, manager);

      // Should NOT fail
      expect(result.content[0]?.text).not.toContain('SUMMARIZE_TOOL_ERROR');

      // Should successfully use Gemini
      expect(result.content[0]?.text).toBe('Gemini summary result');
      expect(geminiGenerate).toHaveBeenCalled();
      expect(capturedModel).toBe('gemini-2.5-flash'); // Gemini's default
    });

    it('should use explicit provider with its default model (mocked LLMManager)', async () => {
      const completeMock = jest.fn<() => Promise<any>>().mockResolvedValue({
        content: 'Summary from Claude.',
        provider: 'claude',
        model: 'claude-3-5-haiku-20241022',
        responseTime: 100
      });

      const manager = {
        getProviderForTool: jest.fn().mockReturnValue({
          provider: 'gemini',
          model: 'gemini-2.5-flash'
        }),
        complete: completeMock,
        getAvailableProviders: jest.fn().mockReturnValue(['claude', 'gemini']),
        clearCache: jest.fn(),
        getCacheStats: jest.fn(),
        initialize: jest.fn(),
        isProviderAvailable: jest.fn().mockReturnValue(true)
      } as unknown as LLMManager;

      const result = await handleSummarizeTool(
        {
          text: 'Text to summarize',
          provider: 'claude' // Override default gemini provider
          // No model specified - should use claude's default model (claude-3-5-haiku-20241022)
        },
        manager
      );

      // Should use provider='claude' with model='claude-3-5-haiku-20241022' (claude's default)
      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'claude',
          model: 'claude-3-5-haiku-20241022'
        })
      );

      expect(result.content[0]!.type).toBe('text');
      expect(result.content[0]!.text).toBe('Summary from Claude.');
    });
  });

  /**
   * Section 4: Explicit Provider and Model Combinations
   * Tests both valid and invalid provider/model combinations
   */
  describe('Explicit Provider and Model Combinations', () => {
    describe('Valid combinations', () => {
      it('should accept claude + claude-3-5-haiku-20241022', async () => {
        setupConfigSpies();
        const manager = new LLMManager();
        const claudeCreate = jest.fn(async () => ({
          content: [{ type: 'text', text: 'Summary' }],
          usage: { input_tokens: 10, output_tokens: 20, cache_creation: null, cache_creation_input_tokens: null, cache_read_input_tokens: null, server_tool_use: null, service_tier: null }
        }));
        (manager as any).clients = { claude: { messages: { create: claudeCreate } } };

        const input: SummarizeToolInput = {
          text: 'Test',
          provider: 'claude',
          model: 'claude-3-5-haiku-20241022'
        };

        const result = await handleSummarizeTool(input, manager);
        expect(result.content[0]?.text).not.toContain('SUMMARIZE_TOOL_ERROR');
      });

      it('should accept openai + gpt-4o', async () => {
        setupConfigSpies();
        const manager = new LLMManager();
        const openaiCreate = jest.fn(async () => ({
          choices: [{ message: { content: 'Summary' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
        }));
        (manager as any).clients = { openai: { chat: { completions: { create: openaiCreate } } } };

        const input: SummarizeToolInput = {
          text: 'Test',
          provider: 'openai',
          model: 'gpt-4o'
        };

        const result = await handleSummarizeTool(input, manager);
        expect(result.content[0]?.text).not.toContain('SUMMARIZE_TOOL_ERROR');
      });

      it('should accept gemini + gemini-2.5-flash', async () => {
        setupConfigSpies();
        const manager = new LLMManager();
        const geminiGenerate = jest.fn(async () => ({
          response: {
            text: () => 'Summary',
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 }
          }
        }));
        (manager as any).clients = { gemini: { getGenerativeModel: () => ({ generateContent: geminiGenerate }) } };

        const input: SummarizeToolInput = {
          text: 'Test',
          provider: 'gemini',
          model: 'gemini-2.5-flash'
        };

        const result = await handleSummarizeTool(input, manager);
        expect(result.content[0]?.text).not.toContain('SUMMARIZE_TOOL_ERROR');
      });

      it('should use both explicit provider and model when specified', async () => {
        const completeMock = jest.fn<() => Promise<any>>().mockResolvedValue({
          content: 'Summary from GPT-4o.',
          provider: 'openai',
          model: 'gpt-4o',
          responseTime: 100
        });

        const manager = {
          getProviderForTool: jest.fn().mockReturnValue({
            provider: 'gemini',
            model: 'gemini-2.5-flash'
          }),
          complete: completeMock,
          getAvailableProviders: jest.fn().mockReturnValue(['openai']),
          clearCache: jest.fn(),
          getCacheStats: jest.fn(),
          initialize: jest.fn(),
          isProviderAvailable: jest.fn().mockReturnValue(true)
        } as unknown as LLMManager;

        const result = await handleSummarizeTool(
          {
            text: 'Text to summarize',
            provider: 'openai',
            model: 'gpt-4o'
          },
          manager
        );

        expect(completeMock).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: 'openai',
            model: 'gpt-4o'
          })
        );

        expect(result.content[0]!.text).toBe('Summary from GPT-4o.');
      });
    });

    describe('Invalid combinations (should error)', () => {
      it('should reject claude + gpt-4o', async () => {
        setupConfigSpies();
        const manager = new LLMManager();
        (manager as any).clients = { claude: { messages: { create: jest.fn() } } };

        const input: SummarizeToolInput = {
          text: 'Test',
          provider: 'claude',
          model: 'gpt-4o'
        };

        const result = await handleSummarizeTool(input, manager);
        expect(result.content[0]?.text).toContain('is not valid for provider');
        expect(result.content[0]?.text).toContain('gpt-4o');
        expect(result.content[0]?.text).toContain('claude');
      });

      it('should reject claude + gemini-2.5-flash', async () => {
        setupConfigSpies();
        const manager = new LLMManager();
        (manager as any).clients = { claude: { messages: { create: jest.fn() } } };

        const input: SummarizeToolInput = {
          text: 'Test',
          provider: 'claude',
          model: 'gemini-2.5-flash'
        };

        const result = await handleSummarizeTool(input, manager);
        expect(result.content[0]?.text).toContain('is not valid for provider');
        expect(result.content[0]?.text).toContain('gemini-2.5-flash');
        expect(result.content[0]?.text).toContain('claude');
      });

      it('should reject Gemini model with Claude provider', async () => {
        const completeMock = jest.fn();

        const manager = {
          getProviderForTool: jest.fn().mockReturnValue({
            provider: 'claude',
            model: 'claude-3-5-haiku-20241022'
          }),
          complete: completeMock,
          getAvailableProviders: jest.fn().mockReturnValue(['claude']),
          clearCache: jest.fn(),
          getCacheStats: jest.fn(),
          initialize: jest.fn(),
          isProviderAvailable: jest.fn().mockReturnValue(true)
        } as unknown as LLMManager;

        const result = await handleSummarizeTool(
          {
            text: 'Text to summarize',
            provider: 'claude',
            model: 'gemini-2.5-flash' // INVALID: gemini model with claude provider
          },
          manager
        );

        // Should return error, not call complete
        expect(completeMock).not.toHaveBeenCalled();
        expect(result.content[0]!.type).toBe('text');
        expect(result.content[0]!.text).toContain('Summarization failed');
        expect(result.content[0]!.text).toContain('not valid for provider');
      });

      it('should reject Claude model with Gemini provider', async () => {
        const completeMock = jest.fn();

        const manager = {
          getProviderForTool: jest.fn().mockReturnValue({
            provider: 'gemini',
            model: 'gemini-2.5-flash'
          }),
          complete: completeMock,
          getAvailableProviders: jest.fn().mockReturnValue(['gemini']),
          clearCache: jest.fn(),
          getCacheStats: jest.fn(),
          initialize: jest.fn(),
          isProviderAvailable: jest.fn().mockReturnValue(true)
        } as unknown as LLMManager;

        const result = await handleSummarizeTool(
          {
            text: 'Text to summarize',
            provider: 'gemini',
            model: 'claude-3-5-haiku-20241022' as any // INVALID: claude model with gemini provider
          },
          manager
        );

        // Should return error, not call complete
        expect(completeMock).not.toHaveBeenCalled();
        expect(result.content[0]!.type).toBe('text');
        expect(result.content[0]!.text).toContain('Summarization failed');
        expect(result.content[0]!.text).toContain('not valid for provider');
      });

      it('should reject openai + claude-3-5-haiku-20241022', async () => {
        setupConfigSpies();
        const manager = new LLMManager();
        (manager as any).clients = { openai: { chat: { completions: { create: jest.fn() } } } };

        const input: SummarizeToolInput = {
          text: 'Test',
          provider: 'openai',
          model: 'claude-3-5-haiku-20241022'
        };

        const result = await handleSummarizeTool(input, manager);
        expect(result.content[0]?.text).toContain('is not valid for provider');
      });

      it('should reject gemini + gpt-4o', async () => {
        setupConfigSpies();
        const manager = new LLMManager();
        (manager as any).clients = { gemini: { getGenerativeModel: jest.fn() } };

        const input: SummarizeToolInput = {
          text: 'Test',
          provider: 'gemini',
          model: 'gpt-4o'
        };

        const result = await handleSummarizeTool(input, manager);
        expect(result.content[0]?.text).toContain('is not valid for provider');
      });
    });
  });

  /**
   * Section 5: Model Override with Default Provider
   * Tests explicit model override while using default provider
   */
  describe('Model Override with Default Provider', () => {
    it('should use explicit model when specified with default provider', async () => {
      const completeMock = jest.fn<() => Promise<any>>().mockResolvedValue({
        content: 'Summary from Gemini Pro.',
        provider: 'gemini',
        model: 'gemini-2.5-flash-lite',
        responseTime: 100
      });

      const manager = {
        getProviderForTool: jest.fn().mockReturnValue({
          provider: 'gemini',
          model: 'gemini-2.5-flash'
        }),
        complete: completeMock,
        getAvailableProviders: jest.fn().mockReturnValue(['gemini']),
        clearCache: jest.fn(),
        getCacheStats: jest.fn(),
        initialize: jest.fn(),
        isProviderAvailable: jest.fn().mockReturnValue(true)
      } as unknown as LLMManager;

      const result = await handleSummarizeTool(
        {
          text: 'Text to summarize',
          model: 'gemini-2.5-flash-lite' // Override default model but keep default provider
        },
        manager
      );

      // Should use default provider with overridden model
      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.5-flash-lite'
        })
      );

      expect(result.content[0]!.text).toBe('Summary from Gemini Pro.');
    });
  });

  /**
   * Section 6: Optional Parameters
   * Tests length, format, and focus parameters work with defaults
   */
  describe('Optional Parameters with Defaults', () => {
    it('should accept length parameter with default provider/model', async () => {
      const completeMock = jest.fn<() => Promise<any>>().mockResolvedValue({
        content: 'Brief summary.',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        responseTime: 100
      });

      const manager = {
        getProviderForTool: jest.fn().mockReturnValue({
          provider: 'gemini',
          model: 'gemini-2.5-flash'
        }),
        complete: completeMock,
        getAvailableProviders: jest.fn().mockReturnValue(['gemini']),
        clearCache: jest.fn(),
        getCacheStats: jest.fn(),
        initialize: jest.fn(),
        isProviderAvailable: jest.fn().mockReturnValue(true)
      } as unknown as LLMManager;

      const result = await handleSummarizeTool(
        {
          text: 'Text to summarize',
          length: 'brief'
        },
        manager
      );

      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          systemPrompt: expect.stringContaining('very concise')
        })
      );

      expect(result.content[0]!.text).toBe('Brief summary.');
    });

    it('should accept format parameter with default provider/model', async () => {
      const completeMock = jest.fn<() => Promise<any>>().mockResolvedValue({
        content: '• Point 1\n• Point 2',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        responseTime: 100
      });

      const manager = {
        getProviderForTool: jest.fn().mockReturnValue({
          provider: 'gemini',
          model: 'gemini-2.5-flash'
        }),
        complete: completeMock,
        getAvailableProviders: jest.fn().mockReturnValue(['gemini']),
        clearCache: jest.fn(),
        getCacheStats: jest.fn(),
        initialize: jest.fn(),
        isProviderAvailable: jest.fn().mockReturnValue(true)
      } as unknown as LLMManager;

      const result = await handleSummarizeTool(
        {
          text: 'Text to summarize',
          format: 'bullets'
        },
        manager
      );

      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          systemPrompt: expect.stringContaining('bullet points')
        })
      );

      expect(result.content[0]!.text).toBe('• Point 1\n• Point 2');
    });
  });
});
