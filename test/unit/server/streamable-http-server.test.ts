import { MCPStreamableHttpServer } from '../../../src/server/streamable-http-server.js';
import { EnvironmentConfig } from '../../../src/config/environment.js';
import { OAuthProviderFactory } from '../../../src/auth/factory.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import request from 'supertest';

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
        handleLogout: jest.fn(),
        verifyAccessToken: jest.fn().mockRejectedValue(new Error('Invalid or missing token'))
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

  it('logs accept header when present', async () => {
    const server = makeServer();
    await server.initialize();
    const app = server.getApp();

    const consoleSpy = jest.spyOn(console, 'log');

    await request(app)
      .get('/health')
      .set('Accept', 'application/json')
      .expect(200);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/Accept: application\/json/));
  });

  it('logs large request body with truncation', async () => {
    const server = makeServer({ endpoint: '/mcp' });
    await server.initialize();
    const app = server.getApp();

    const consoleSpy = jest.spyOn(console, 'log');
    const largeBody = { data: 'x'.repeat(2000) }; // Large body over 1000 chars

    await request(app)
      .post('/mcp')
      .send(largeBody); // Don't care about status, just that it logs

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/Request Body:.*truncated/));
  });

  it('logs small request body without truncation', async () => {
    const server = makeServer({ endpoint: '/mcp' });
    await server.initialize();
    const app = server.getApp();

    const consoleSpy = jest.spyOn(console, 'log');
    const smallBody = { data: 'small' };

    await request(app)
      .post('/mcp')
      .send(smallBody); // Don't care about status, just that it logs

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/Request Body:.*"data":"small"/));
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringMatching(/truncated/));
  });

  it('tests specific server configuration options', async () => {
    // Test server with different middleware paths
    const server = makeServer({
      endpoint: '/custom-mcp',
      enableResumability: true,
      enableJsonResponse: true
    });
    await server.initialize();
    const app = server.getApp();

    const consoleSpy = jest.spyOn(console, 'log');

    // Test a request that will go through different code paths
    await request(app)
      .get('/health')
      .set('User-Agent', 'Test Agent');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/User-Agent: Test Agent/));
  });

  it('returns 401 when MCP endpoint requires auth but no token provided', async () => {
    const server = makeServer({
      endpoint: '/mcp',
      requireAuth: true
    });

    await server.initialize();
    const app = server.getApp();

    const response = await request(app)
      .post('/mcp')
      .send({ test: 'data' });

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBeDefined();
    expect(response.body).toMatchObject({
      error: expect.any(String)
    });
  });

  it('returns 503 when MCP endpoint does not require auth but no handler available', async () => {
    const server = makeServer({
      endpoint: '/mcp',
      requireAuth: false
    });
    await server.initialize();
    const app = server.getApp();

    const response = await request(app)
      .post('/mcp')
      .send({ test: 'data' });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      error: 'Service temporarily unavailable',
      message: 'MCP server handler not initialized'
    });
  });
});
