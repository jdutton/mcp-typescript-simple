/**
 * Shared Redis test helpers and fixtures
 *
 * Provides common Redis mock setup and test data factories to eliminate
 * duplication across Redis-based test files.
 *
 * IMPORTANT: Due to Vitest hoisting requirements, you must set up the Redis mock
 * in each test file like this:
 *
 * ```typescript
 * import { vi } from 'vitest';
 * import { getRedisTestConfig, RedisTestInstance, createTestSession } from '../helpers/redis-test-helpers.js';
 *
 * // Hoist Redis mock at module scope
 * const RedisMock = vi.hoisted(() => require('ioredis-mock'));
 *
 * // Mock Redis for testing
 * vi.mock('ioredis', () => getRedisTestConfig(RedisMock));
 * ```
 */

import { vi } from 'vitest';
import type { OAuthSession } from '../../src/index.js';

/**
 * Hoisted Redis mock for use across test files
 * This must be defined at module scope for Vitest hoisting to work correctly
 */
const RedisMock = vi.hoisted(() => require('ioredis-mock'));

/**
 * Pre-configured Redis mock configuration
 * Use this in vi.mock('ioredis', () => redisMockConfig) calls
 */
export const redisMockConfig = {
  default: RedisMock,
  Redis: RedisMock,
};

/**
 * Get Redis mock configuration for a hoisted RedisMock
 * Use this in vi.mock('ioredis', ...) calls
 *
 * @param RedisMock - The hoisted RedisMock from vi.hoisted(() => require('ioredis-mock'))
 */
export function getRedisTestConfig(RedisMock: any) {
  return {
    default: RedisMock,
    Redis: RedisMock,
  };
}

/**
 * Shared Redis instance manager for test cleanup
 */
export class RedisTestInstance {
  private static instance: any = null;

  /**
   * Get or create shared Redis instance
   */
  static async getInstance(): Promise<any> {
    if (!this.instance) {
      this.instance = new (RedisMock as any)();
    }
    return this.instance;
  }

  /**
   * Flush all data (use in beforeEach)
   */
  static async flush(): Promise<void> {
    const instance = await this.getInstance();
    await instance.flushall();
  }

  /**
   * Clean up Redis instance (use in afterAll)
   */
  static async cleanup(): Promise<void> {
    if (this.instance) {
      await this.instance.quit();
      this.instance = null;
    }
  }
}

/**
 * Factory for creating test OAuth sessions
 */
export interface SessionFactoryOptions {
  state?: string;
  provider?: 'google' | 'github' | 'microsoft';
  codeVerifier?: string;
  codeChallenge?: string;
  redirectUri?: string;
  scopes?: string[];
  expiresIn?: number; // milliseconds from now
  clientState?: string;
  clientRedirectUri?: string;
}

export function createTestSession(options: SessionFactoryOptions = {}): OAuthSession {
  const {
    state = 'test-state-' + Math.random().toString(36).substring(7),
    provider = 'google',
    codeVerifier = 'test-verifier-' + Math.random().toString(36).substring(7),
    codeChallenge = 'test-challenge-' + Math.random().toString(36).substring(7),
    redirectUri = 'http://localhost:3000/callback',
    scopes = ['openid', 'profile'],
    expiresIn = 600000, // 10 minutes default
    clientState,
    clientRedirectUri,
  } = options;

  const session: OAuthSession = {
    provider,
    state,
    codeVerifier,
    codeChallenge,
    redirectUri,
    scopes,
    expiresAt: Date.now() + expiresIn,
  };

  if (clientState !== undefined) {
    session.clientState = clientState;
  }

  if (clientRedirectUri !== undefined) {
    session.clientRedirectUri = clientRedirectUri;
  }

  return session;
}

/**
 * Create multiple test sessions with different providers
 */
export function createMultiProviderSessions(baseState: string): {
  google: OAuthSession;
  github: OAuthSession;
  microsoft: OAuthSession;
} {
  return {
    google: createTestSession({
      state: baseState,
      provider: 'google',
      scopes: ['openid', 'profile', 'email'],
    }),
    github: createTestSession({
      state: baseState,
      provider: 'github',
      scopes: ['user:email'],
    }),
    microsoft: createTestSession({
      state: baseState,
      provider: 'microsoft',
      scopes: ['openid'],
    }),
  };
}

/**
 * Create environment-specific sessions for multi-environment testing
 */
export function createEnvironmentSessions(state: string, environment: string): OAuthSession {
  return createTestSession({
    state,
    provider: 'google',
    codeVerifier: `verifier-${environment}`,
    codeChallenge: `challenge-${environment}`,
    redirectUri: `http://${environment}.example.com/callback`,
    scopes: ['openid'],
  });
}

/**
 * Setup encryption service and Redis instance for tests
 * Use this in beforeEach to eliminate duplication of test setup
 *
 * @returns Object with encryptionService and sharedRedis
 */
export async function setupRedisWithEncryption(): Promise<{
  encryptionService: any;
  sharedRedis: any;
}> {
  // Import TokenEncryptionService dynamically to avoid circular deps
  const { TokenEncryptionService } = await import('../../src/encryption/token-encryption-service.js');

  // Set encryption key for tests (required - must be 32 bytes base64)
  process.env.TOKEN_ENCRYPTION_KEY = 'Wp3suOcV+cleewUEOGUkE7JNgsnzwmiBMNqF7q9sQSI=';

  // Create encryption service
  const encryptionService = new TokenEncryptionService({
    encryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
  });

  // Get shared Redis instance for direct inspection
  await RedisTestInstance.flush();
  const sharedRedis = await RedisTestInstance.getInstance();

  return { encryptionService, sharedRedis };
}
