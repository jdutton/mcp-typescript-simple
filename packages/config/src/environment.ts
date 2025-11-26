/**
 * Environment configuration for MCP servers
 * Combines all configuration schemas with extensibility support
 */

import { z } from 'zod';
import { BaseConfigSchema, SessionSecretSchema, TransportMode } from './base-config.js';
import { OAuthConfigSchema, OAuthSecretsSchema } from './oauth-config.js';
import { LLMSecretsSchema } from './llm-config.js';
import { StorageConfigSchema } from './storage-config.js';

// Export all sub-schemas
export * from './base-config.js';
export * from './oauth-config.js';
export * from './llm-config.js';
export * from './storage-config.js';

/**
 * Non-secret configuration schema (safe to log)
 */
export const ConfigurationSchema = BaseConfigSchema
  .merge(OAuthConfigSchema)
  .merge(StorageConfigSchema);

/**
 * Secret configuration schema (never log)
 */
export const SecretsSchema = SessionSecretSchema
  .merge(OAuthSecretsSchema)
  .merge(LLMSecretsSchema);

/**
 * Combined environment schema
 */
export const EnvironmentSchema = ConfigurationSchema.merge(SecretsSchema);

export type Configuration = z.infer<typeof ConfigurationSchema>;
export type Secrets = z.infer<typeof SecretsSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;

/**
 * Configuration status interface
 */
export interface ConfigurationStatus {
  configuration: Configuration;
  secrets: {
    configured: string[];
    missing: string[];
    total: number;
  };
}

/**
 * Logger interface for optional logging
 */
export interface ConfigLogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, error?: Error | unknown): void;
}

/**
 * Environment configuration manager
 */
export class EnvironmentConfig {
  private static _instance: Environment | null = null;
  private static _configStatus: ConfigurationStatus | null = null;
  private static _logger: ConfigLogger | null = null;

  /**
   * Set optional logger for configuration messages
   */
  static setLogger(logger: ConfigLogger): void {
    this._logger = logger;
  }

  /**
   * Load and validate environment configuration
   */
  static load(): Environment {
    if (this._instance) {
      return this._instance;
    }

    // Parse environment variables with type conversion
    const env = {
      // Base configuration
      MCP_MODE: process.env.MCP_MODE || 'stdio',
      MCP_DEV_SKIP_AUTH: process.env.MCP_DEV_SKIP_AUTH === 'true',
      OAUTH_MOCK_MODE: process.env.OAUTH_MOCK_MODE === 'true',
      HTTP_PORT: Number.parseInt(process.env.HTTP_PORT || '3000', 10),
      HTTP_HOST: process.env.HTTP_HOST || 'localhost',
      MCP_LEGACY_CLIENT_SUPPORT: process.env.MCP_LEGACY_CLIENT_SUPPORT !== 'false',

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
      LLM_DEFAULT_PROVIDER: process.env.LLM_DEFAULT_PROVIDER,

      // Storage configuration
      REDIS_URL: process.env.REDIS_URL,
      STORAGE_TYPE: process.env.STORAGE_TYPE,
      SESSION_STORE_TYPE: process.env.SESSION_STORE_TYPE,
      TOKEN_STORE_TYPE: process.env.TOKEN_STORE_TYPE,
      CLIENT_STORE_TYPE: process.env.CLIENT_STORE_TYPE,
      PKCE_STORE_TYPE: process.env.PKCE_STORE_TYPE,
      MCP_METADATA_STORE_TYPE: process.env.MCP_METADATA_STORE_TYPE,
    };

    try {
      this._instance = EnvironmentSchema.parse(env);
      this._configStatus = this.analyzeConfiguration(env);
      return this._instance;
    } catch (error) {
      if (this._logger) {
        this._logger.error('Environment configuration validation failed', error);
      }
      throw new Error('Invalid environment configuration');
    }
  }

