/**
 * Comprehensive test suite for chat tool
 *
 * Tests cover:
 * 1. Default provider/model combinations
 * 2. Provider fallback behavior
 * 3. Explicit provider with default model
 * 4. Provider/model validation
 * 5. Optional parameters (system_prompt, temperature)
 * 6. Error handling (provider unavailable, invalid model)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createChatTool, type ChatToolInput } from '../src/chat.js';
import type { LLMManager } from '@mcp-typescript-simple/tools-llm';
import type { AnyModel } from '@mcp-typescript-simple/tools-llm';

type ToolResponse = {
  content: Array<{ type: string; text?: string }>;
};

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
    completeResponse = 'Mock AI response',
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

describe('Chat Tool', () => {
  describe('Tool Creation and Basic Functionality', () => {
    it('should create a valid tool definition', () => {
      const { manager } = createMockManager();
      const tool = createChatTool(manager);

      expect(tool.name).toBe('chat');
      expect(tool.description).toContain('Interactive AI assistant');
      expect(tool.inputSchema).toBeDefined();
      expect(tool.handler).toBeDefined();
    });

    it('should successfully handle a basic chat message', async () => {
      const { manager, completeMock } = createMockManager({
        completeResponse: 'Hello! How can I help you?'
      });
      const tool = createChatTool(manager);

      const result = await tool.handler({
        message: 'Hello, AI!'
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toBe('Hello! How can I help you?');
      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Hello, AI!',
          provider: 'claude',
          model: 'claude-3-haiku-20240307'
        })
      );
    });
  });

  describe('Default Provider/Model Behavior', () => {
    it('should use default provider and model when none specified', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createChatTool(manager);

      await tool.handler({
        message: 'Test message'
      });

      expect(manager.getProviderForTool).toHaveBeenCalledWith('chat');
      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'claude',
          model: 'claude-3-haiku-20240307'
        })
      );
    });

    it('should use OpenAI as default if configured', async () => {
      const { manager, completeMock } = createMockManager({
        defaultProvider: 'openai',
        defaultModel: 'gpt-4o-mini'
      });
      const tool = createChatTool(manager);

      await tool.handler({
        message: 'Test message'
      });

      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4o-mini'
        })
      );
    });

    it('should use Gemini as default if configured', async () => {
      const { manager, completeMock } = createMockManager({
        defaultProvider: 'gemini',
        defaultModel: 'gemini-2.5-flash'
      });
      const tool = createChatTool(manager);

      await tool.handler({
        message: 'Test message'
      });

      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
          model: 'gemini-2.5-flash'
        })
      );
    });
  });

  describe('Explicit Provider Selection', () => {
    it('should use explicitly specified Claude provider', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createChatTool(manager);

      await tool.handler({
        message: 'Test message',
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
      const tool = createChatTool(manager);

      await tool.handler({
        message: 'Test message',
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
      const tool = createChatTool(manager);

      await tool.handler({
        message: 'Test message',
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
      const tool = createChatTool(manager);

      await tool.handler({
        message: 'Test message',
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
      const tool = createChatTool(manager);

      const result = await tool.handler({
        message: 'Test message',
        provider: 'claude',
        model: 'gpt-4' // Invalid: OpenAI model with Claude provider
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toContain('Chat failed');
      expect(result.content[0]?.text).toContain('not valid for provider');
      expect(completeMock).not.toHaveBeenCalled();
    });

    it('should reject OpenAI model with Gemini provider', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createChatTool(manager);

      const result = await tool.handler({
        message: 'Test message',
        provider: 'gemini',
        model: 'gpt-4o-mini'
      });

      expect(result.content[0]?.text).toContain('not valid for provider');
      expect(completeMock).not.toHaveBeenCalled();
    });

    it('should reject Gemini model with Claude provider', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createChatTool(manager);

      const result = await tool.handler({
        message: 'Test message',
        provider: 'claude',
        model: 'gemini-2.5-flash'
      });

      expect(result.content[0]?.text).toContain('not valid for provider');
      expect(completeMock).not.toHaveBeenCalled();
    });
  });

  describe('Optional Parameters', () => {
    it('should pass system_prompt to LLM manager', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createChatTool(manager);

      await tool.handler({
        message: 'Test message',
        system_prompt: 'You are a helpful coding assistant'
      });

      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Test message',
          systemPrompt: 'You are a helpful coding assistant'
        })
      );
    });

    it('should pass temperature to LLM manager', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createChatTool(manager);

      await tool.handler({
        message: 'Test message',
        temperature: 0.9
      });

      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Test message',
          temperature: 0.9
        })
      );
    });

    it('should pass all optional parameters together', async () => {
      const { manager, completeMock } = createMockManager();
      const tool = createChatTool(manager);

      await tool.handler({
        message: 'Test message',
        system_prompt: 'You are a helpful assistant',
        temperature: 1.2,
        provider: 'openai',
        model: 'gpt-4o'
      });

      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Test message',
          systemPrompt: 'You are a helpful assistant',
          temperature: 1.2,
          provider: 'openai',
          model: 'gpt-4o'
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should return structured error when LLM provider fails', async () => {
      const { manager, completeMock } = createMockManager({
        completeError: new Error("LLM provider 'claude' not available")
      });
      const tool = createChatTool(manager);

      const result = await tool.handler({
        message: 'Test message'
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toContain('Chat failed');
      expect(result.content[0]?.text).toContain('not available');
      expect(result.content[0]?.text).toContain('CHAT_TOOL_ERROR');
    });

    it('should return structured error when LLM request fails', async () => {
      const { manager, completeMock } = createMockManager({
        completeError: new Error('LLM request failed: Timeout')
      });
      const tool = createChatTool(manager);

      const result = await tool.handler({
        message: 'Test message'
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.text).toContain('Chat failed');
      expect(result.content[0]?.text).toContain('Timeout');
      expect(result.content[0]?.text).toContain('CHAT_TOOL_ERROR');
    });

    it('should return structured error for network failures', async () => {
      const { manager, completeMock } = createMockManager({
        completeError: new Error('Network error: Connection refused')
      });
      const tool = createChatTool(manager);

      const result = await tool.handler({
        message: 'Test message'
      });

      expect(result.content[0]?.text).toContain('Chat failed');
      expect(result.content[0]?.text).toContain('Connection refused');
    });

    it('should handle non-Error exceptions gracefully', async () => {
      const { manager } = createMockManager();
      const completeMock = vi.fn().mockRejectedValue('String error');
      manager.complete = completeMock as any;

      const tool = createChatTool(manager);

      const result = await tool.handler({
        message: 'Test message'
      });

      expect(result.content[0]?.text).toContain('Chat failed');
      expect(result.content[0]?.text).toContain('String error');
    });
  });

  describe('Provider Availability', () => {
    it('should work when only Claude is available', async () => {
      const { manager, completeMock } = createMockManager({
        availableProviders: ['claude']
      });
      const tool = createChatTool(manager);

      await tool.handler({
        message: 'Test message',
        provider: 'claude'
      });

      expect(completeMock).toHaveBeenCalled();
    });

    it('should work when only OpenAI is available', async () => {
      const { manager, completeMock } = createMockManager({
        defaultProvider: 'openai',
        defaultModel: 'gpt-4o-mini',
        availableProviders: ['openai']
      });
      const tool = createChatTool(manager);

      await tool.handler({
        message: 'Test message',
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
      const tool = createChatTool(manager);

      await tool.handler({
        message: 'Test message',
        provider: 'gemini'
      });

      expect(completeMock).toHaveBeenCalled();
    });
  });

  describe('Integration with ToolRegistry', () => {
    it('should be callable through tool registry interface', async () => {
      const { manager, completeMock } = createMockManager({
        completeResponse: 'Registry test response'
      });
      const tool = createChatTool(manager);

      // Simulate how ToolRegistry calls the handler
      const result = await tool.handler({
        message: 'Test via registry'
      });

      expect(result.content[0]?.text).toBe('Registry test response');
      expect(completeMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Test via registry'
        })
      );
    });

    it('should return MCP-compliant response structure', async () => {
      const { manager } = createMockManager();
      const tool = createChatTool(manager);

      const result = await tool.handler({
        message: 'Test message'
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
