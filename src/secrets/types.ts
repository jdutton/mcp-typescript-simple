/**
 * Secret management interfaces and types
 */

export interface SecretManager {
  /**
   * Retrieve a secret by key
   */
  getSecret(key: string): Promise<string>;

  /**
   * Check if this secret manager is available in the current environment
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get the name of this secret manager for logging
   */
  getName(): string;
}

export interface SecretConfig {
  /**
   * Maximum time to wait for secret retrieval (ms)
   */
  timeout: number;

  /**
   * Whether to cache secrets in memory
   */
  cacheEnabled: boolean;

  /**
   * How long to cache secrets (ms)
   */
  cacheTtl: number;

  /**
   * Providers to try in order
   */
  providers: string[];
}

export interface CachedSecret {
  value: string;
  expires: Date;
}

export class SecretNotFoundError extends Error {
  constructor(key: string, providers: string[]) {
    super(`Secret '${key}' not found in any provider: ${providers.join(', ')}`);
    this.name = 'SecretNotFoundError';
  }
}

export class SecretTimeoutError extends Error {
  constructor(key: string, provider: string, timeout: number) {
    super(`Timeout retrieving secret '${key}' from ${provider} after ${timeout}ms`);
    this.name = 'SecretTimeoutError';
  }
}