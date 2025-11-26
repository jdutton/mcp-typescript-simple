import { vi } from 'vitest';

const baseSigintListeners = [...process.listeners('SIGINT')];
const baseSigtermListeners = [...process.listeners('SIGTERM')];

describe('MCP server bootstrap', () => {
  afterEach(() => {
    delete process.env.MCP_MODE;
    delete process.env.NODE_ENV;

    vi.restoreAllMocks();

    process.removeAllListeners('SIGINT');
    for (const listener of baseSigintListeners) {
      process.on('SIGINT', listener);
    }

    process.removeAllListeners('SIGTERM');
    for (const listener of baseSigtermListeners) {
      process.on('SIGTERM', listener);
    }
  });

  test('initializes server and transport stack during bootstrap', async () => {
    process.env.MCP_MODE = 'stdio';
    process.env.NODE_ENV = 'test';

    const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
    const serverSetRequestHandlerSpy = vi.spyOn(Server.prototype, 'setRequestHandler');

    const typesModule = await import('@modelcontextprotocol/sdk/types.js');

    const envModule = await import('@mcp-typescript-simple/config');
    const transportMode = envModule.TransportMode.STDIO;
    const getSpy = vi.spyOn(envModule.EnvironmentConfig, 'get').mockReturnValue({ NODE_ENV: 'test' } as any);
    const getTransportModeSpy = vi.spyOn(envModule.EnvironmentConfig, 'getTransportMode').mockReturnValue(transportMode);

    let startResolve!: () => void;
    const startCalled = new Promise<void>((resolve) => {
      startResolve = resolve;
    });

    let capturedServer: unknown;
    const transportInitialize = vi.fn(async (server: unknown) => {
      capturedServer = server;
    });
    const transportStart = vi.fn(async () => {
      startResolve();
    });
    const transportStop = vi.fn(async () => {});
    const transportGetInfo = vi.fn(() => 'stdio');

    const transportManager = {
      initialize: transportInitialize,
      start: transportStart,
      stop: transportStop,
      getInfo: transportGetInfo,
    };

    const transportModule = await import('@mcp-typescript-simple/http-server');
    const createTransportSpy = vi.spyOn(transportModule.TransportFactory, 'createFromEnvironment').mockReturnValue(transportManager as any);

    // Mock package imports
    const llmModule = await import('@mcp-typescript-simple/tools-llm');
    const initializeSpy = vi.spyOn(llmModule.LLMManager.prototype, 'initialize').mockResolvedValue();

    const setupModule = await import('@mcp-typescript-simple/server');
    const setupMCPServerSpy = vi.spyOn(setupModule, 'setupMCPServerWithRegistry').mockResolvedValue();

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit called with ${code}`);
    }) as typeof process.exit);

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await import('../src/index.js');
    await startCalled;
    await new Promise((resolve) => setImmediate(resolve));

    const serverInstance = capturedServer ?? serverSetRequestHandlerSpy.mock.instances[0];
    expect(serverInstance).toBeDefined();

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getTransportModeSpy).toHaveBeenCalledTimes(1);
    expect(initializeSpy).toHaveBeenCalledTimes(1);
    // New architecture: setupMCPServerWithRegistry is called with server, ToolRegistry, and logger
    expect(setupMCPServerSpy).toHaveBeenCalledWith(serverInstance, expect.anything(), expect.anything());
    expect(createTransportSpy).toHaveBeenCalledTimes(1);
    // New architecture: transport.initialize receives server and toolRegistry
    expect(transportInitialize).toHaveBeenCalledWith(serverInstance, expect.anything());
    expect(transportStart).toHaveBeenCalledTimes(1);
    expect(transportGetInfo).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
