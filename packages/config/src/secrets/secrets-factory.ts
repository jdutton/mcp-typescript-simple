/**
 * Secrets Provider Factory
 *
 * Auto-detects the appropriate secrets provider based on environment.
 * Supports file-based (local dev), Vault (Docker Compose), and Vercel (production).
 *
 * Detection Logic:
 * 1. If VERCEL=1 → VercelSecretsProvider
 * 2. If VAULT_ADDR set → VaultSecretsProvider
 * 3. If TOKEN_ENCRYPTION_KEY set → EncryptedFileSecretsProvider
 * 4. Otherwise → FileSecretsProvider (fallback)
 *
 * Usage:
 * ```typescript
 * import { createSecretsProvider } from './secrets-factory.js';
 *
 * const secrets = await createSecretsProvider();
 * const encryptionKey = await secrets.getSecret('TOKEN_ENCRYPTION_KEY');
 * ```
 *
 * Testing:
 * ```typescript
 * // Force a specific provider for testing
 * const secrets = await createSecretsProvider({ provider: 'file' });
 * ```
 */

import type { SecretsProvider, SecretsFactoryOptions } from './secrets-provider.js';
import { FileSecretsProvider } from './file-secrets-provider.js';
import { EncryptedFileSecretsProvider } from './encrypted-file-secrets-provider.js';
import { VaultSecretsProvider } from './vault-secrets-provider.js';
import { VercelSecretsProvider } from './vercel-secrets-provider.js';

/**
 * Detect which secrets provider to use based on environment
 */
export function detectSecretsProvider(): 'file' | 'encrypted-file' | 'vault' | 'vercel' {
  // Vercel production (highest priority)
  if (process.env.VERCEL === '1') {
    return 'vercel';
  }

  // HashiCorp Vault (Docker Compose, self-hosted)
  if (process.env.VAULT_ADDR) {
    return 'vault';
  }

  // Encrypted file (local dev with master key for encrypted secrets file)
  if (process.env.SECRETS_MASTER_KEY) {
    return 'encrypted-file';
  }

  // File-based (local dev fallback - plaintext)
  return 'file';
}

/**
 * Create appropriate secrets provider based on environment
 */
export async function createSecretsProvider(
  options: SecretsFactoryOptions = {}
): Promise<SecretsProvider> {
  const providerType = options.provider ?? detectSecretsProvider();

  switch (providerType) {
    case 'vercel':
      return new VercelSecretsProvider(options);

    case 'vault':
      return new VaultSecretsProvider(options);

    case 'encrypted-file':
      return new EncryptedFileSecretsProvider(options);

    case 'file':
      return new FileSecretsProvider(options);

    case 'aws':
      throw new Error(
        'AWS Secrets Manager provider not yet implemented. ' +
        'See docs/deployment/aws-deployment.md for guidance.'
      );

    case 'azure':
      throw new Error(
        'Azure Key Vault provider not yet implemented. ' +
        'See docs/deployment/azure-deployment.md for guidance.'
      );

    case 'gcp':
      throw new Error(
        'GCP Secret Manager provider not yet implemented. ' +
        'See docs/deployment/gcp-deployment.md for guidance.'
      );

    default:
      throw new Error(`Unknown secrets provider: ${providerType}`);
  }
}

/**
 * Singleton instance (optional convenience)
 */
let singletonProvider: SecretsProvider | null = null;

/**
 * Get or create singleton secrets provider
 * Useful for shared instances across application
 */
export async function getSecretsProvider(
  options: SecretsFactoryOptions = {}
): Promise<SecretsProvider> {
  singletonProvider ??= await createSecretsProvider(options);
  return singletonProvider;
}

/**
 * Reset singleton (useful for testing)
 */
export function resetSecretsProvider(): void {
  if (singletonProvider) {
    singletonProvider.dispose().catch(() => {
      // Ignore disposal errors during reset
    });
    singletonProvider = null;
  }
}
