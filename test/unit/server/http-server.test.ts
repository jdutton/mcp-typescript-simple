import { MCPHttpServer } from '../../../src/server/http-server.js';
import { EnvironmentConfig } from '../../../src/config/environment.js';
import { OAuthProviderFactory } from '../../../src/auth/factory.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

describe('MCPHttpServer', () => {
  const originalSecurityConfig = EnvironmentConfig.getSecurityConfig;
  const originalIsDevelopment = EnvironmentConfig.isDevelopment;
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

  afterEach(() => {
    jest.restoreAllMocks();
    EnvironmentConfig.getSecurityConfig = originalSecurityConfig;
    EnvironmentConfig.isDevelopment = originalIsDevelopment;
  });

  const makeServer = (options?: Partial<ConstructorParameters<typeof MCPHttpServer>[0]>) =>
    new MCPHttpServer({
      port: 8080,
      host: '127.0.0.1',
      endpoint: '/sse',
      requireAuth: false,
      sessionSecret: 'secret',
      ...options
    });

  it('stops server when close is available', async () => {
    const server = makeServer();
    const close = jest.fn((cb) => { cb?.(); return undefined; });
    (server as any).server = {
      close,
      on: jest.fn()
    };

    await expect(server.stop()).resolves.toBeUndefined();
    expect(close).toHaveBeenCalled();
  });

  it('registers SSE connection handler', async () => {
    const server = makeServer();
    const handler = jest.fn().mockResolvedValue(undefined);
    server.onSSEConnection(handler);

    const transport = {} as unknown as SSEServerTransport;
    await (server as any).sseConnectionHandler(transport);
    expect(handler).toHaveBeenCalledWith(transport);
  });

  it('invokes OAuth provider factory when auth required', () => {
    makeServer({ requireAuth: true });
    expect(OAuthProviderFactory.createFromEnvironment).toHaveBeenCalled();
  });
});
