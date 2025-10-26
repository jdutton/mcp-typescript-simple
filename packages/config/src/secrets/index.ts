/**
 * Secrets Management Infrastructure
 *
 * Platform-agnostic secrets abstraction supporting multiple backends:
 * - Plain file (development - .env.local)
 * - Encrypted file (development - .secrets.encrypted)
 * - HashiCorp Vault (Docker Compose development)
 * - Vercel (production)
 *
 * Auto-detects environment and selects appropriate provider.
 */

// Export types (interfaces are erased at runtime, export as type only)
export type { SecretsProvider, SecretsProviderOptions, SecretsFactoryOptions } from './secrets-provider.js';
export { SecretKey } from './secrets-provider.js'; // Enum exists at runtime

// Export concrete implementations
export { FileSecretsProvider } from './file-secrets-provider.js';
export { EncryptedFileSecretsProvider } from './encrypted-file-secrets-provider.js';
export { VaultSecretsProvider } from './vault-secrets-provider.js';
export { VercelSecretsProvider } from './vercel-secrets-provider.js';
export { getSecretsProvider, detectSecretsProvider } from './secrets-factory.js';
