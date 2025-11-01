/**
 * Vercel Secrets Provider
 *
 * Vercel-native secrets provider that reads from process.env.
 * Vercel automatically encrypts environment variables at rest (AES-256).
 *
 * Features:
 * - Automatic encryption at rest (Vercel platform)
 * - Encrypted in transit (TLS)
 * - No API calls needed (direct process.env access)
 * - Zero additional latency
 * - Scales to millions of requests
 * - OCSF structured audit events via BaseSecretsProvider
 *
 * Environment Variable Configuration:
 * Set environment variables in Vercel dashboard or via vercel env command:
 * - TOKEN_ENCRYPTION_KEY
 * - GOOGLE_CLIENT_SECRET
 * - REDIS_URL
 * - etc.
 *
 * References:
 * - https://vercel.com/docs/projects/environment-variables
 * - https://vercel.com/docs/security/encryption
 */

import type { SecretsProviderOptions } from './secrets-provider.js';
import { BaseSecretsProvider } from './base-secrets-provider.js';

export class VercelSecretsProvider extends BaseSecretsProvider {
  readonly name = 'vercel';
  readonly readOnly = true; // Cannot set environment variables at runtime on Vercel

  constructor(options: SecretsProviderOptions = {}) {
    super(options);

    // Verify we're running on Vercel
    if (!process.env.VERCEL) {
      throw new Error(
        'VercelSecretsProvider requires VERCEL=1 environment variable. ' +
        'Use FileSecretsProvider or VaultSecretsProvider for local development.'
      );
    }

    this.emitInitializationEvent({
      region: process.env.VERCEL_REGION,
      environment: process.env.VERCEL_ENV,
    });
  }

  protected async retrieveSecret<T = string>(key: string): Promise<T | undefined> {
    const value = process.env[key];

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

  protected async storeSecret<T = string>(_key: string, _value: T): Promise<void> {
    throw new Error(
      'VercelSecretsProvider is read-only. ' +
      'Update environment variables via Vercel dashboard or CLI: ' +
      'vercel env add <key> <environment>'
    );
  }

  async hasSecret(key: string): Promise<boolean> {
    return process.env[key] !== undefined;
  }

  protected async disposeResources(): Promise<void> {
    // Nothing to clean up (no connections or caches)
  }
}
