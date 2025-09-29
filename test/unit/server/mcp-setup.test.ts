import { jest } from '@jest/globals';
import { setupMCPServer } from '../../../src/server/mcp-setup.js';
import { logger } from '../../../src/utils/logger.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

jest.mock('../../../src/tools/llm/chat.js', () => {
  const parseChatToolInput = jest.fn(() => ({ message: 'hello' }));
  return {
    handleChatTool: jest.fn(async () => ({ content: [{ type: 'text', text: 'chat' }] })),
    parseChatToolInput
  };
});

jest.mock('../../../src/tools/llm/analyze.js', () => {
  const parseAnalyzeToolInput = jest.fn(() => ({ text: 'analyze this' }));
  return {
    handleAnalyzeTool: jest.fn(async () => ({ content: [{ type: 'text', text: 'analyze' }] })),
    parseAnalyzeToolInput
  };
});

jest.mock('../../../src/tools/llm/summarize.js', () => {
  const parseSummarizeToolInput = jest.fn(() => ({ text: 'summarize this' }));
  return {
    handleSummarizeTool: jest.fn(async () => ({ content: [{ type: 'text', text: 'summarize' }] })),
    parseSummarizeToolInput
  };
});

jest.mock('../../../src/tools/llm/explain.js', () => {
  const parseExplainToolInput = jest.fn(() => ({ topic: 'explain this' }));
  return {
    handleExplainTool: jest.fn(async () => ({ content: [{ type: 'text', text: 'explain' }] })),
    parseExplainToolInput
  };
});

describe('setupMCPServer', () => {
  const createServer = () => {
    return {
      setRequestHandler: jest.fn()
    } as unknown as { setRequestHandler: jest.Mock };
  };

  const createLLMManager = (providers: string[]) => ({
    getAvailableProviders: jest.fn().mockReturnValue(providers),
    getProviderForTool: jest.fn().mockReturnValue({ provider: 'claude', model: 'claude-3-haiku-20240307' })
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
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

    const loggerErrorSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
    const response = await callHandler!({ params: { name: 'chat', arguments: { message: 'hello' } } });
    const { handleChatTool, parseChatToolInput } = await import('../../../src/tools/llm/chat.js');
    expect(parseChatToolInput).toHaveBeenCalledWith({ message: 'hello' });
    expect(handleChatTool).toHaveBeenCalledWith({ message: 'hello' }, llmManager);
    expect(response.content[0].text).toBe('chat');

    await expect(callHandler!({ params: { name: 'unknown', arguments: {} } })).rejects.toThrow('Unknown tool');
    expect(loggerErrorSpy).toHaveBeenCalled();
  });
});
