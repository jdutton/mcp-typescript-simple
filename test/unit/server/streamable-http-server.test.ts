import { MCPStreamableHttpServer } from '../../../src/server/streamable-http-server.js';
import { EnvironmentConfig } from '../../../src/config/environment.js';
import { OAuthProviderFactory } from '../../../src/auth/factory.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

describe('MCPStreamableHttpServer', () => {
  const originalSecurityConfig = EnvironmentConfig.getSecurityConfig;
  const originalIsDevelopment = EnvironmentConfig.isDevelopment;
  const servers: MCPStreamableHttpServer[] = [];

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    (EnvironmentConfig as any).getSecurityConfig = jest.fn().mockReturnValue({ requireHttps: false });
    (EnvironmentConfig as any).isDevelopment = jest.fn().mockReturnValue(true);
    Object.assign(OAuthProviderFactory, {
      createFromEnvironment: jest.fn().mockReturnValue({
        getEndpoints: () => ({
          authEndpoint: '/auth',
          callbackEndpoint: '/callback',
          refreshEndpoint: '/refresh',
          logoutEndpoint: '/logout'
        }),
        handleAuthorizationRequest: jest.fn(),
        handleAuthorizationCallback: jest.fn(),
        handleTokenRefresh: jest.fn(),
        handleLogout: jest.fn()
      })
    });
  });

  afterEach(async () => {
    // Clean up all servers to prevent hanging timers
    for (const server of servers) {
      try {
        // Directly call session manager destroy to clean up timers
        const sessionManager = server.getSessionManager();
        if (sessionManager) {
          sessionManager.destroy();
        }
        await server.stop();
      } catch {
        // Ignore errors during cleanup
      }
    }
    servers.length = 0;

    jest.restoreAllMocks();
    EnvironmentConfig.getSecurityConfig = originalSecurityConfig;
    EnvironmentConfig.isDevelopment = originalIsDevelopment;
  });

  const makeServer = (options?: Partial<ConstructorParameters<typeof MCPStreamableHttpServer>[0]>) => {
    const server = new MCPStreamableHttpServer({
      port: 8081,
      host: '127.0.0.1',
      endpoint: '/stream',
      requireAuth: false,
      sessionSecret: 'secret',
      enableResumability: false,
      enableJsonResponse: false,
      ...options
    });
    servers.push(server);
    return server;
  };

  it('stops the streamable server via close callback', async () => {
    const server = makeServer();
    const close = jest.fn((cb) => { cb?.(); return undefined; });
    (server as any).server = {
      close,
      on: jest.fn()
    };

    await expect(server.stop()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalled();
  });

  it('registers streamable transport handler', async () => {
    const server = makeServer();
    const handler = jest.fn().mockResolvedValue(undefined);
    server.onStreamableHTTPTransport(handler);

    const transport = {} as unknown as StreamableHTTPServerTransport;
    await (server as any).streamableTransportHandler(transport);
    expect(handler).toHaveBeenCalledWith(transport);
  });

  it('provides session manager access', () => {
    const server = makeServer({ enableResumability: true });
    const manager = server.getSessionManager();
    expect(manager).toBeDefined();
    expect(manager.getStats()).toHaveProperty('activeSessions');
  });
});
