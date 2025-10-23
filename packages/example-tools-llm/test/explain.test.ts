/**
 * Comprehensive test suite for explain tool
 *
 * Tests cover:
 * 1. Default provider/model combinations
 * 2. Audience level adaptation (beginner, intermediate, advanced)
 * 3. Context specification
 * 4. Example inclusion control
 * 5. Provider/model validation
 * 6. Error handling
 */
import { describe, it, expect, vi } from 'vitest';
import { createExplainTool, type ExplainToolInput } from '../src/explain.js';
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
    defaultProvider = 'claude',
    defaultModel = 'claude-3-haiku-20240307',
    availableProviders = ['claude', 'openai', 'gemini'],
    completeResponse = 'Mock explanation result',
    completeError
  } = options;

  const completeMock = vi.fn<Parameters<LLMManager['complete']>, ReturnType<LLMManager['complete']>>();

  if (completeError) {
    completeMock.mockRejectedValue(completeError);
  } else {
    completeMock.mockResolvedValue({
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
    complete: completeMock,
    clearCache: vi.fn(),
    getCacheStats: vi.fn(),
    initialize: vi.fn(),
    isProviderAvailable: vi.fn().mockImplementation((provider: string) =>
      availableProviders.includes(provider)
    )
  } as unknown as LLMManager;

  return { manager, completeMock };
};

describe('Explain Tool', () => {
  describe('Tool Creation and Basic Functionality', () => {
    it('should create a valid tool definition', () => {
      const { manager } = createMockManager();
      const tool = createExplainTool(manager);

      expect(tool.name).toBe('explain');
      expect(tool.description).toContain('explanation');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it('should successfully explain a topic with default settings', async () => {
      const { manager, completeMock } = createMockManager({
        completeResponse: 'Clear explanation of the topic...'
      });
      const tool = createExplainTool(manager);

      const result = await tool.handler({
        topic: 'async/await in JavaScript'
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toBe('Clear explanation of the topic...');
      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Please explain: async/await in JavaScript',
          provider: 'claude',
          model: 'claude-3-haiku-20240307',
          temperature: 0.4
        })
      );
    });
  });

  describe('Default Provider/Model Behavior', () => {
    it('should use default provider and model when none specified', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic'
      });

      expect(manager.getProviderForTool).toHaveBeenCalledWith('explain');
      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'claude',
          model: 'claude-3-haiku-20240307'
        })
      );
    });

    it('should use Claude as default if configured', async () => {
      const { manager, completeMock } = createMockManager({
        defaultProvider: 'claude',
        defaultModel: 'claude-3-5-haiku-20241022'
      });
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic'
      });

      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'claude',
          model: 'claude-3-5-haiku-20241022'
        })
      );
    });
  });

  describe('Audience Level Adaptation', () => {
    it('should handle beginner level', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic',
        level: 'beginner'
      });

      expect(completeMock).toHaveBeenCalled();
      const callArgs = completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('simple terms');
      expect(callArgs?.systemPrompt).toContain('minimal prior knowledge');
    });

    it('should handle intermediate level', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic',
        level: 'intermediate'
      });

      expect(completeMock).toHaveBeenCalled();
      const callArgs = completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('balanced explanation');
      expect(callArgs?.systemPrompt).toContain('foundational knowledge');
    });

    it('should handle advanced level', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic',
        level: 'advanced'
      });

      expect(completeMock).toHaveBeenCalled();
      const callArgs = completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('technical precision');
      expect(callArgs?.systemPrompt).toContain('strong foundational knowledge');
    });

    it('should use intermediate level as default', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic'
      });

      const callArgs = completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('balanced explanation');
    });
  });

  describe('Example Inclusion Control', () => {
    it('should include examples by default', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic'
      });

      const callArgs = completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('examples');
    });

    it('should include examples when explicitly set to true', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic',
        include_examples: true
      });

      const callArgs = completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('examples');
    });

    it('should exclude examples when set to false', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic',
        include_examples: false
      });

      const callArgs = completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).not.toContain('examples');
    });
  });

  describe('Context Specification', () => {
    it('should include context in system prompt when specified', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic',
        context: 'web development'
      });

      const callArgs = completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('web development');
    });

    it('should work without context', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic'
      });

      expect(completeMock).toHaveBeenCalled();
    });

    it('should combine context with level and examples', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic',
        level: 'beginner',
        context: 'machine learning',
        include_examples: true
      });

      const callArgs = completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('simple terms');
      expect(callArgs?.systemPrompt).toContain('machine learning');
      expect(callArgs?.systemPrompt).toContain('examples');
    });
  });

  describe('Explicit Provider Selection', () => {
    it('should use explicitly specified Claude provider', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic',
        provider: 'claude'
      });

      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'claude'
        })
      );
    });

    it('should use explicitly specified OpenAI provider', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic',
        provider: 'openai'
      });

      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai'
        })
      );
    });

    it('should use explicitly specified Gemini provider', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic',
        provider: 'gemini'
      });

      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini'
        })
      );
    });
  });

  describe('Model Selection and Validation', () => {
    it('should use explicitly specified model', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic',
        provider: 'claude',
        model: 'claude-3-5-haiku-20241022'
      });

      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'claude',
          model: 'claude-3-5-haiku-20241022'
        })
      );
    });

    it('should return error for invalid model/provider combination', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      const result = await tool.handler({
        topic: 'Test topic',
        provider: 'claude',
        model: 'gpt-4o' // Invalid: OpenAI model with Claude provider
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toContain('Explanation failed');
      expect(result.content[0]?.text).toContain('not valid for provider');
      expect(completeMock).not.toHaveBeenCalled();
    });

    it('should reject Gemini model with OpenAI provider', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      const result = await tool.handler({
        topic: 'Test topic',
        provider: 'openai',
        model: 'gemini-2.5-flash'
      });

      expect(result.content[0]?.text).toContain('not valid for provider');
      expect(completeMock).not.toHaveBeenCalled();
    });

    it('should reject OpenAI model with Gemini provider', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      const result = await tool.handler({
        topic: 'Test topic',
        provider: 'gemini',
        model: 'gpt-4o'
      });

      expect(result.content[0]?.text).toContain('not valid for provider');
      expect(completeMock).not.toHaveBeenCalled();
    });

    it('should accept valid Claude model with Claude provider', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic',
        provider: 'claude',
        model: 'claude-3-haiku-20240307'
      });

      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'claude',
          model: 'claude-3-haiku-20240307'
        })
      );
    });

    it('should accept valid OpenAI model with OpenAI provider', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic',
        provider: 'openai',
        model: 'gpt-4o'
      });

      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4o'
        })
      );
    });

    it('should accept valid Gemini model with Gemini provider', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic',
        provider: 'gemini',
        model: 'gemini-2.5-flash'
      });

      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.5-flash'
        })
      );
    });
  });

  describe('Temperature Control', () => {
    it('should use temperature of 0.4 for balanced creativity', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic'
      });

      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.4
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should return structured error when LLM provider fails', async () => {
      const { manager } = createMockManager({
        completeError: new Error("LLM provider 'claude' not available")
      });
      const tool = createExplainTool(manager);

      const result = await tool.handler({
        topic: 'Test topic'
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toContain('Explanation failed');
      expect(result.content[0]?.text).toContain('not available');
      expect(result.content[0]?.text).toContain('EXPLAIN_TOOL_ERROR');
    });

    it('should return structured error when LLM request fails', async () => {
      const { manager } = createMockManager({
        completeError: new Error('LLM request failed: Timeout')
      });
      const tool = createExplainTool(manager);

      const result = await tool.handler({
        topic: 'Test topic'
      });

      expect(result.content[0]?.text).toContain('Explanation failed');
      expect(result.content[0]?.text).toContain('Timeout');
      expect(result.content[0]?.text).toContain('EXPLAIN_TOOL_ERROR');
    });

    it('should handle non-Error exceptions gracefully', async () => {
      const { manager } = createMockManager();
      const completeMock = vi.fn().mockRejectedValue('String error');
      manager.complete = completeMock as any;

      const tool = createExplainTool(manager);

      const result = await tool.handler({
        topic: 'Test topic'
      });

      expect(result.content[0]?.text).toContain('Explanation failed');
      expect(result.content[0]?.text).toContain('String error');
    });

    it('should handle network failures', async () => {
      const { manager } = createMockManager({
        completeError: new Error('Network error: Connection refused')
      });
      const tool = createExplainTool(manager);

      const result = await tool.handler({
        topic: 'Test topic'
      });

      expect(result.content[0]?.text).toContain('Explanation failed');
      expect(result.content[0]?.text).toContain('Connection refused');
    });
  });

  describe('Integration with ToolRegistry', () => {
    it('should return MCP-compliant response structure', async () => {
      const { manager } = createMockManager();
      const tool = createExplainTool(manager);

      const result = await tool.handler({
        topic: 'Test topic'
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
    it('should work when only Claude is available', async () => {
      const { manager, completeMock } = createMockManager({
        availableProviders: ['claude']
      });
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic',
        provider: 'claude'
      });

      expect(completeMock).toHaveBeenCalled();
    });

    it('should work when only OpenAI is available', async () => {
      const { manager, completeMock } = createMockManager({
        defaultProvider: 'openai',
        defaultModel: 'gpt-4o',
        availableProviders: ['openai']
      });
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic',
        provider: 'openai'
      });

      expect(completeMock).toHaveBeenCalled();
    });

    it('should work when only Gemini is available', async () => {
      const { manager, completeMock } = createMockManager({
        defaultProvider: 'gemini',
        defaultModel: 'gemini-2.5-flash',
        availableProviders: ['gemini']
      });
      const tool = createExplainTool(manager);

      await tool.handler({
        topic: 'Test topic',
        provider: 'gemini'
      });

      expect(completeMock).toHaveBeenCalled();
    });
  });
});
