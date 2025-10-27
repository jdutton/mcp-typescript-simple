/**
 * File-Based Secrets Provider
 *
 * Simple local development secrets provider that reads from .env.local or process.env.
 * NO encryption at rest - suitable only for local development.
 *
 * Use Cases:
 * - Local development with `npm run dev:*`
 * - Quick prototyping and testing
 * - Non-production environments
 *
 * Limitations:
 * - No encryption at rest (secrets stored as plaintext env vars)
 * - No secret rotation support
 * - Not suitable for production
 *
 * For production, use:
 * - VaultSecretsProvider (Docker Compose)
 * - VercelSecretsProvider (Vercel)
 * - AWS/Azure/GCP providers (cloud deployments)
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SecretsProvider, SecretsProviderOptions } from './secrets-provider.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class FileSecretsProvider implements SecretsProvider {
  readonly name = 'file';
  readonly readOnly = false;

  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly cacheTtlMs: number;
  private readonly auditLog: boolean;
  private readonly logger?: SecretsProviderOptions['logger'];
  private envVars: Record<string, string> = {};

  constructor(options: SecretsProviderOptions = {}) {
    this.cacheTtlMs = options.cacheTtlMs ?? 300000; // 5 minutes default
    this.auditLog = options.auditLog ?? process.env.NODE_ENV === 'production';
    this.logger = options.logger;

    // Load .env.local if it exists (fallback to process.env)
    this.loadEnvFile();

    if (this.auditLog && this.logger) {
      this.logger.info('FileSecretsProvider initialized', {
        source: Object.keys(this.envVars).length > 0 ? '.env.local' : 'process.env',
        secretCount: this.countSecrets(),
        cacheTtlMs: this.cacheTtlMs,
      });
    }
  }

  /**
   * Load .env.local file (if exists) or use process.env
   */
  private loadEnvFile(): void {
    try {
      const envPath = join(process.cwd(), '.env.local');
      const envContent = readFileSync(envPath, 'utf8');

      // Simple .env parser (key=value format)
      const lines = envContent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          continue;
        }

        const [key, ...valueParts] = trimmed.split('=');
        if (!key || valueParts.length === 0) {
          continue;
        }

        const value = valueParts.join('=').trim();
        // Remove quotes if present
        this.envVars[key.trim()] = value.replace(/^["']|["']$/g, '');
      }
    } catch (error) {
      // .env.local doesn't exist, fall back to process.env
      this.envVars = { ...process.env } as Record<string, string>;
    }
  }

  /**
   * Count how many secrets are available
   */
  private countSecrets(): number {
    return Object.keys(this.envVars).filter(key =>
      key.includes('KEY') ||
      key.includes('SECRET') ||
      key.includes('TOKEN') ||
      key.includes('PASSWORD')
    ).length;
  }

  async getSecret<T = string>(key: string): Promise<T | undefined> {
    // Check cache first
    if (this.cacheTtlMs > 0) {
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        if (this.auditLog && this.logger) {
          this.logger.info('Secret retrieved from cache', {
            provider: this.name,
            key,
            cached: true,
          });
        }
        return cached.value as T;
      }
    }

    // Get from env vars
    const value = this.envVars[key];

    if (value === undefined) {
      if (this.auditLog && this.logger) {
        this.logger.warn('Secret not found', {
          provider: this.name,
          key,
        });
      }
      return undefined;
    }

    // Parse JSON values if they look like objects/arrays
    let parsedValue: unknown = value;
    if (value.startsWith('{') || value.startsWith('[')) {
      try {
        parsedValue = JSON.parse(value);
      } catch {
        // Not JSON, keep as string
        parsedValue = value;
      }
    }

    // Cache the value
    if (this.cacheTtlMs > 0) {
      this.cache.set(key, {
        value: parsedValue,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
    }

    if (this.auditLog && this.logger) {
      this.logger.info('Secret retrieved', {
        provider: this.name,
        key,
        cached: false,
        valueType: typeof parsedValue,
      });
    }

    return parsedValue as T;
  }

  async setSecret<T = string>(key: string, value: T): Promise<void> {
    // Store in memory only (not persisted to .env.local)
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    this.envVars[key] = stringValue;

    // Update cache
    if (this.cacheTtlMs > 0) {
      this.cache.set(key, {
        value,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
    }

    if (this.auditLog && this.logger) {
      this.logger.info('Secret stored', {
        provider: this.name,
        key,
        valueType: typeof value,
      });
    }
  }

  async hasSecret(key: string): Promise<boolean> {
    return this.envVars[key] !== undefined;
  }

  async dispose(): Promise<void> {
    this.cache.clear();
    this.envVars = {};

    if (this.auditLog && this.logger) {
      this.logger.info('FileSecretsProvider disposed', {
        provider: this.name,
      });
    }
  }
}
