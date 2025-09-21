import { jest } from '@jest/globals';
import { TransportFactory, StdioTransportManager, SSETransportManager, StreamableHTTPTransportManager } from '../../../src/transport/factory.js';
import { EnvironmentConfig, TransportMode } from '../../../src/config/environment.js';

describe('TransportFactory', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates stdio transport when mode is STDIO', () => {
    jest.spyOn(EnvironmentConfig, 'getTransportMode').mockReturnValue(TransportMode.STDIO);
    const serverConfigSpy = jest.spyOn(EnvironmentConfig, 'getServerConfig');
    const securityConfigSpy = jest.spyOn(EnvironmentConfig, 'getSecurityConfig');
    const skipAuthSpy = jest.spyOn(EnvironmentConfig, 'shouldSkipAuth');

    const transport = TransportFactory.createFromEnvironment();

    expect(transport).toBeInstanceOf(StdioTransportManager);
    expect(serverConfigSpy).not.toHaveBeenCalled();
    expect(securityConfigSpy).not.toHaveBeenCalled();
    expect(skipAuthSpy).not.toHaveBeenCalled();
  });

  it('creates SSE transport with server and security config', () => {
    jest.spyOn(EnvironmentConfig, 'getTransportMode').mockReturnValue(TransportMode.SSE);
    jest.spyOn(EnvironmentConfig, 'getServerConfig').mockReturnValue({ port: 4000, host: '0.0.0.0', mode: TransportMode.SSE });
    jest.spyOn(EnvironmentConfig, 'getSecurityConfig').mockReturnValue({ allowedOrigins: ['https://example.com'], allowedHosts: ['example.com'], sessionSecret: 'secret', requireHttps: true });
    jest.spyOn(EnvironmentConfig, 'shouldSkipAuth').mockReturnValue(false);

    const transport = TransportFactory.createFromEnvironment();

    expect(transport).toBeInstanceOf(SSETransportManager);
    expect(EnvironmentConfig.getServerConfig).toHaveBeenCalled();
    expect(EnvironmentConfig.getSecurityConfig).toHaveBeenCalled();
    expect(EnvironmentConfig.shouldSkipAuth).toHaveBeenCalled();
  });

  it('creates streamable HTTP transport with resumability enabled', () => {
    jest.spyOn(EnvironmentConfig, 'getTransportMode').mockReturnValue(TransportMode.STREAMABLE_HTTP);
    jest.spyOn(EnvironmentConfig, 'getServerConfig').mockReturnValue({ port: 3000, host: 'localhost', mode: TransportMode.STREAMABLE_HTTP });
    jest.spyOn(EnvironmentConfig, 'getSecurityConfig').mockReturnValue({ allowedOrigins: undefined, allowedHosts: undefined, sessionSecret: 'secret', requireHttps: false });
    jest.spyOn(EnvironmentConfig, 'shouldSkipAuth').mockReturnValue(true);

    const transport = TransportFactory.createFromEnvironment();

    expect(transport).toBeInstanceOf(StreamableHTTPTransportManager);
    expect(EnvironmentConfig.getServerConfig).toHaveBeenCalled();
    expect(EnvironmentConfig.getSecurityConfig).toHaveBeenCalled();
  });
});
