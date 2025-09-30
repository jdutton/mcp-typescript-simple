/**
 * Comprehensive tests for summarize tool default behavior
 *
 * These tests verify that:
 * 1. Default provider/model combinations are valid
 * 2. Tool respects explicit provider/model overrides
 * 3. Provider and model are correctly aligned
 */

import { jest } from '@jest/globals';
import { handleSummarizeTool } from '../../../../src/tools/llm/summarize.js';
import type { LLMManager } from '../../../../src/llm/manager.js';
import { DEFAULT_TOOL_LLM_MAPPING, isValidModelForProvider } from '../../../../src/llm/types.js';

type ToolResponse = {
  content: Array<{ type: string; text?: string }>;
};

describe('Summarize Tool Default Behavior', () => {
  /**
   * Test 1: Verify the defaults defined in DEFAULT_TOOL_LLM_MAPPING are valid
   * This is a unit test that catches configuration errors before runtime
   */
  describe('Default Configuration Validation', () => {
    it('should have valid provider/model combination in DEFAULT_TOOL_LLM_MAPPING', () => {
      const defaults = DEFAULT_TOOL_LLM_MAPPING['summarize'];

      expect(defaults).toBeDefined();
      if (!defaults) {
        throw new Error('summarize defaults not defined');
      }

      expect(defaults.provider).toBe('gemini');
      expect(defaults.model).toBe('gemini-1.5-flash');

      // Critical: Verify the default model is valid for the default provider
      if (!defaults.model) {
        throw new Error('default model not defined');
      }
      expect(isValidModelForProvider(defaults.provider, defaults.model)).toBe(true);
    });

    it('should reject invalid provider/model combinations', () => {
      // gemini model with claude provider should be invalid
      expect(isValidModelForProvider('claude', 'gemini-1.5-flash')).toBe(false);

      // claude model with gemini provider should be invalid
      expect(isValidModelForProvider('gemini', 'claude-3-5-haiku-20241022' as any)).toBe(false);
    });
  });

  /**
   * Test 2: Verify tool uses defaults when only required fields provided
   */
  describe('Using Tool Defaults', () => {
    it('should use default provider and model when only text is provided', async () => {
      const completeMock = jest.fn<() => Promise<any>>().mockResolvedValue({
        content: 'This is a summary.',
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        responseTime: 100
      });

      const manager = {
        getProviderForTool: jest.fn().mockReturnValue({
          provider: 'gemini',
          model: 'gemini-1.5-flash'
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
          model: 'gemini-1.5-flash'
        })
      );

      // Verify success response
      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe('text');
      expect(result.content[0]!.text).toBe('This is a summary.');
    });
  });

  /**
   * Test 3: Verify explicit provider override works correctly
   * BUG: This test demonstrates the reported bug - when provider is overridden
   * without specifying a model, the tool uses the DEFAULT tool model (gemini-1.5-flash)
   * with the overridden provider (claude), creating a mismatch.
   */
  describe('Provider Override - DEMONSTRATES BUG', () => {
    it('FAILS: should use explicit provider when specified, with its default model', async () => {
      const completeMock = jest.fn<() => Promise<any>>();

      const manager = {
        getProviderForTool: jest.fn().mockReturnValue({
          provider: 'gemini',
          model: 'gemini-1.5-flash'
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
          // No model specified - BUG: uses gemini-1.5-flash with claude provider!
        },
        manager
      );

      // BUG: This should use provider='claude' with model=undefined (let manager choose)
      // But actually uses provider='claude' with model='gemini-1.5-flash' (INVALID!)
      // The tool should return an error because gemini-1.5-flash is not valid for claude provider
      expect(result.content[0]!.type).toBe('text');
      expect(result.content[0]!.text).toContain('Summarization failed');
      expect(result.content[0]!.text).toContain('not valid for provider');
    });
  });

  /**
   * Test 4: Verify explicit model override works correctly
   */
  describe('Model Override', () => {
    it('should use explicit model when specified with default provider', async () => {
      const completeMock = jest.fn<() => Promise<any>>().mockResolvedValue({
        content: 'Summary from Gemini Pro.',
        provider: 'gemini',
        model: 'gemini-1.5-pro',
        responseTime: 100
      });

      const manager = {
        getProviderForTool: jest.fn().mockReturnValue({
          provider: 'gemini',
          model: 'gemini-1.5-flash'
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
          model: 'gemini-1.5-pro' // Override default model but keep default provider
        },
        manager
      );

      // Should use default provider with overridden model
      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-1.5-pro'
        })
      );

      expect(result.content[0]!.text).toBe('Summary from Gemini Pro.');
    });
  });

  /**
   * Test 5: Verify both provider and model can be overridden together
   */
  describe('Provider and Model Override', () => {
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
          model: 'gemini-1.5-flash'
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

  /**
   * Test 6: Verify invalid provider/model combinations are rejected
   * This is the bug that was reported - mismatched provider and model
   */
  describe('Provider/Model Validation', () => {
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
          model: 'gemini-1.5-flash' // INVALID: gemini model with claude provider
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
          model: 'gemini-1.5-flash'
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
  });

  /**
   * Test 7: Verify optional parameters work with defaults
   */
  describe('Optional Parameters with Defaults', () => {
    it('should accept length parameter with default provider/model', async () => {
      const completeMock = jest.fn<() => Promise<any>>().mockResolvedValue({
        content: 'Brief summary.',
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        responseTime: 100
      });

      const manager = {
        getProviderForTool: jest.fn().mockReturnValue({
          provider: 'gemini',
          model: 'gemini-1.5-flash'
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
        model: 'gemini-1.5-flash',
        responseTime: 100
      });

      const manager = {
        getProviderForTool: jest.fn().mockReturnValue({
          provider: 'gemini',
          model: 'gemini-1.5-flash'
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
