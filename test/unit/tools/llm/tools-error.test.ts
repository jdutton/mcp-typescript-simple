import { vi } from 'vitest';

import { handleChatTool } from '../../../../src/tools/llm/chat.js';
import { handleAnalyzeTool } from '../../../../src/tools/llm/analyze.js';
import { handleSummarizeTool } from '../../../../src/tools/llm/summarize.js';
import { handleExplainTool } from '../../../../src/tools/llm/explain.js';
import type { LLMManager } from '../../../../src/llm/manager.js';

type ToolResponse = {
  content: Array<{ type: string; [key: string]: unknown }>;
};

type ToolScenario = {
  tool: string;
  handler: (input: any, manager: LLMManager) => Promise<ToolResponse>;
  defaults: { provider: string; model: string };
  input: Record<string, unknown>;
};

describe('LLM tool error handling', () => {
  const createManager = (defaults: { provider: string; model: string }) => {
    const completeMock = vi.fn();

    const manager = {
      getProviderForTool: vi.fn().mockReturnValue(defaults),
      getAvailableProviders: vi.fn().mockReturnValue([defaults.provider]),
      complete: completeMock,
      clearCache: vi.fn(),
      getCacheStats: vi.fn(),
      initialize: vi.fn(),
      isProviderAvailable: vi.fn().mockReturnValue(true)
    } as unknown as LLMManager;

    return { manager, completeMock };
  };

  const scenarios: ToolScenario[] = [
    {
      tool: 'chat',
      handler: handleChatTool as ToolScenario['handler'],
      defaults: { provider: 'claude', model: 'claude-3-haiku-20240307' },
      input: { message: 'hello', provider: 'claude', model: 'gpt-4' }
    },
    {
      tool: 'analyze',
      handler: handleAnalyzeTool as ToolScenario['handler'],
      defaults: { provider: 'openai', model: 'gpt-4' },
      input: { text: 'analyze me', provider: 'openai', model: 'claude-3-haiku-20240307' }
    },
    {
      tool: 'summarize',
      handler: handleSummarizeTool as ToolScenario['handler'],
      defaults: { provider: 'gemini', model: 'gemini-2.5-flash' },
      input: { text: 'summarize me', provider: 'gemini', model: 'gpt-4' }
    },
    {
      tool: 'explain',
      handler: handleExplainTool as ToolScenario['handler'],
      defaults: { provider: 'claude', model: 'claude-3-haiku-20240307' },
      input: { topic: 'explain', provider: 'claude', model: 'gpt-4' }
    }
  ];

  it.each(scenarios)('returns structured error content for invalid %s requests', async ({ tool, handler, defaults, input }) => {
    const { manager, completeMock } = createManager(defaults);

    const result = await handler(input, manager);

    // Verify error response contains only text content (MCP spec compliant)
    expect(result.content).toHaveLength(1);
    const firstContent = result.content[0]!;
    expect(firstContent.type).toBe('text');
    expect('text' in firstContent && firstContent.text).toContain('failed');
    expect('text' in firstContent && firstContent.text).toContain('not valid');
    expect('text' in firstContent && firstContent.text).toContain(tool);
    expect(completeMock).not.toHaveBeenCalled();
  });

  describe('Provider unavailable error handling (bug fix regression test)', () => {
    it('returns MCP-compliant text error when summarize tool provider fails', async () => {
      const completeMock = vi.fn() as MockFunction<LLMManager['complete']>;
      completeMock.mockRejectedValue(new Error("LLM provider 'gemini' not available"));

      const manager = {
        getProviderForTool: vi.fn().mockReturnValue({ provider: 'gemini', model: 'gemini-2.5-flash' }),
        getAvailableProviders: vi.fn().mockReturnValue([]),
        complete: completeMock,
        clearCache: vi.fn(),
        getCacheStats: vi.fn(),
        initialize: vi.fn(),
        isProviderAvailable: vi.fn().mockReturnValue(false)
      } as unknown as LLMManager;

      const result = await handleSummarizeTool(
        { text: 'Test text to summarize' },
        manager
      );

      // Bug fix: Should return text-only content, not type: "json"
      expect(result.content).toHaveLength(1);
      const firstContent = result.content[0]!;
      expect(firstContent.type).toBe('text');
      expect('text' in firstContent && firstContent.text).toContain('Summarization failed');
      expect('text' in firstContent && firstContent.text).toContain('not available');
      expect('text' in firstContent && firstContent.text).toContain('summarize');
    });

    it('returns MCP-compliant text error when chat tool provider fails', async () => {
      const completeMock = vi.fn() as MockFunction<LLMManager['complete']>;
      completeMock.mockRejectedValue(new Error('LLM request failed: Provider error'));

      const manager = {
        getProviderForTool: vi.fn().mockReturnValue({ provider: 'claude', model: 'claude-3-haiku-20240307' }),
        getAvailableProviders: vi.fn().mockReturnValue(['claude']),
        complete: completeMock,
        clearCache: vi.fn(),
        getCacheStats: vi.fn(),
        initialize: vi.fn(),
        isProviderAvailable: vi.fn().mockReturnValue(true)
      } as unknown as LLMManager;

      const result = await handleChatTool({ message: 'test' }, manager);

      expect(result.content).toHaveLength(1);
      const firstContent = result.content[0]!;
      expect(firstContent.type).toBe('text');
      expect('text' in firstContent && firstContent.text).toContain('Chat failed');
      expect('text' in firstContent && firstContent.text).toContain('chat');
    });

    it('returns MCP-compliant text error when analyze tool provider fails', async () => {
      const completeMock = vi.fn() as MockFunction<LLMManager['complete']>;
      completeMock.mockRejectedValue(new Error('LLM request failed: Provider error'));

      const manager = {
        getProviderForTool: vi.fn().mockReturnValue({ provider: 'openai', model: 'gpt-4' }),
        getAvailableProviders: vi.fn().mockReturnValue(['openai']),
        complete: completeMock,
        clearCache: vi.fn(),
        getCacheStats: vi.fn(),
        initialize: vi.fn(),
        isProviderAvailable: vi.fn().mockReturnValue(true)
      } as unknown as LLMManager;

      const result = await handleAnalyzeTool({ text: 'test' }, manager);

      expect(result.content).toHaveLength(1);
      const firstContent = result.content[0]!;
      expect(firstContent.type).toBe('text');
      expect('text' in firstContent && firstContent.text).toContain('Analysis failed');
      expect('text' in firstContent && firstContent.text).toContain('analyze');
    });

    it('returns MCP-compliant text error when explain tool provider fails', async () => {
      const completeMock = vi.fn() as MockFunction<LLMManager['complete']>;
      completeMock.mockRejectedValue(new Error('LLM request failed: Provider error'));

      const manager = {
        getProviderForTool: vi.fn().mockReturnValue({ provider: 'claude', model: 'claude-3-haiku-20240307' }),
        getAvailableProviders: vi.fn().mockReturnValue(['claude']),
        complete: completeMock,
        clearCache: vi.fn(),
        getCacheStats: vi.fn(),
        initialize: vi.fn(),
        isProviderAvailable: vi.fn().mockReturnValue(true)
      } as unknown as LLMManager;

      const result = await handleExplainTool({ topic: 'test' }, manager);

      expect(result.content).toHaveLength(1);
      const firstContent = result.content[0]!;
      expect(firstContent.type).toBe('text');
      expect('text' in firstContent && firstContent.text).toContain('Explanation failed');
      expect('text' in firstContent && firstContent.text).toContain('explain');
    });
  });
});
