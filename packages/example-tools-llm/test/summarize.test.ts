/**
 * Comprehensive test suite for summarize tool
 *
 * Tests cover:
 * 1. Default provider/model combinations
 * 2. Length customization (brief, medium, detailed)
 * 3. Format customization (paragraph, bullets, outline)
 * 4. Focus area specification
 * 5. Provider/model validation
 * 6. Error handling
 */
import { describe, it, expect, vi } from 'vitest';
import { createSummarizeTool } from '../src/summarize.js';
import type { LLMManager } from '@mcp-typescript-simple/tools-llm';

/**
 * Create a mock LLM manager for testing
 */

 
const createMockManager = (options: {
  defaultProvider?: string;
  defaultModel?: string;
  availableProviders?: string[];
  completeResponse?: string;
  completeError?: Error;
} = {}) => {
  const {
    defaultProvider = 'gemini',
    defaultModel = 'gemini-2.5-flash',
    availableProviders = ['claude', 'openai', 'gemini'],
    completeResponse = 'Mock summary result',
    completeError
  } = options;

  const _completeMock = vi.fn<Parameters<LLMManager['complete']>, ReturnType<LLMManager['complete']>>();

  if (completeError) {
    _completeMock.mockRejectedValue(completeError);
  } else {
    _completeMock.mockResolvedValue({
      content: completeResponse,
      provider: defaultProvider as any,
      model: defaultModel as any,
      responseTime: 100
    });
  }

  const manager = {
    getProviderForTool: vi.fn().mockReturnValue({
      provider: defaultProvider,
      model: defaultModel
    }),
    getAvailableProviders: vi.fn().mockReturnValue(availableProviders),
    complete: _completeMock,
    clearCache: vi.fn(),
    getCacheStats: vi.fn(),
    initialize: vi.fn(),
    isProviderAvailable: vi.fn().mockImplementation((provider: string) =>
      availableProviders.includes(provider)
    )
  } as unknown as LLMManager;

  return { manager, _completeMock };
};

