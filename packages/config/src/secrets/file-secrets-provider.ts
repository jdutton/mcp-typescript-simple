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
import type { SecretsProviderOptions } from './secrets-provider.js';
import { BaseSecretsProvider } from './base-secrets-provider.js';

export class FileSecretsProvider extends BaseSecretsProvider {
  readonly name = 'file';
  readonly readOnly = false;

  private envVars: Record<string, string> = {};

  constructor(options: SecretsProviderOptions = {}) {
    super(options);

    // Load .env.local if it exists (fallback to process.env)
    this.loadEnvFile();

    // Emit OCSF initialization event
    this.emitInitializationEvent({
      source: Object.keys(this.envVars).length > 0 ? '.env.local' : 'process.env',
      secretCount: this.countSecrets(),
      cacheTtlMs: this.cacheTtlMs,
    });
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
        this.envVars[key.trim()] = value.replaceAll(/(^["'])|(["']$)/g, '');
      }
    } catch (error) {
      // .env.local doesn't exist (ENOENT) - fall back to process.env
      // This is expected behavior for environments without local env files
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

  /**
   * Retrieve secret from env vars (called by base class)
   */
  protected async retrieveSecret<T = string>(key: string): Promise<T | undefined> {
    const value = this.envVars[key];

    if (value === undefined) {
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

    return parsedValue as T;
  }

  /**
   * Store secret in env vars (called by base class)
   */
  protected async storeSecret<T = string>(key: string, value: T): Promise<void> {
    // Store in memory only (not persisted to .env.local)
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);
    this.envVars[key] = stringValue;
  }

  /**
   * Check if secret exists
   */
  async hasSecret(key: string): Promise<boolean> {
    return this.envVars[key] !== undefined;
  }

  /**
   * Dispose provider-specific resources (called by base class)
   */
  protected async disposeResources(): Promise<void> {
    this.envVars = {};
  }
}
