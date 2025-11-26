import { vi } from 'vitest';

import { TransportFactory, StdioTransportManager, StreamableHTTPTransportManager } from '../../src/transport/factory.js';
import { EnvironmentConfig, TransportMode } from '@mcp-typescript-simple/config';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { logger } from '@mcp-typescript-simple/observability';

describe('TransportFactory', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates stdio transport when mode is STDIO', () => {
    vi.spyOn(EnvironmentConfig, 'getTransportMode').mockReturnValue(TransportMode.STDIO);
    const serverConfigSpy = vi.spyOn(EnvironmentConfig, 'getServerConfig');
    const securityConfigSpy = vi.spyOn(EnvironmentConfig, 'getSecurityConfig');
    const skipAuthSpy = vi.spyOn(EnvironmentConfig, 'shouldSkipAuth');

    const transport = TransportFactory.createFromEnvironment();

    expect(transport).toBeInstanceOf(StdioTransportManager);
    expect(serverConfigSpy).not.toHaveBeenCalled();
    expect(securityConfigSpy).not.toHaveBeenCalled();
    expect(skipAuthSpy).not.toHaveBeenCalled();
  });


  it('creates streamable HTTP transport with resumability enabled', () => {
    vi.spyOn(EnvironmentConfig, 'getTransportMode').mockReturnValue(TransportMode.STREAMABLE_HTTP);
    vi.spyOn(EnvironmentConfig, 'getServerConfig').mockReturnValue({ port: 3000, host: 'localhost', mode: TransportMode.STREAMABLE_HTTP });
    vi.spyOn(EnvironmentConfig, 'getSecurityConfig').mockReturnValue({ allowedOrigins: undefined, allowedHosts: undefined, sessionSecret: 'secret', requireHttps: false });
    vi.spyOn(EnvironmentConfig, 'shouldSkipAuth').mockReturnValue(true);

    const transport = TransportFactory.createFromEnvironment();

    expect(transport).toBeInstanceOf(StreamableHTTPTransportManager);
    expect(EnvironmentConfig.getServerConfig).toHaveBeenCalled();
    expect(EnvironmentConfig.getSecurityConfig).toHaveBeenCalled();
  });


  it('propagates errors when Streamable HTTP transports fail to close', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const manager = new StreamableHTTPTransportManager({
      port: 3000,
      host: 'localhost',
      endpoint: '/stream',
      requireAuth: false,
      allowedOrigins: [],
      allowedHosts: [],
      sessionSecret: 'secret',
      enableResumability: false,
      enableJsonResponse: false
    });

    const failingTransport = {
      close: vi.fn<() => Promise<void>>().mockRejectedValue(new Error('close failed')),
      sessionId: 'session'
    } as unknown as StreamableHTTPServerTransport;

    (manager as unknown as { streamableTransports: Map<string, StreamableHTTPServerTransport> }).streamableTransports = new Map([
      ['session', failingTransport]
    ]);

    const stopSpy = vi.fn<() => Promise<void>>().mockResolvedValue();
    (manager as unknown as { httpServer?: { stop: () => Promise<void> } }).httpServer = { stop: stopSpy } as any;

    const stopPromise = manager.stop();
    await expect(stopPromise).rejects.toThrow('Failed to shut down Streamable HTTP transport manager');
    expect(stopSpy).toHaveBeenCalled();
  });

  describe('TransportFactory direct usage', () => {
    let factory: TransportFactory;

    beforeEach(() => {
      factory = new TransportFactory();
    });

    it('creates stdio transport directly', () => {
      const transport = factory.createTransport(TransportMode.STDIO, {});
      expect(transport).toBeInstanceOf(StdioTransportManager);
    });

    it('creates streamable HTTP transport directly', () => {
      const options = {
        port: 3001,
        host: 'test.example.com',
        endpoint: '/test-mcp',
        requireAuth: true,
        allowedOrigins: ['http://example.com'],
        allowedHosts: ['example.com'],
        sessionSecret: 'test-secret',
        enableResumability: true,
        enableJsonResponse: true
      };

      const transport = factory.createTransport(TransportMode.STREAMABLE_HTTP, options);
      expect(transport).toBeInstanceOf(StreamableHTTPTransportManager);
    });

    it('throws error for unsupported transport mode', () => {
      expect(() => {
        factory.createTransport('invalid-mode' as TransportMode, {});
      }).toThrow('Unsupported transport mode: invalid-mode');
    });
  });

  describe('StdioTransportManager', () => {
    let manager: StdioTransportManager;
    let mockServer: any;
    let mockTransport: any;

    beforeEach(() => {
      manager = new StdioTransportManager({});

      mockServer = {
        connect: vi.fn<() => Promise<void>>().mockResolvedValue()
      };

      mockTransport = {
        close: vi.fn<() => Promise<void>>().mockResolvedValue()
      };

      // Mock the StdioServerTransport constructor
      vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: vi.fn(() => mockTransport)
      }));
    });

    it('initializes with server', async () => {
      await manager.initialize(mockServer);

      // Access private properties to verify initialization
      expect((manager as any).server).toBe(mockServer);
      expect((manager as any).transport).toBeDefined();
    });

    it('starts successfully after initialization', async () => {
      const loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});

      await manager.initialize(mockServer);
      await manager.start();

      expect(mockServer.connect).toHaveBeenCalled();
      expect(loggerInfoSpy).toHaveBeenCalledWith('MCP TypeScript Simple server running on stdio');

      loggerInfoSpy.mockRestore();
    });

    it('throws error when starting without initialization', async () => {
      await expect(manager.start()).rejects.toThrow('Transport not initialized');
    });

    it('stops transport gracefully', async () => {
      await manager.initialize(mockServer);

      // Manually set the transport since the real constructor won't be called in tests
      (manager as any).transport = mockTransport;

      await manager.stop();

      expect(mockTransport.close).toHaveBeenCalled();
    });

    it('handles stop when transport is not initialized', async () => {
      // Should not throw error
      await expect(manager.stop()).resolves.not.toThrow();
    });

    it('returns correct info', () => {
      expect(manager.getInfo()).toBe('Standard Input/Output (stdio)');
    });

    it('returns correct mode', () => {
      expect(manager.getMode()).toBe(TransportMode.STDIO);
    });
  });

  describe('StreamableHTTPTransportManager', () => {
    let manager: StreamableHTTPTransportManager;
    let mockServer: any;
    let mockHttpServer: any;

    beforeEach(() => {
      const options = {
        port: 3002,
        host: 'localhost',
        endpoint: '/mcp-test',
        requireAuth: false,
        allowedOrigins: ['*'],
        allowedHosts: ['localhost'],
        sessionSecret: 'test-session-secret',
        enableResumability: true,
        enableJsonResponse: false
      };

      manager = new StreamableHTTPTransportManager(options);

      mockServer = {
        connect: vi.fn<() => Promise<void>>().mockResolvedValue()
      };

      mockHttpServer = {
        initialize: vi.fn<() => Promise<void>>().mockResolvedValue(),
        start: vi.fn<() => Promise<void>>().mockResolvedValue(),
        stop: vi.fn<() => Promise<void>>().mockResolvedValue(),
        onStreamableHTTPTransport: vi.fn()
      };
    });

    it('returns correct info with auth disabled', () => {
      const expectedInfo = 'Streamable HTTP on localhost:3002 (dev mode) (resumability)';
      expect(manager.getInfo()).toBe(expectedInfo);
    });

    it('returns correct info with auth enabled and all features', () => {
      const authManager = new StreamableHTTPTransportManager({
        port: 443,
        host: 'secure.example.com',
        endpoint: '/secure-mcp',
        requireAuth: true,
        allowedOrigins: [],
        allowedHosts: [],
        sessionSecret: 'secure-secret',
        enableResumability: true,
        enableJsonResponse: true
      });

      const expectedInfo = 'Streamable HTTP on secure.example.com:443 (with OAuth) (resumability, JSON responses)';
      expect(authManager.getInfo()).toBe(expectedInfo);
    });

    it('returns correct mode', () => {
      expect(manager.getMode()).toBe(TransportMode.STREAMABLE_HTTP);
    });

    it('returns connection count', () => {
      expect(manager.getConnectionCount()).toBe(0);
    });

    it('returns connected sessions', () => {
      expect(manager.getConnectedSessions()).toEqual([]);
    });

    it('returns http server instance', () => {
      expect(manager.getHttpServer()).toBeUndefined();

      // Set a mock HTTP server
      (manager as any).httpServer = mockHttpServer;
      expect(manager.getHttpServer()).toBe(mockHttpServer);
    });
  });

  describe('Static methods', () => {
    it('gets transport mode from environment', () => {
      const mockMode = TransportMode.STREAMABLE_HTTP;
      vi.spyOn(EnvironmentConfig, 'getTransportMode').mockReturnValue(mockMode);

      expect(TransportFactory.getTransportMode()).toBe(mockMode);
    });

    it('throws error for unsupported mode in createFromEnvironment', () => {
      vi.spyOn(EnvironmentConfig, 'getTransportMode').mockReturnValue('invalid-mode' as TransportMode);

      expect(() => {
        TransportFactory.createFromEnvironment();
      }).toThrow('Unsupported transport mode: invalid-mode');
    });
  });
});
