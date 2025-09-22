/**
 * Tiered secret manager that tries multiple providers in order
 */

import { SecretManager, SecretConfig, CachedSecret, SecretNotFoundError, SecretTimeoutError } from './types.js';
import { EnvironmentSecretManager } from './managers/environment.js';
import { FileSecretManager } from './managers/file.js';

export class TieredSecretManager implements SecretManager {
  private providers: SecretManager[] = [];
  private cache = new Map<string, CachedSecret>();
  private config: SecretConfig;

  constructor(config: Partial<SecretConfig> = {}) {
    this.config = {
      timeout: 5000,
      cacheEnabled: true,
      cacheTtl: 5 * 60 * 1000, // 5 minutes
      providers: ['environment', 'file'],
      ...config
    };

    this.initializeProviders();
  }

  async getSecret(key: string): Promise<string> {
    // Check cache first
    if (this.config.cacheEnabled) {
      const cached = this.getCachedSecret(key);
      if (cached) {
        return cached;
      }
    }

    const availableProviders: string[] = [];

    for (const provider of this.providers) {
      try {
        if (!(await provider.isAvailable())) {
          continue;
        }

        availableProviders.push(provider.getName());
        const value = await this.withTimeout(
          provider.getSecret(key),
          this.config.timeout,
          key,
          provider.getName()
        );

        // Cache the result
        if (this.config.cacheEnabled) {
          this.setCachedSecret(key, value);
        }

        return value;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`Secret provider ${provider.getName()} failed for key '${key}':`, errorMessage);
      }
    }

    // If we get here, no provider succeeded
    if (availableProviders.length === 0) {
      throw new SecretNotFoundError(key, ['no providers available']);
    }

    throw new SecretNotFoundError(key, availableProviders);
  }

  async isAvailable(): Promise<boolean> {
    for (const provider of this.providers) {
      if (await provider.isAvailable()) {
        return true;
      }
    }
    return false;
  }

  getName(): string {
    return 'TieredSecretManager';
  }

  /**
   * Clear the secret cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hitRate: number } {
    // Simple implementation - in production you'd track hits/misses
    return {
      size: this.cache.size,
      hitRate: 0 // Would need to track this properly
    };
  }

  private initializeProviders(): void {
    const unknownProviders: string[] = [];

    for (const providerName of this.config.providers) {
      switch (providerName) {
        case 'environment':
          this.providers.push(new EnvironmentSecretManager());
          break;
        case 'file':
          this.providers.push(new FileSecretManager());
          break;
        default:
          unknownProviders.push(providerName);
      }
    }

    if (unknownProviders.length > 0) {
      console.warn(`Unknown secret provider(s): ${unknownProviders.join(', ')}`);
    }

    if (this.providers.length === 0) {
      const configured = this.config.providers.length > 0 ? this.config.providers.join(', ') : '(none)';
      throw new Error(`No valid secret providers configured. Received: ${configured}`);
    }
  }

  private getCachedSecret(key: string): string | null {
    const cached = this.cache.get(key);
    if (cached && cached.expires > new Date()) {
      return cached.value;
    }

    // Remove expired cache entry
    if (cached) {
      this.cache.delete(key);
    }

    return null;
  }

  private setCachedSecret(key: string, value: string): void {
    this.cache.set(key, {
      value,
      expires: new Date(Date.now() + this.config.cacheTtl)
    });
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    key: string,
    provider: string
  ): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new SecretTimeoutError(key, provider, timeout));
      }, timeout);

      if (typeof timer.unref === 'function') {
        timer.unref();
      }

      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}
