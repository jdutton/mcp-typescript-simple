/**
 * Environment configuration for dual-mode MCP server
 */

import { z } from 'zod';

export enum TransportMode {
  STDIO = 'stdio',
  STREAMABLE_HTTP = 'streamable_http'
}

// Non-secret configuration that can be safely logged
export const ConfigurationSchema = z.object({
  // Transport configuration
  MCP_MODE: z.enum(['stdio', 'streamable_http']).default('stdio'),
  MCP_DEV_SKIP_AUTH: z.boolean().default(false),

  // HTTP server configuration
  HTTP_PORT: z.number().int().min(1).max(65535).default(3000),
  HTTP_HOST: z.string().default('localhost'),

  // OAuth provider configuration
  OAUTH_PROVIDER: z.enum(['google', 'github', 'microsoft', 'generic']).default('google'),

  // Legacy client compatibility
  MCP_LEGACY_CLIENT_SUPPORT: z.boolean().default(true),

  // OAuth redirect URIs (safe to log)
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  GITHUB_REDIRECT_URI: z.string().url().optional(),
  MICROSOFT_REDIRECT_URI: z.string().url().optional(),
  MICROSOFT_TENANT_ID: z.string().optional(),
  OAUTH_REDIRECT_URI: z.string().url().optional(),
  OAUTH_AUTHORIZATION_URL: z.string().url().optional(),
  OAUTH_TOKEN_URL: z.string().url().optional(),
  OAUTH_USER_INFO_URL: z.string().url().optional(),
  OAUTH_REVOCATION_URL: z.string().url().optional(),
  OAUTH_PROVIDER_NAME: z.string().optional(),
  OAUTH_SCOPES: z.string().optional(),

  // Security configuration (non-secret)
  REQUIRE_HTTPS: z.boolean().default(false),
  ALLOWED_ORIGINS: z.string().optional(),
  ALLOWED_HOSTS: z.string().optional(),

  // Development overrides
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

// Secret configuration that should never be logged
export const SecretsSchema = z.object({
  // Google OAuth secrets
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // GitHub OAuth secrets
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  // Microsoft OAuth secrets
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),

  // Generic OAuth secrets
  OAUTH_CLIENT_ID: z.string().optional(),
  OAUTH_CLIENT_SECRET: z.string().optional(),

  // Session secret
  SESSION_SECRET: z.string().default('dev-session-secret-change-in-production'),

  // LLM Provider API keys
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),

  // LLM configuration
  LLM_DEFAULT_PROVIDER: z.enum(['claude', 'openai', 'gemini']).optional(),
});

// Combined schema for backward compatibility
export const EnvironmentSchema = ConfigurationSchema.merge(SecretsSchema);

export type Configuration = z.infer<typeof ConfigurationSchema>;
export type Secrets = z.infer<typeof SecretsSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;

export interface ConfigurationStatus {
  configuration: Configuration;
  secrets: {
    configured: string[];
    missing: string[];
    total: number;
  };
}

export class EnvironmentConfig {
  private static _instance: Environment | null = null;
  private static _configStatus: ConfigurationStatus | null = null;

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

      // LLM Provider API keys
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,

      // LLM configuration
      LLM_DEFAULT_PROVIDER: process.env.LLM_DEFAULT_PROVIDER,
    };

    try {
      this._instance = EnvironmentSchema.parse(env);
      this._configStatus = this.analyzeConfiguration(env);
      return this._instance;
    } catch (error) {
      console.error('❌ Environment configuration validation failed:', error);
      throw new Error('Invalid environment configuration');
    }
  }

  private static analyzeConfiguration(env: Record<string, unknown>): ConfigurationStatus {
    // Parse configuration (safe to log)
    const configuration = ConfigurationSchema.parse(env);

    // Analyze secrets without exposing their values
    const secretKeys = Object.keys(SecretsSchema.shape);
    const configured: string[] = [];
    const missing: string[] = [];

    secretKeys.forEach(key => {
      const value = env[key];
      // Special handling for SESSION_SECRET which has a default value
      if (key === 'SESSION_SECRET') {
        if (value && value !== 'dev-session-secret-change-in-production') {
          configured.push(key);
        } else {
          missing.push(key);
        }
      } else {
        // For all other secrets, just check if they have a value
        if (value) {
          configured.push(key);
        } else {
          missing.push(key);
        }
      }
    });

    return {
      configuration,
      secrets: {
        configured,
        missing,
        total: secretKeys.length
      }
    };
  }

  static get(): Environment {
    return this.load();
  }

  static getConfigurationStatus(): ConfigurationStatus {
    if (!this._configStatus) {
      this.load(); // This will populate _configStatus
    }
    return this._configStatus!;
  }

  static logConfiguration(): void {
    const status = this.getConfigurationStatus();

    console.error('📊 Configuration:');
    console.error(JSON.stringify(status.configuration, null, 2));

    console.error('🔐 Secrets Status:');
    console.error(`  • Total secrets: ${status.secrets.total}`);
    console.error(`  • Configured: ${status.secrets.configured.length} (${status.secrets.configured.join(', ') || 'none'})`);
    console.error(`  • Missing: ${status.secrets.missing.length} (${status.secrets.missing.join(', ') || 'none'})`);

    // OAuth provider validation
    const oauthProvider = status.configuration.OAUTH_PROVIDER;
    const hasOAuthCredentials = this.checkOAuthCredentials(oauthProvider);
    console.error(`🔑 OAuth (${oauthProvider}): ${hasOAuthCredentials ? '✅ configured' : '❌ missing credentials'}`);

    // LLM provider validation
    const llmProviders = this.checkLLMProviders();
    console.error(`🤖 LLM Providers: ${llmProviders.length > 0 ? '✅ ' + llmProviders.join(', ') : '❌ none configured'}`);
  }

  static checkOAuthCredentials(provider: string): boolean {
    const status = this.getConfigurationStatus();
    switch (provider) {
      case 'google':
        return status.secrets.configured.includes('GOOGLE_CLIENT_ID') &&
               status.secrets.configured.includes('GOOGLE_CLIENT_SECRET');
      case 'github':
        return status.secrets.configured.includes('GITHUB_CLIENT_ID') &&
               status.secrets.configured.includes('GITHUB_CLIENT_SECRET');
      case 'microsoft':
        return status.secrets.configured.includes('MICROSOFT_CLIENT_ID') &&
               status.secrets.configured.includes('MICROSOFT_CLIENT_SECRET');
      case 'generic':
        return status.secrets.configured.includes('OAUTH_CLIENT_ID') &&
               status.secrets.configured.includes('OAUTH_CLIENT_SECRET');
      default:
        return false;
    }
  }

  static checkLLMProviders(): string[] {
    const status = this.getConfigurationStatus();
    const providers: string[] = [];

    if (status.secrets.configured.includes('ANTHROPIC_API_KEY')) {
      providers.push('claude');
    }
    if (status.secrets.configured.includes('OPENAI_API_KEY')) {
      providers.push('openai');
    }
    if (status.secrets.configured.includes('GOOGLE_API_KEY')) {
      providers.push('gemini');
    }

    return providers;
  }

  static reset(): void {
    this._instance = null;
    this._configStatus = null;
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
      case 'streamable_http':
        return TransportMode.STREAMABLE_HTTP;
      default:
        return TransportMode.STDIO;
    }
  }

  static shouldSkipAuth(): boolean {
    return this.get().MCP_DEV_SKIP_AUTH;
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