describe('Summarize Tool', () => {
  describe('Tool Creation and Basic Functionality', () => {
    it('should create a valid tool definition', () => {
      const { manager } = createMockManager();
      const tool = createSummarizeTool(manager);

      expect(tool.name).toBe('summarize');
      expect(tool.description).toContain('summarization');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it('should successfully summarize text with default settings', async () => {
      const { manager, _completeMock } = createMockManager({
        completeResponse: 'Concise summary of the text...'
      });
      const tool = createSummarizeTool(manager);

      const result = await tool.handler({
        text: 'Long text to summarize...'
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toBe('Concise summary of the text...');
      expect(_completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Long text to summarize'),
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          temperature: 0.3
        })
      );
    });
  });

  describe('Default Provider/Model Behavior', () => {
    it('should use default provider and model when none specified', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text'
      });

      expect(manager.getProviderForTool).toHaveBeenCalledWith('summarize');
      expect(_completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.5-flash'
        })
      );
    });

    it('should use Gemini as default if configured', async () => {
      const { manager, _completeMock } = createMockManager({
        defaultProvider: 'gemini',
        defaultModel: 'gemini-2.0-flash'
      });
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text'
      });

      expect(_completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.0-flash'
        })
      );
    });
  });

  describe('Length Customization', () => {
    it('should handle brief length', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        length: 'brief'
      });

      expect(_completeMock).toHaveBeenCalled();
      const callArgs = _completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('1-2 sentences');
    });

    it('should handle medium length', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        length: 'medium'
      });

      expect(_completeMock).toHaveBeenCalled();
      const callArgs = _completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('2-4 sentences');
    });

    it('should handle detailed length', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        length: 'detailed'
      });

      expect(_completeMock).toHaveBeenCalled();
      const callArgs = _completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('multiple paragraphs');
    });

    it('should use medium length as default', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text'
      });

      const callArgs = _completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('2-4 sentences');
    });
  });

  describe('Format Customization', () => {
    it('should handle paragraph format', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        format: 'paragraph'
      });

      expect(_completeMock).toHaveBeenCalled();
      const callArgs = _completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('prose paragraphs');
    });

    it('should handle bullets format', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        format: 'bullets'
      });

      expect(_completeMock).toHaveBeenCalled();
      const callArgs = _completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('bullet points');
    });

    it('should handle outline format', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        format: 'outline'
      });

      expect(_completeMock).toHaveBeenCalled();
      const callArgs = _completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('structured outline');
    });

    it('should use paragraph format as default', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text'
      });

      const callArgs = _completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('prose paragraphs');
    });
  });

  describe('Combined Length and Format Options', () => {
    it('should combine brief length with bullets format', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        length: 'brief',
        format: 'bullets'
      });

      const callArgs = _completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('1-2 sentences');
      expect(callArgs?.systemPrompt).toContain('bullet points');
    });

    it('should combine detailed length with outline format', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        length: 'detailed',
        format: 'outline'
      });

      const callArgs = _completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('multiple paragraphs');
      expect(callArgs?.systemPrompt).toContain('structured outline');
    });
  });

  describe('Focus Area Specification', () => {
    it('should include focus area in system prompt when specified', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        focus: 'key findings'
      });

      const callArgs = _completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('key findings');
    });

    it('should work without focus area', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text'
      });

      expect(_completeMock).toHaveBeenCalled();
    });

    it('should combine focus with length and format', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        length: 'brief',
        format: 'bullets',
        focus: 'technical details'
      });

      const callArgs = _completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('1-2 sentences');
      expect(callArgs?.systemPrompt).toContain('bullet points');
      expect(callArgs?.systemPrompt).toContain('technical details');
    });
  });

  describe('Explicit Provider Selection', () => {
    it('should use explicitly specified Claude provider', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        provider: 'claude'
      });

      expect(_completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'claude'
        })
      );
    });

    it('should use explicitly specified OpenAI provider', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        provider: 'openai'
      });

      expect(_completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai'
        })
      );
    });

    it('should use explicitly specified Gemini provider', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        provider: 'gemini'
      });

      expect(_completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini'
        })
      );
    });
  });

  describe('Model Selection and Validation', () => {
    it('should use explicitly specified model', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        provider: 'gemini',
        model: 'gemini-2.0-flash'
      });

      expect(_completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.0-flash'
        })
      );
    });

    it('should return error for invalid model/provider combination', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      const result = await tool.handler({
        text: 'Test text',
        provider: 'gemini',
        model: 'gpt-4o' // Invalid: OpenAI model with Gemini provider
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toContain('Summarization failed');
      expect(result.content[0]?.text).toContain('not valid for provider');
      expect(_completeMock).not.toHaveBeenCalled();
    });

    it('should reject Claude model with OpenAI provider', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      const result = await tool.handler({
        text: 'Test text',
        provider: 'openai',
        model: 'claude-3-haiku-20240307'
      });

      expect(result.content[0]?.text).toContain('not valid for provider');
      expect(_completeMock).not.toHaveBeenCalled();
    });

    it('should reject OpenAI model with Claude provider', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      const result = await tool.handler({
        text: 'Test text',
        provider: 'claude',
        model: 'gpt-4o'
      });

      expect(result.content[0]?.text).toContain('not valid for provider');
      expect(_completeMock).not.toHaveBeenCalled();
    });

    it('should accept valid Claude model with Claude provider', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        provider: 'claude',
        model: 'claude-3-5-haiku-20241022'
      });

      expect(_completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'claude',
          model: 'claude-3-5-haiku-20241022'
        })
      );
    });

    it('should accept valid OpenAI model with OpenAI provider', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        provider: 'openai',
        model: 'gpt-4o-mini'
      });

      expect(_completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4o-mini'
        })
      );
    });

    it('should accept valid Gemini model with Gemini provider', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        provider: 'gemini',
        model: 'gemini-2.5-flash'
      });

      expect(_completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.5-flash'
        })
      );
    });
  });

  describe('Temperature Control', () => {
    it('should use temperature of 0.3 for consistent summarization', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text'
      });

      expect(_completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.3
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should return structured error when LLM provider fails', async () => {
      const { manager } = createMockManager({
        completeError: new Error("LLM provider 'gemini' not available")
      });
      const tool = createSummarizeTool(manager);

      const result = await tool.handler({
        text: 'Test text'
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toContain('Summarization failed');
      expect(result.content[0]?.text).toContain('not available');
      expect(result.content[0]?.text).toContain('SUMMARIZE_TOOL_ERROR');
    });

    it('should return structured error when LLM request fails', async () => {
      const { manager } = createMockManager({
        completeError: new Error('LLM request failed: Timeout')
      });
      const tool = createSummarizeTool(manager);

      const result = await tool.handler({
        text: 'Test text'
      });

      expect(result.content[0]?.text).toContain('Summarization failed');
      expect(result.content[0]?.text).toContain('Timeout');
      expect(result.content[0]?.text).toContain('SUMMARIZE_TOOL_ERROR');
    });

    it('should handle non-Error exceptions gracefully', async () => {
      const { manager } = createMockManager();
      const _completeMock = vi.fn().mockRejectedValue('String error');
      manager.complete = _completeMock as any;

      const tool = createSummarizeTool(manager);

      const result = await tool.handler({
        text: 'Test text'
      });

      expect(result.content[0]?.text).toContain('Summarization failed');
      expect(result.content[0]?.text).toContain('String error');
    });

    it('should handle network failures', async () => {
      const { manager } = createMockManager({
        completeError: new Error('Network error: Connection refused')
      });
      const tool = createSummarizeTool(manager);

      const result = await tool.handler({
        text: 'Test text'
      });

      expect(result.content[0]?.text).toContain('Summarization failed');
      expect(result.content[0]?.text).toContain('Connection refused');
    });
  });

  describe('Integration with ToolRegistry', () => {
    it('should return MCP-compliant response structure', async () => {
      const { manager } = createMockManager();
      const tool = createSummarizeTool(manager);

      const result = await tool.handler({
        text: 'Test text'
      });

      // MCP requires content array with text/resource/image items
      expect(result).toHaveProperty('content');
      expect(Array.isArray(result.content)).toBe(true);
      expect(result.content[0]).toHaveProperty('type');
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]).toHaveProperty('text');
    });
  });

  describe('Provider Availability', () => {
    it('should work when only Gemini is available', async () => {
      const { manager, _completeMock } = createMockManager({
        availableProviders: ['gemini']
      });
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        provider: 'gemini'
      });

      expect(_completeMock).toHaveBeenCalled();
    });

    it('should work when only Claude is available', async () => {
      const { manager, _completeMock } = createMockManager({
        defaultProvider: 'claude',
        defaultModel: 'claude-3-haiku-20240307',
        availableProviders: ['claude']
      });
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        provider: 'claude'
      });

      expect(_completeMock).toHaveBeenCalled();
    });

    it('should work when only OpenAI is available', async () => {
      const { manager, _completeMock } = createMockManager({
        defaultProvider: 'openai',
        defaultModel: 'gpt-4o-mini',
        availableProviders: ['openai']
      });
      const tool = createSummarizeTool(manager);

      await tool.handler({
        text: 'Test text',
        provider: 'openai'
      });

      expect(_completeMock).toHaveBeenCalled();
    });
  });
});
