/**
 * Comprehensive test suite for analyze tool
 *
 * Tests cover:
 * 1. Default provider/model combinations
 * 2. Analysis type selection (sentiment, themes, structure, etc.)
 * 3. Focus area customization
 * 4. Provider/model validation
 * 5. Error handling
 */
import { describe, it, expect, vi } from 'vitest';
import { createAnalyzeTool } from '../src/analyze.js';
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
    defaultProvider = 'openai',
    defaultModel = 'gpt-4',
    availableProviders = ['claude', 'openai', 'gemini'],
    completeResponse = 'Mock analysis result',
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

describe('Analyze Tool', () => {
  describe('Tool Creation and Basic Functionality', () => {
    it('should create a valid tool definition', () => {
      const { manager } = createMockManager();
      const tool = createAnalyzeTool(manager);

      expect(tool.name).toBe('analyze');
      expect(tool.description).toContain('Deep text analysis');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it('should successfully analyze text with default settings', async () => {
      const { manager, _completeMock } = createMockManager({
        completeResponse: 'Comprehensive analysis of the text...'
      });
      const tool = createAnalyzeTool(manager);

      const result = await tool.handler({
        text: 'Sample text to analyze'
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toBe('Comprehensive analysis of the text...');
      expect(_completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Sample text to analyze'),
          provider: 'openai',
          model: 'gpt-4',
          temperature: 0.3
        })
      );
    });
  });

  describe('Default Provider/Model Behavior', () => {
    it('should use default provider and model when none specified', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createAnalyzeTool(manager);

      await tool.handler({
        text: 'Test text'
      });

      expect(manager.getProviderForTool).toHaveBeenCalledWith('analyze');
      expect(_completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4'
        })
      );
    });

    it('should use OpenAI as default if configured', async () => {
      const { manager, _completeMock } = createMockManager({
        defaultProvider: 'openai',
        defaultModel: 'gpt-4o'
      });
      const tool = createAnalyzeTool(manager);

      await tool.handler({
        text: 'Test text'
      });

      expect(_completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4o'
        })
      );
    });
  });

  describe('Analysis Type Selection', () => {
    const analysisTypes = ['sentiment', 'themes', 'structure', 'comprehensive', 'summary'] as const;

    analysisTypes.forEach(analysisType => {
      it(`should handle ${analysisType} analysis type`, async () => {
        const { manager, _completeMock } = createMockManager();
        const tool = createAnalyzeTool(manager);

        await tool.handler({
          text: 'Test text',
          analysis_type: analysisType
        });

        expect(_completeMock).toHaveBeenCalled();
        const callArgs = _completeMock.mock.calls[0]?.[0];
        expect(callArgs?.systemPrompt).toBeDefined();
      });
    });

    it('should use comprehensive analysis as default', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createAnalyzeTool(manager);

      await tool.handler({
        text: 'Test text'
      });

      const callArgs = _completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('comprehensive');
    });

    it('should use sentiment-specific system prompt for sentiment analysis', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createAnalyzeTool(manager);

      await tool.handler({
        text: 'Test text',
        analysis_type: 'sentiment'
      });

      const callArgs = _completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('sentiment');
    });

    it('should use themes-specific system prompt for themes analysis', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createAnalyzeTool(manager);

      await tool.handler({
        text: 'Test text',
        analysis_type: 'themes'
      });

      const callArgs = _completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('themes');
    });

    it('should use structure-specific system prompt for structure analysis', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createAnalyzeTool(manager);

      await tool.handler({
        text: 'Test text',
        analysis_type: 'structure'
      });

      const callArgs = _completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('structural');
    });
  });

  describe('Focus Area Customization', () => {
    it('should include focus area in system prompt when specified', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createAnalyzeTool(manager);

      await tool.handler({
        text: 'Test text',
        focus: 'technical accuracy'
      });

      const callArgs = _completeMock.mock.calls[0]?.[0];
      expect(callArgs?.systemPrompt).toContain('technical accuracy');
    });

    it('should work without focus area', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createAnalyzeTool(manager);

      await tool.handler({
        text: 'Test text'
      });

      expect(_completeMock).toHaveBeenCalled();
    });
  });

  describe('Explicit Provider Selection', () => {
    it('should use explicitly specified Claude provider', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createAnalyzeTool(manager);

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
      const tool = createAnalyzeTool(manager);

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
      const tool = createAnalyzeTool(manager);

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
      const tool = createAnalyzeTool(manager);

      await tool.handler({
        text: 'Test text',
        provider: 'openai',
        model: 'gpt-4o'
      });

      expect(_completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4o'
        })
      );
    });

    it('should return error for invalid model/provider combination', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createAnalyzeTool(manager);

      const result = await tool.handler({
        text: 'Test text',
        provider: 'openai',
        model: 'claude-3-haiku-20240307' // Invalid: Claude model with OpenAI provider
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toContain('Analysis failed');
      expect(result.content[0]?.text).toContain('not valid for provider');
      expect(_completeMock).not.toHaveBeenCalled();
    });

    it('should reject Gemini model with Claude provider', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createAnalyzeTool(manager);

      const result = await tool.handler({
        text: 'Test text',
        provider: 'claude',
        model: 'gemini-2.5-flash'
      });

      expect(result.content[0]?.text).toContain('not valid for provider');
      expect(_completeMock).not.toHaveBeenCalled();
    });

    it('should reject Claude model with Gemini provider', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createAnalyzeTool(manager);

      const result = await tool.handler({
        text: 'Test text',
        provider: 'gemini',
        model: 'claude-3-haiku-20240307'
      });

      expect(result.content[0]?.text).toContain('not valid for provider');
      expect(_completeMock).not.toHaveBeenCalled();
    });
  });

  describe('Temperature Control', () => {
    it('should use temperature of 0.3 for analytical consistency', async () => {
      const { manager, _completeMock } = createMockManager();
      const tool = createAnalyzeTool(manager);

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
        completeError: new Error("LLM provider 'openai' not available")
      });
      const tool = createAnalyzeTool(manager);

      const result = await tool.handler({
        text: 'Test text'
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toContain('Analysis failed');
      expect(result.content[0]?.text).toContain('not available');
      expect(result.content[0]?.text).toContain('ANALYZE_TOOL_ERROR');
    });

    it('should return structured error when LLM request fails', async () => {
      const { manager } = createMockManager({
        completeError: new Error('LLM request failed: Timeout')
      });
      const tool = createAnalyzeTool(manager);

      const result = await tool.handler({
        text: 'Test text'
      });

      expect(result.content[0]?.text).toContain('Analysis failed');
      expect(result.content[0]?.text).toContain('Timeout');
      expect(result.content[0]?.text).toContain('ANALYZE_TOOL_ERROR');
    });

    it('should handle non-Error exceptions gracefully', async () => {
      const { manager } = createMockManager();
      const _completeMock = vi.fn().mockRejectedValue('String error');
      manager.complete = _completeMock as any;

      const tool = createAnalyzeTool(manager);

      const result = await tool.handler({
        text: 'Test text'
      });

      expect(result.content[0]?.text).toContain('Analysis failed');
      expect(result.content[0]?.text).toContain('String error');
    });
  });

  describe('Integration with ToolRegistry', () => {
    it('should return MCP-compliant response structure', async () => {
      const { manager } = createMockManager();
      const tool = createAnalyzeTool(manager);

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
});
