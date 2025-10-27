/**
 * Secrets Provider - Platform-Agnostic Secrets Management
 *
 * Abstract interface for retrieving and storing secrets across different platforms.
 * Supports encryption keys, OAuth credentials, and other sensitive configuration.
 *
 * Implementations:
 * - FileSecretsProvider: Simple local dev (.env.local or process.env)
 * - EncryptedFileSecretsProvider: Encrypted local dev (.secrets.encrypted with AES-256-GCM)
 * - VaultSecretsProvider: HashiCorp Vault (Docker Compose, production-grade dev)
 * - VercelSecretsProvider: Vercel encrypted environment variables
 * - AWS/Azure/GCP: Platform-specific secret stores (documented in Phase 11)
 *
 * Security Features:
 * - Type-safe secret retrieval
 * - Optional caching with TTL
 * - Error handling for missing secrets
 * - Audit logging for secret access
 */

/**
 * Platform-agnostic secrets provider interface
 */
export interface SecretsProvider {
  /**
   * Retrieve a secret by key
   * @param key Secret identifier (e.g., 'TOKEN_ENCRYPTION_KEY', 'GOOGLE_CLIENT_SECRET')
   * @returns Secret value or undefined if not found
   */
  getSecret<T = string>(key: string): Promise<T | undefined>;

  /**
   * Store a secret (not supported by all providers)
   * @param key Secret identifier
   * @param value Secret value
   * @throws Error if provider is read-only (e.g., Vercel)
   */
  setSecret<T = string>(key: string, value: T): Promise<void>;

  /**
   * Check if a secret exists
   * @param key Secret identifier
   */
  hasSecret(key: string): Promise<boolean>;

  /**
   * Dispose of resources (close connections, clear caches)
   */
  dispose(): Promise<void>;

  /**
   * Provider name for logging and debugging
   */
  readonly name: string;

  /**
   * Is this provider read-only? (e.g., Vercel env vars cannot be set at runtime)
   */
  readonly readOnly: boolean;
}

/**
 * Secrets provider configuration options
 */
export interface SecretsProviderOptions {
  /**
   * Cache secrets in memory for this duration (milliseconds)
   * Default: 5 minutes (300000ms)
   * Set to 0 to disable caching
   */
  cacheTtlMs?: number;

  /**
   * Enable audit logging for secret access
   * Default: true in production, false in development
   */
  auditLog?: boolean;

  /**
   * Custom logger for audit events
   */
  logger?: {
    info: (message: string, meta?: Record<string, unknown>) => void;
    warn: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
  };
}

/**
 * Secrets provider factory options
 */
export interface SecretsFactoryOptions extends SecretsProviderOptions {
  /**
   * Force a specific provider (for testing)
   * If not set, auto-detect based on environment
   */
  provider?: 'file' | 'encrypted-file' | 'vault' | 'vercel' | 'aws' | 'azure' | 'gcp';
}

/**
 * Standard secret keys used throughout the application
 */
export enum SecretKey {
  // Encryption
  TOKEN_ENCRYPTION_KEY = 'TOKEN_ENCRYPTION_KEY',
  OAUTH_TOKEN_ENCRYPTION_KEY = 'OAUTH_TOKEN_ENCRYPTION_KEY',

  // OAuth Providers
  GOOGLE_CLIENT_ID = 'GOOGLE_CLIENT_ID',
  GOOGLE_CLIENT_SECRET = 'GOOGLE_CLIENT_SECRET',
  GITHUB_CLIENT_ID = 'GITHUB_CLIENT_ID',
  GITHUB_CLIENT_SECRET = 'GITHUB_CLIENT_SECRET',
  MICROSOFT_CLIENT_ID = 'MICROSOFT_CLIENT_ID',
  MICROSOFT_CLIENT_SECRET = 'MICROSOFT_CLIENT_SECRET',

  // Redis
  REDIS_URL = 'REDIS_URL',
  REDIS_TLS_CA_CERT = 'REDIS_TLS_CA_CERT',

  // LLM API Keys
  ANTHROPIC_API_KEY = 'ANTHROPIC_API_KEY',
  OPENAI_API_KEY = 'OPENAI_API_KEY',
  GOOGLE_API_KEY = 'GOOGLE_API_KEY',
}
