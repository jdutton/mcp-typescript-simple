import { jest } from '@jest/globals';
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
    const completeMock = jest.fn();

    const manager = {
      getProviderForTool: jest.fn().mockReturnValue(defaults),
      getAvailableProviders: jest.fn().mockReturnValue([defaults.provider]),
      complete: completeMock,
      clearCache: jest.fn(),
      getCacheStats: jest.fn(),
      initialize: jest.fn(),
      isProviderAvailable: jest.fn().mockReturnValue(true)
    } as unknown as LLMManager;

    return { manager, completeMock };
  };

  const extractJsonError = (result: ToolResponse) =>
    result.content.find(item => item.type === 'json') as { json: { error: { tool: string; message: string } } } | undefined;

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
      defaults: { provider: 'gemini', model: 'gemini-1.5-flash' },
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

    const jsonError = extractJsonError(result);
    expect(jsonError).toBeDefined();
    expect(jsonError?.json.error.tool).toBe(tool);
    expect(jsonError?.json.error.message).toContain('not valid');
    expect(completeMock).not.toHaveBeenCalled();
  });
});
