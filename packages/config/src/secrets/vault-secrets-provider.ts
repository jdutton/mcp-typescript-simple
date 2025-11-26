/**
 * HashiCorp Vault Secrets Provider
 *
 * Production-grade secrets provider for Docker Compose development and self-hosted deployments.
 * Integrates with HashiCorp Vault's KV v2 secrets engine.
 *
 * Features:
 * - Secure encrypted storage at rest
 * - Secret versioning and rollback
 * - Dynamic credentials support
 * - Multi-tenant isolation
 * - OCSF structured audit events via BaseSecretsProvider
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

import type { SecretsProviderOptions } from './secrets-provider.js';
import { BaseSecretsProvider } from './base-secrets-provider.js';

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

export class VaultSecretsProvider extends BaseSecretsProvider {
  readonly name = 'vault';
  readonly readOnly = false;

  private readonly vaultAddr: string;
  private readonly vaultToken: string;
  private readonly vaultNamespace?: string;
  private readonly mountPoint: string;
  private readonly basePath: string;

  constructor(options: VaultSecretsProviderOptions = {}) {
    super(options);

    this.vaultAddr = options.vaultAddr ?? process.env.VAULT_ADDR ?? 'http://localhost:8200';
    this.vaultToken = options.vaultToken ?? process.env.VAULT_TOKEN ?? '';
    this.vaultNamespace = options.vaultNamespace ?? process.env.VAULT_NAMESPACE;
    this.mountPoint = options.mountPoint ?? 'secret';
    this.basePath = options.basePath ?? 'mcp-server';

    if (!this.vaultToken) {
      throw new Error(
        'Vault token not configured. Set VAULT_TOKEN environment variable or pass vaultToken option.'
      );
    }

    this.emitInitializationEvent({
      vaultAddr: this.vaultAddr,
      namespace: this.vaultNamespace,
      mountPoint: this.mountPoint,
      basePath: this.basePath,
      cacheTtlMs: this.cacheTtlMs,
    });
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

  protected async retrieveSecret<T = string>(key: string): Promise<T | undefined> {
    const response = await fetch(this.getSecretPath(key), {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (response.status === 404) {
      return undefined;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vault API error (${response.status}): ${errorText}`);
    }

    const data = await response.json() as VaultKVResponse<{ value: T }>;
    return data.data.data.value;
  }

  protected async storeSecret<T = string>(key: string, value: T): Promise<void> {
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

  protected async disposeResources(): Promise<void> {
    // No Vault-specific cleanup needed (no persistent connections)
  }
}
