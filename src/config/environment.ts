/**
 * Environment configuration for dual-mode MCP server
 */

import { z } from 'zod';

export enum TransportMode {
  STDIO = 'stdio',
  SSE = 'sse',
  STREAMABLE_HTTP = 'streamable_http'
}

export const EnvironmentSchema = z.object({
  // Transport configuration
  MCP_MODE: z.enum(['stdio', 'sse', 'streamable_http']).default('stdio'),
  MCP_DEV_SKIP_AUTH: z.boolean().default(false),

  // HTTP server configuration
  HTTP_PORT: z.number().int().min(1).max(65535).default(3000),
  HTTP_HOST: z.string().default('localhost'),

  // OAuth provider configuration
  OAUTH_PROVIDER: z.enum(['google', 'github', 'microsoft', 'generic']).default('google'),

  // Google OAuth configuration
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),

  // GitHub OAuth configuration
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GITHUB_REDIRECT_URI: z.string().url().optional(),

  // Microsoft OAuth configuration
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_REDIRECT_URI: z.string().url().optional(),
  MICROSOFT_TENANT_ID: z.string().optional(),

  // Generic OAuth configuration
  OAUTH_CLIENT_ID: z.string().optional(),
  OAUTH_CLIENT_SECRET: z.string().optional(),
  OAUTH_REDIRECT_URI: z.string().url().optional(),
  OAUTH_AUTHORIZATION_URL: z.string().url().optional(),
  OAUTH_TOKEN_URL: z.string().url().optional(),
  OAUTH_USER_INFO_URL: z.string().url().optional(),
  OAUTH_REVOCATION_URL: z.string().url().optional(),
  OAUTH_PROVIDER_NAME: z.string().optional(),
  OAUTH_SCOPES: z.string().optional(),

  // Security configuration
  REQUIRE_HTTPS: z.boolean().default(false),
  ALLOWED_ORIGINS: z.string().optional(),
  ALLOWED_HOSTS: z.string().optional(),
  SESSION_SECRET: z.string().default('dev-session-secret-change-in-production'),

  // Development overrides
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

export class EnvironmentConfig {
  private static _instance: Environment | null = null;

  static load(): Environment {
    if (this._instance) {
      return this._instance;
    }

    // Parse environment variables with type conversion
    const env = {
      MCP_MODE: process.env.MCP_MODE || 'stdio',
      MCP_DEV_SKIP_AUTH: process.env.MCP_DEV_SKIP_AUTH === 'true',
      HTTP_PORT: parseInt(process.env.HTTP_PORT || '3000', 10),
      HTTP_HOST: process.env.HTTP_HOST || 'localhost',

      // OAuth provider selection
      OAUTH_PROVIDER: process.env.OAUTH_PROVIDER || 'google',

      // Google OAuth
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,

      // GitHub OAuth
      GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
      GITHUB_REDIRECT_URI: process.env.GITHUB_REDIRECT_URI,

      // Microsoft OAuth
      MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
      MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
      MICROSOFT_REDIRECT_URI: process.env.MICROSOFT_REDIRECT_URI,
      MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID,

      // Generic OAuth
      OAUTH_CLIENT_ID: process.env.OAUTH_CLIENT_ID,
      OAUTH_CLIENT_SECRET: process.env.OAUTH_CLIENT_SECRET,
      OAUTH_REDIRECT_URI: process.env.OAUTH_REDIRECT_URI,
      OAUTH_AUTHORIZATION_URL: process.env.OAUTH_AUTHORIZATION_URL,
      OAUTH_TOKEN_URL: process.env.OAUTH_TOKEN_URL,
      OAUTH_USER_INFO_URL: process.env.OAUTH_USER_INFO_URL,
      OAUTH_REVOCATION_URL: process.env.OAUTH_REVOCATION_URL,
      OAUTH_PROVIDER_NAME: process.env.OAUTH_PROVIDER_NAME,
      OAUTH_SCOPES: process.env.OAUTH_SCOPES,

      // Security
      REQUIRE_HTTPS: process.env.REQUIRE_HTTPS === 'true',
      ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
      ALLOWED_HOSTS: process.env.ALLOWED_HOSTS,
      SESSION_SECRET: process.env.SESSION_SECRET || 'dev-session-secret-change-in-production',
      NODE_ENV: process.env.NODE_ENV || 'development',
    };

    try {
      this._instance = EnvironmentSchema.parse(env);
      return this._instance;
    } catch (error) {
      console.error('❌ Environment configuration validation failed:', error);
      throw new Error('Invalid environment configuration');
    }
  }

  static get(): Environment {
    return this.load();
  }

  static reset(): void {
    this._instance = null;
  }

  static isProduction(): boolean {
    return this.get().NODE_ENV === 'production';
  }

  static isDevelopment(): boolean {
    return this.get().NODE_ENV === 'development';
  }

  static getTransportMode(): TransportMode {
    const mode = this.get().MCP_MODE;
    switch (mode) {
      case 'sse':
        return TransportMode.SSE;
      case 'streamable_http':
        return TransportMode.STREAMABLE_HTTP;
      default:
        return TransportMode.STDIO;
    }
  }

  static shouldSkipAuth(): boolean {
    return this.get().MCP_DEV_SKIP_AUTH || this.isDevelopment();
  }


  static getSecurityConfig() {
    const env = this.get();

    return {
      requireHttps: env.REQUIRE_HTTPS || this.isProduction(),
      allowedOrigins: env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',') : undefined,
      allowedHosts: env.ALLOWED_HOSTS ? env.ALLOWED_HOSTS.split(',') : undefined,
      sessionSecret: env.SESSION_SECRET,
    };
  }

  static getServerConfig() {
    const env = this.get();

    return {
      port: env.HTTP_PORT,
      host: env.HTTP_HOST,
      mode: this.getTransportMode(),
    };
  }
}