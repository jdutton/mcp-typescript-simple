/**
 * HashiCorp Vault Secrets Provider
 *
 * Production-grade secrets provider for Docker Compose development and self-hosted deployments.
 * Integrates with HashiCorp Vault's KV v2 secrets engine.
 *
 * Features:
 * - Secure encrypted storage at rest
 * - Audit logging built-in
 * - Secret versioning and rollback
 * - Dynamic credentials support
 * - Multi-tenant isolation
 *
 * Setup (Docker Compose):
 * ```yaml
 * services:
 *   vault:
 *     image: hashicorp/vault:latest
 *     ports:
 *       - "8200:8200"
 *     environment:
 *       VAULT_DEV_ROOT_TOKEN_ID: "dev-root-token"
 *     command: server -dev
 * ```
 *
 * Environment Variables:
 * - VAULT_ADDR: Vault server address (e.g., http://localhost:8200)
 * - VAULT_TOKEN: Authentication token
 * - VAULT_NAMESPACE: Optional namespace for multi-tenancy
 *
 * References:
 * - https://www.vaultproject.io/docs/secrets/kv/kv-v2
 * - https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2
 */

import type { SecretsProvider, SecretsProviderOptions } from './secrets-provider.js';

interface VaultKVResponse<T> {
  data: {
    data: T;
    metadata: {
      created_time: string;
      custom_metadata: Record<string, string> | null;
      deletion_time: string;
      destroyed: boolean;
      version: number;
    };
  };
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  version: number;
}

export interface VaultSecretsProviderOptions extends SecretsProviderOptions {
  /**
   * Vault server address (default: process.env.VAULT_ADDR or http://localhost:8200)
   */
  vaultAddr?: string;

  /**
   * Vault authentication token (default: process.env.VAULT_TOKEN)
   */
  vaultToken?: string;

  /**
   * Vault namespace for multi-tenancy (default: process.env.VAULT_NAMESPACE)
   */
  vaultNamespace?: string;

  /**
   * KV secrets engine mount point (default: 'secret')
   */
  mountPoint?: string;

  /**
   * Base path for secrets in KV engine (default: 'mcp-server')
   */
  basePath?: string;
}

export class VaultSecretsProvider implements SecretsProvider {
  readonly name = 'vault';
  readonly readOnly = false;

  private readonly vaultAddr: string;
  private readonly vaultToken: string;
  private readonly vaultNamespace?: string;
  private readonly mountPoint: string;
  private readonly basePath: string;
  private readonly cacheTtlMs: number;
  private readonly auditLog: boolean;
  private readonly logger?: SecretsProviderOptions['logger'];
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(options: VaultSecretsProviderOptions = {}) {
    this.vaultAddr = options.vaultAddr || process.env.VAULT_ADDR || 'http://localhost:8200';
    this.vaultToken = options.vaultToken || process.env.VAULT_TOKEN || '';
    this.vaultNamespace = options.vaultNamespace || process.env.VAULT_NAMESPACE;
    this.mountPoint = options.mountPoint || 'secret';
    this.basePath = options.basePath || 'mcp-server';
    this.cacheTtlMs = options.cacheTtlMs ?? 300000; // 5 minutes default
    this.auditLog = options.auditLog ?? process.env.NODE_ENV === 'production';
    this.logger = options.logger;

    if (!this.vaultToken) {
      throw new Error(
        'Vault token not configured. Set VAULT_TOKEN environment variable or pass vaultToken option.'
      );
    }

    if (this.auditLog && this.logger) {
      this.logger.info('VaultSecretsProvider initialized', {
        vaultAddr: this.vaultAddr,
        namespace: this.vaultNamespace,
        mountPoint: this.mountPoint,
        basePath: this.basePath,
        cacheTtlMs: this.cacheTtlMs,
      });
    }
  }

  /**
   * Build full path for secret in Vault
   * Format: /v1/{mountPoint}/data/{basePath}/{key}
   */
  private getSecretPath(key: string): string {
    return `${this.vaultAddr}/v1/${this.mountPoint}/data/${this.basePath}/${key}`;
  }

  /**
   * Get request headers for Vault API
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'X-Vault-Token': this.vaultToken,
      'Content-Type': 'application/json',
    };

    if (this.vaultNamespace) {
      headers['X-Vault-Namespace'] = this.vaultNamespace;
    }

    return headers;
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
            version: cached.version,
            cached: true,
          });
        }
        return cached.value as T;
      }
    }

    try {
      const response = await fetch(this.getSecretPath(key), {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (response.status === 404) {
        if (this.auditLog && this.logger) {
          this.logger.warn('Secret not found in Vault', {
            provider: this.name,
            key,
            path: this.getSecretPath(key),
          });
        }
        return undefined;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Vault API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as VaultKVResponse<{ value: T }>;
      const secretValue = data.data.data.value;
      const version = data.data.metadata.version;

      // Cache the value
      if (this.cacheTtlMs > 0) {
        this.cache.set(key, {
          value: secretValue,
          expiresAt: Date.now() + this.cacheTtlMs,
          version,
        });
      }

      if (this.auditLog && this.logger) {
        this.logger.info('Secret retrieved from Vault', {
          provider: this.name,
          key,
          version,
          cached: false,
        });
      }

      return secretValue;
    } catch (error) {
      if (this.logger) {
        this.logger.error('Failed to retrieve secret from Vault', {
          provider: this.name,
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  }

  async setSecret<T = string>(key: string, value: T): Promise<void> {
    try {
      const response = await fetch(this.getSecretPath(key), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          data: { value },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Vault API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as VaultKVResponse<{ value: T }>;
      const version = data.data.metadata.version;

      // Update cache
      if (this.cacheTtlMs > 0) {
        this.cache.set(key, {
          value,
          expiresAt: Date.now() + this.cacheTtlMs,
          version,
        });
      }

      if (this.auditLog && this.logger) {
        this.logger.info('Secret stored in Vault', {
          provider: this.name,
          key,
          version,
          valueType: typeof value,
        });
      }
    } catch (error) {
      if (this.logger) {
        this.logger.error('Failed to store secret in Vault', {
          provider: this.name,
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
  }

  async hasSecret(key: string): Promise<boolean> {
    try {
      const response = await fetch(this.getSecretPath(key), {
        method: 'GET',
        headers: this.getHeaders(),
      });

      return response.status !== 404;
    } catch {
      return false;
    }
  }

  async dispose(): Promise<void> {
    this.cache.clear();

    if (this.auditLog && this.logger) {
      this.logger.info('VaultSecretsProvider disposed', {
        provider: this.name,
      });
    }
  }
}
