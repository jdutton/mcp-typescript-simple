/**
 * @mcp-typescript-simple/auth
 *
 * Complete OAuth 2.0/2.1 + Dynamic Client Registration (DCR) implementation
 */

// Core factory and types
export { OAuthProviderFactory } from './factory.js';
export type {
  OAuthProvider,
  OAuthProviderFactory as IOAuthProviderFactory,
  OAuthConfig,
  OAuthProviderType,
  GoogleOAuthConfig,
  GitHubOAuthConfig,
  MicrosoftOAuthConfig,
  GenericOAuthConfig,
  OAuthSession,
  OAuthUserInfo,
} from './providers/types.js';

// Export error classes as values (not types)
export {
  OAuthError,
  OAuthStateError,
  OAuthTokenError,
  OAuthProviderError,
} from './providers/types.js';

// Individual provider implementations
export { BaseOAuthProvider } from './providers/base-provider.js';
export { GoogleOAuthProvider } from './providers/google-provider.js';
export { GitHubOAuthProvider } from './providers/github-provider.js';
export { MicrosoftOAuthProvider } from './providers/microsoft-provider.js';
export { GenericOAuthProvider } from './providers/generic-provider.js';

// OAuth discovery and metadata (re-export all from discovery-metadata.ts)
export * from './discovery-metadata.js';

// Shared utilities (re-export all from shared modules)
export * from './shared/oauth-helpers.js';
export * from './shared/provider-router.js';
export * from './shared/universal-token-handler.js';
export * from './shared/universal-revoke-handler.js';

// User allowlist management (re-export all)
export * from './allowlist.js';

// Login page generation (re-export all)
export * from './login-page.js';

// Logging utilities (for optional integration)
export { logger, Logger, type LogLevel } from './utils/logger.js';
