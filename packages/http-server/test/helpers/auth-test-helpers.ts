/**
 * Helper functions for HTTP server authentication testing
 */

import type {
  OAuthConfig,
  OAuthProviderType,
  SessionAuthCache
} from '@mcp-typescript-simple/auth';
import { MemoryPKCEStore } from '@mcp-typescript-simple/persistence';
import { MemorySessionManager } from '../../src/session/memory-session-manager.js';
import { MockOAuthProvider } from './mock-oauth-provider.js';

export interface AuthenticatedSessionOptions {
  provider: OAuthProviderType;
  token: string;
  tokenHash: string;
  userId?: string;
  lastValidated?: number;
  validationTTL?: number;
}

/**
 * Creates a mock OAuth provider for testing
 */
export function createMockOAuthProvider(
  providerType: OAuthProviderType,
  config?: Partial<OAuthConfig>
): MockOAuthProvider {
  const defaultConfig: OAuthConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    redirectUri: 'http://localhost:3000/callback',
    scopes: ['openid', 'profile', 'email'],
    ...config
  };

  const pkceStore = new MemoryPKCEStore();
  return new MockOAuthProvider(defaultConfig, providerType, pkceStore);
}

/**
 * Creates an authenticated session with auth cache
 */
export async function setupAuthenticatedSession(
  sessionManager: MemorySessionManager,
  options: AuthenticatedSessionOptions
) {
  const {
    provider,
    token,
    tokenHash,
    userId = 'user-123',
    lastValidated = Date.now(),
    validationTTL = 300000
  } = options;

  const authCache: SessionAuthCache = {
    provider,
    userId,
    tokenHash,
    tokenBindingTime: Date.now(),
    lastValidated,
    validationTTL,
    scopes: ['openid', 'profile', 'email'],
    authInfo: {
      token,
      clientId: 'test-client-id',
      scopes: ['openid', 'profile', 'email'],
      expiresAt: Math.floor((Date.now() + 3600000) / 1000),
      extra: {
        userInfo: {
          sub: userId,
          name: 'Test User',
          email: 'test@example.com',
          provider
        }
      }
    }
  };

  return sessionManager.createSession(undefined, { auth: authCache });
}
