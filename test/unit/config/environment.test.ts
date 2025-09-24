import { EnvironmentConfig, TransportMode, ConfigurationStatus } from '../../../src/config/environment.js';

describe('EnvironmentConfig', () => {
  const managedKeys = [
    'MCP_MODE',
    'MCP_DEV_SKIP_AUTH',
    'HTTP_PORT',
    'HTTP_HOST',
    'REQUIRE_HTTPS',
    'ALLOWED_ORIGINS',
    'ALLOWED_HOSTS',
    'SESSION_SECRET',
    'NODE_ENV',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'GOOGLE_API_KEY',
  ];

  const originalValues: Record<string, string | undefined> = {};

  const restore = () => {
    EnvironmentConfig.reset();
    for (const key of managedKeys) {
      const value = originalValues[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  beforeAll(() => {
    for (const key of managedKeys) {
      originalValues[key] = process.env[key];
    }
  });

  beforeEach(() => {
    restore();
  });

  afterAll(() => {
    restore();
  });

  test('applies sensible defaults when environment variables are absent', () => {
    for (const key of managedKeys) {
      delete process.env[key];
    }
    EnvironmentConfig.reset();

    const config = EnvironmentConfig.get();

    expect(config.MCP_MODE).toBe('stdio');
    expect(config.MCP_DEV_SKIP_AUTH).toBe(false);
    expect(config.HTTP_PORT).toBe(3000);
    expect(config.HTTP_HOST).toBe('localhost');
    expect(config.NODE_ENV).toBe('development');

    expect(EnvironmentConfig.getTransportMode()).toBe(TransportMode.STDIO);
    expect(EnvironmentConfig.shouldSkipAuth()).toBe(false); // MCP_DEV_SKIP_AUTH defaults to false

    const security = EnvironmentConfig.getSecurityConfig();
    expect(security.requireHttps).toBe(false);
    expect(security.allowedOrigins).toBeUndefined();
    expect(security.allowedHosts).toBeUndefined();
    expect(security.sessionSecret).toBe('dev-session-secret-change-in-production');
  });

  test('parses provided environment variables into strongly typed configuration', () => {
    process.env.MCP_MODE = 'streamable_http';
    process.env.MCP_DEV_SKIP_AUTH = 'false';
    process.env.HTTP_PORT = '4100';
    process.env.HTTP_HOST = '0.0.0.0';
    process.env.REQUIRE_HTTPS = 'true';
    process.env.ALLOWED_ORIGINS = 'https://one.example,https://two.example';
    process.env.ALLOWED_HOSTS = 'one.example,two.example';
    process.env.SESSION_SECRET = 'super-secret';
    process.env.NODE_ENV = 'production';

    EnvironmentConfig.reset();

    const config = EnvironmentConfig.get();
    expect(config.MCP_MODE).toBe('streamable_http');
    expect(config.MCP_DEV_SKIP_AUTH).toBe(false);
    expect(config.HTTP_PORT).toBe(4100);
    expect(config.HTTP_HOST).toBe('0.0.0.0');
    expect(EnvironmentConfig.isProduction()).toBe(true);
    expect(EnvironmentConfig.shouldSkipAuth()).toBe(false);

    const serverConfig = EnvironmentConfig.getServerConfig();
    expect(serverConfig.port).toBe(4100);
    expect(serverConfig.host).toBe('0.0.0.0');
    expect(serverConfig.mode).toBe(TransportMode.STREAMABLE_HTTP);

    const security = EnvironmentConfig.getSecurityConfig();
    expect(security.requireHttps).toBe(true);
    expect(security.allowedOrigins).toEqual([
      'https://one.example',
      'https://two.example'
    ]);
    expect(security.allowedHosts).toEqual([
      'one.example',
      'two.example'
    ]);
    expect(security.sessionSecret).toBe('super-secret');
  });

  describe('Secret Status Reporting', () => {
    it('correctly identifies configured OAuth secrets', () => {
      const originalEnv = { ...process.env };

      // Set Google OAuth credentials
      process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
      process.env.OAUTH_PROVIDER = 'google';

      // Reset the singleton to force reload
      EnvironmentConfig.reset();

      const status = EnvironmentConfig.getConfigurationStatus();

      // Should correctly identify Google OAuth credentials as configured
      expect(status.secrets.configured).toContain('GOOGLE_CLIENT_ID');
      expect(status.secrets.configured).toContain('GOOGLE_CLIENT_SECRET');
      expect(status.secrets.missing).not.toContain('GOOGLE_CLIENT_ID');
      expect(status.secrets.missing).not.toContain('GOOGLE_CLIENT_SECRET');

      // Restore original environment
      process.env = originalEnv;
      EnvironmentConfig.reset();
    });

    it('correctly identifies missing OAuth secrets', () => {
      const originalEnv = { ...process.env };

      // Clear OAuth credentials
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;

      // Reset the singleton to force reload
      EnvironmentConfig.reset();

      const status = EnvironmentConfig.getConfigurationStatus();

      // Should correctly identify Google OAuth credentials as missing
      expect(status.secrets.configured).not.toContain('GOOGLE_CLIENT_ID');
      expect(status.secrets.configured).not.toContain('GOOGLE_CLIENT_SECRET');
      expect(status.secrets.missing).toContain('GOOGLE_CLIENT_ID');
      expect(status.secrets.missing).toContain('GOOGLE_CLIENT_SECRET');

      // Restore original environment
      process.env = originalEnv;
      EnvironmentConfig.reset();
    });

    it('correctly reports SESSION_SECRET as missing only when using default value', () => {
      const originalEnv = { ...process.env };

      // Test with default value - should be missing
      delete process.env.SESSION_SECRET;
      EnvironmentConfig.reset();
      let status = EnvironmentConfig.getConfigurationStatus();
      expect(status.secrets.missing).toContain('SESSION_SECRET');
      expect(status.secrets.configured).not.toContain('SESSION_SECRET');

      // Test with custom value - should be configured
      process.env.SESSION_SECRET = 'my-custom-secret';
      EnvironmentConfig.reset();
      status = EnvironmentConfig.getConfigurationStatus();
      expect(status.secrets.configured).toContain('SESSION_SECRET');
      expect(status.secrets.missing).not.toContain('SESSION_SECRET');

      // Restore original environment
      process.env = originalEnv;
      EnvironmentConfig.reset();
    });
  });
});
