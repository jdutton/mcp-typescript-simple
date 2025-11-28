/**
 * In-Memory Test Token Store
 *
 * Fast, ephemeral token storage for testing and local development.
 *
 * Features:
 * - Lightning-fast token operations (all in-memory, no encryption overhead)
 * - Automatic cleanup of expired/revoked tokens
 * - Optional periodic cleanup timer
 *
 * Security:
 * - No encryption - protected by OS process isolation
 * - Data lost on process exit (ephemeral by design)
 * - NOT suitable for production use
 *
 * Use cases:
 * - Unit and integration testing
 * - Local development environments
 * - Temporary single-instance deployments where persistence isn't needed
 *
 * **Production deployments should use RedisTokenStore or FileTokenStore with encryption.**
 */

import {
  InitialAccessTokenStore,
  InitialAccessToken,
  CreateTokenOptions,
  TokenValidationResult,
  validateTokenCommon,
  filterTokens,
  shouldCleanupToken,
  createTokenData,
} from '../../interfaces/token-store.js';
import { logger } from '../../logger.js';

export interface InMemoryTestTokenStoreOptions {
  /** Enable automatic cleanup of expired tokens (default: false) */
  autoCleanup?: boolean;

  /** Cleanup interval in milliseconds (default: 1 hour) */
  cleanupIntervalMs?: number;
}

export class InMemoryTestTokenStore implements InitialAccessTokenStore {
  private readonly tokens = new Map<string, InitialAccessToken>();
  private readonly tokensByValue = new Map<string, InitialAccessToken>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private readonly options: InMemoryTestTokenStoreOptions = {}) {
    if (options.autoCleanup) {
      const intervalMs = options.cleanupIntervalMs ?? 60 * 60 * 1000; // 1 hour default
      this.cleanupTimer = setInterval(() => {
        void this.cleanup();
      }, intervalMs);
    }

    logger.info('InMemoryTestTokenStore initialized (test/dev use only)', {
      autoCleanup: options.autoCleanup ?? false,
      cleanupIntervalMs: options.cleanupIntervalMs,
      encryption: 'disabled (process-isolated)',
    });
  }

  async createToken(options: CreateTokenOptions): Promise<InitialAccessToken> {
    const tokenData = createTokenData(options);

    // Store plain objects (no encryption needed - process-isolated)
    this.tokens.set(tokenData.id, tokenData);
    this.tokensByValue.set(tokenData.token, tokenData);

    logger.info('Initial access token created', {
      tokenId: tokenData.id,
      description: options.description,
      expiresAt: tokenData.expires_at === 0 ? 'never' : new Date(tokenData.expires_at * 1000).toISOString(),
      maxUses: options.max_uses ?? 'unlimited',
    });

    return tokenData;
  }

  async validateAndUseToken(token: string): Promise<TokenValidationResult> {
    const tokenData = this.tokensByValue.get(token);

    if (!tokenData) {
      return { valid: false, reason: 'Token not found' };
    }

    // Use common validation logic
    const result = validateTokenCommon(tokenData, token);

    if (result.valid && result.token) {
      // Increment usage count and update last_used_at
      result.token.usage_count++;
      result.token.last_used_at = Math.floor(Date.now() / 1000);

      logger.info('Token validated and used', {
        tokenId: result.token.id,
        usageCount: result.token.usage_count,
        maxUses: result.token.max_uses ?? 'unlimited',
      });
    }

    return result;
  }

  async getToken(id: string): Promise<InitialAccessToken | undefined> {
    return this.tokens.get(id);
  }

  async getTokenByValue(token: string): Promise<InitialAccessToken | undefined> {
    return this.tokensByValue.get(token);
  }

  async listTokens(options?: {
    includeRevoked?: boolean;
    includeExpired?: boolean;
  }): Promise<InitialAccessToken[]> {
    const allTokens = Array.from(this.tokens.values());
    return filterTokens(allTokens, options);
  }

  async revokeToken(id: string): Promise<boolean> {
    const token = this.tokens.get(id);
    if (!token) {
      return false;
    }

    token.revoked = true;

    logger.info('Token revoked', { tokenId: id });
    return true;
  }

  async deleteToken(id: string): Promise<boolean> {
    const token = this.tokens.get(id);
    if (!token) {
      return false;
    }

    this.tokens.delete(id);
    this.tokensByValue.delete(token.token);

    logger.info('Token deleted', { tokenId: id });
    return true;
  }

  async cleanup(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    let cleaned = 0;

    for (const [id, token] of this.tokens.entries()) {
      if (shouldCleanupToken(token, now)) {
        this.tokens.delete(id);
        this.tokensByValue.delete(token.token);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info('Token cleanup completed', { cleanedCount: cleaned });
    }

    return cleaned;
  }

  async dispose(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    this.tokens.clear();
    this.tokensByValue.clear();

    logger.info('InMemoryTestTokenStore disposed');
  }
}
