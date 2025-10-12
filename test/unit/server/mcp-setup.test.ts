import { vi } from 'vitest';

import { setupMCPServer } from '../../../src/server/mcp-setup.js';
import { logger } from '../../../src/utils/logger.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

vi.mock('../../../src/tools/llm/chat.js', () => {
  const parseChatToolInput = vi.fn(() => ({ message: 'hello' }));
  return {
    handleChatTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'chat' }] })),
    parseChatToolInput
  };
});

vi.mock('../../../src/tools/llm/analyze.js', () => {
  const parseAnalyzeToolInput = vi.fn(() => ({ text: 'analyze this' }));
  return {
    handleAnalyzeTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'analyze' }] })),
    parseAnalyzeToolInput
  };
});

vi.mock('../../../src/tools/llm/summarize.js', () => {
  const parseSummarizeToolInput = vi.fn(() => ({ text: 'summarize this' }));
  return {
    handleSummarizeTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'summarize' }] })),
    parseSummarizeToolInput
  };
});

vi.mock('../../../src/tools/llm/explain.js', () => {
  const parseExplainToolInput = vi.fn(() => ({ topic: 'explain this' }));
  return {
    handleExplainTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'explain' }] })),
    parseExplainToolInput
  };
});

describe('setupMCPServer', () => {
  const createServer = () => {
    return {
      setRequestHandler: vi.fn()
    } as unknown as { setRequestHandler: Mock };
  };

  const createLLMManager = (providers: string[]) => {
    const schemaInfo = {
      providers: providers.map(name => ({
        name,
        models: name === 'claude' ? ['claude-3-haiku-20240307', 'claude-3-5-haiku-20241022'] :
                name === 'openai' ? ['gpt-4', 'gpt-4o-mini'] :
                ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
      })),
      defaultProvider: 'claude'
    };

    return {
      getAvailableProviders: vi.fn().mockReturnValue(providers),
      getProviderForTool: vi.fn().mockReturnValue({ provider: 'claude', model: 'claude-3-haiku-20240307' }),
      getSchemaInfo: vi.fn(() => Promise.resolve(schemaInfo))
    };
  };

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('registers only basic tools when no LLM providers are available', async () => {
    const server = createServer();
    const llmManager = createLLMManager([]);

    await setupMCPServer(server as unknown as any, llmManager as unknown as any);

    const listHandler = server.setRequestHandler.mock.calls.find(([schema]) => schema === ListToolsRequestSchema)?.[1] as (() => Promise<any>) | undefined;
    expect(typeof listHandler).toBe('function');

    const response = await listHandler!();
    const toolNames = response.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toEqual(expect.arrayContaining(['hello', 'echo', 'current-time']));
    expect(toolNames).not.toEqual(expect.arrayContaining(['chat', 'analyze', 'summarize', 'explain']));
  });

  it('registers LLM tools when providers are available', async () => {
    const server = createServer();
    const llmManager = createLLMManager(['claude', 'openai']);

    await setupMCPServer(server as unknown as any, llmManager as unknown as any);

    const listHandler = server.setRequestHandler.mock.calls.find(([schema]) => schema === ListToolsRequestSchema)?.[1] as (() => Promise<any>) | undefined;
    const response = await listHandler!();
    const toolNames = response.tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).toEqual(expect.arrayContaining(['chat', 'analyze', 'summarize', 'explain']));
  });

  it('routes tool calls to the appropriate handlers', async () => {
    const server = createServer();
    const llmManager = createLLMManager(['claude']);

    await setupMCPServer(server as unknown as any, llmManager as unknown as any);

    const callHandler = server.setRequestHandler.mock.calls.find(([schema]) => schema === CallToolRequestSchema)?.[1] as ((req: any) => Promise<any>) | undefined;
    expect(callHandler).toBeDefined();

    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const response = await callHandler!({ params: { name: 'chat', arguments: { message: 'hello' } } });
    const { handleChatTool, parseChatToolInput } = await import('../../../src/tools/llm/chat.js');
    expect(parseChatToolInput).toHaveBeenCalledWith({ message: 'hello' });
    expect(handleChatTool).toHaveBeenCalledWith({ message: 'hello' }, llmManager);
    expect(response.content[0].text).toBe('chat');

    await expect(callHandler!({ params: { name: 'unknown', arguments: {} } })).rejects.toThrow('Unknown tool');
    expect(loggerErrorSpy).toHaveBeenCalled();
  });
});