  /**
   * Analyze configuration and separate secrets
   */
  private static analyzeConfiguration(env: Record<string, unknown>): ConfigurationStatus {
    // Parse configuration (safe to log)
    const configuration = ConfigurationSchema.parse(env);

    // Analyze secrets without exposing their values
    const secretKeys = Object.keys(SecretsSchema.shape);
    const configured: string[] = [];
    const missing: string[] = [];

    for (const key of secretKeys) {
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
    }

    return {
      configuration,
      secrets: {
        configured,
        missing,
        total: secretKeys.length
      }
    };
  }

  /**
   * Get current environment configuration
   */
  static get(): Environment {
    return this.load();
  }

  /**
   * Get configuration status
   */
  static getConfigurationStatus(): ConfigurationStatus {
    if (!this._configStatus) {
      this.load();
    }
    // After load(), _configStatus is guaranteed to be set
    if (!this._configStatus) {
      throw new Error('Configuration status not initialized after load()');
    }
    return this._configStatus;
  }

  /**
   * Log configuration status (requires logger to be set)
   */
  static logConfiguration(): void {
    if (!this._logger) {
       
      console.warn('EnvironmentConfig: Logger not set, skipping configuration logging');
      return;
    }

    const status = this.getConfigurationStatus();

    this._logger.info('Configuration loaded', { configuration: status.configuration });

    this._logger.info('Secrets Status', {
      totalSecrets: status.secrets.total,
      configuredCount: status.secrets.configured.length,
      configured: status.secrets.configured.join(', ') || 'none',
      missingCount: status.secrets.missing.length,
      missing: status.secrets.missing.join(', ') || 'none'
    });

    // OAuth provider validation
    const googleConfigured = this.checkOAuthCredentials('google');
    const githubConfigured = this.checkOAuthCredentials('github');
    const microsoftConfigured = this.checkOAuthCredentials('microsoft');
    const genericConfigured = this.checkOAuthCredentials('generic');
    const configuredProviders = [
      googleConfigured && 'google',
      githubConfigured && 'github',
      microsoftConfigured && 'microsoft',
      genericConfigured && 'generic'
    ].filter(Boolean);

    if (configuredProviders.length > 0) {
      this._logger.info('OAuth providers configured', { providers: configuredProviders });
    } else {
      this._logger.warn('OAuth: no providers configured');
    }

    // LLM provider validation
    const llmProviders = this.checkLLMProviders();
    if (llmProviders.length > 0) {
      this._logger.info('LLM Providers configured', { providers: llmProviders });
    } else {
      this._logger.warn('LLM Providers: none configured');
    }
  }

  /**
   * Check if OAuth credentials are configured for a provider
   */
  static checkOAuthCredentials(provider: string | undefined): boolean {
    if (!provider) return false;
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

  /**
   * Check which LLM providers are configured
   */
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

  /**
   * Reset configuration (useful for testing)
   */
  static reset(): void {
    this._instance = null;
    this._configStatus = null;
  }

  /**
   * Check if running in production
   */
  static isProduction(): boolean {
    return this.get().NODE_ENV === 'production';
  }

  /**
   * Check if running in development
   */
  static isDevelopment(): boolean {
    return this.get().NODE_ENV === 'development';
  }

  /**
   * Get transport mode
   */
  static getTransportMode(): TransportMode {
    const mode = this.get().MCP_MODE;
    switch (mode) {
      case 'streamable_http':
        return TransportMode.STREAMABLE_HTTP;
      default:
        return TransportMode.STDIO;
    }
  }

  /**
   * Check if authentication should be skipped
   */
  static shouldSkipAuth(): boolean {
    return this.get().MCP_DEV_SKIP_AUTH;
  }

  /**
   * Get security configuration
   */
  static getSecurityConfig() {
    const env = this.get();

    return {
      requireHttps: env.REQUIRE_HTTPS || this.isProduction(),
      allowedOrigins: env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',') : undefined,
      allowedHosts: env.ALLOWED_HOSTS ? env.ALLOWED_HOSTS.split(',') : undefined,
      sessionSecret: env.SESSION_SECRET,
    };
  }

  /**
   * Get server configuration
   */
  static getServerConfig() {
    const env = this.get();

    return {
      port: env.HTTP_PORT,
      host: env.HTTP_HOST,
      mode: this.getTransportMode(),
    };
  }
}
