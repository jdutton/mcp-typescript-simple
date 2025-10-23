/**
 * In-Memory Initial Access Token Store
 *
 * Fast, ephemeral token storage for development and testing.
 *
 * Features:
 * - Lightning-fast token operations (all in-memory)
 * - Automatic cleanup of expired/revoked tokens
 * - Optional periodic cleanup timer
 *
 * Limitations:
 * - Tokens lost on server restart (not persistent)
 * - Not suitable for multi-instance deployments
 * - Limited by process memory
 *
 * Use cases:
 * - Development and testing
 * - Single-instance deployments where persistence isn't critical
 * - As a fallback when no persistent storage is configured
 */

import { randomBytes } from 'crypto';
import { randomUUID } from 'crypto';
import {
  InitialAccessTokenStore,
  InitialAccessToken,
  CreateTokenOptions,
  TokenValidationResult,
  validateTokenCommon,
} from '../../interfaces/token-store.js';
import { logger } from '../../logger.js';

export interface InMemoryTokenStoreOptions {
  /** Enable automatic cleanup of expired tokens (default: false) */
  autoCleanup?: boolean;

  /** Cleanup interval in milliseconds (default: 1 hour) */
  cleanupIntervalMs?: number;
}

export class InMemoryTokenStore implements InitialAccessTokenStore {
  private tokens = new Map<string, InitialAccessToken>();
  private tokensByValue = new Map<string, InitialAccessToken>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private options: InMemoryTokenStoreOptions = {}) {
    if (options.autoCleanup) {
      const intervalMs = options.cleanupIntervalMs || 60 * 60 * 1000; // 1 hour default
      this.cleanupTimer = setInterval(() => {
        void this.cleanup();
      }, intervalMs);
    }

    logger.info('InMemoryTokenStore initialized', {
      autoCleanup: options.autoCleanup || false,
      cleanupIntervalMs: options.cleanupIntervalMs,
    });
  }

  async createToken(options: CreateTokenOptions): Promise<InitialAccessToken> {
    const id = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const now = Math.floor(Date.now() / 1000);

    const tokenData: InitialAccessToken = {
      id,
      token,
      description: options.description,
      created_at: now,
      expires_at: options.expires_in ? now + options.expires_in : 0,
      usage_count: 0,
      max_uses: options.max_uses,
      revoked: false,
    };

    this.tokens.set(id, tokenData);
    this.tokensByValue.set(token, tokenData);

    logger.info('Initial access token created', {
      tokenId: id,
      description: options.description,
      expiresAt: tokenData.expires_at === 0 ? 'never' : new Date(tokenData.expires_at * 1000).toISOString(),
      maxUses: options.max_uses || 'unlimited',
    });

    return tokenData;
  }

  async validateAndUseToken(token: string): Promise<TokenValidationResult> {
    const tokenData = this.tokensByValue.get(token);

    // Use common validation logic
    const result = validateTokenCommon(tokenData, token);

    if (result.valid && result.token) {
      // Increment usage count and update last_used_at
      result.token.usage_count++;
      result.token.last_used_at = Math.floor(Date.now() / 1000);

      logger.info('Token validated and used', {
        tokenId: result.token.id,
        usageCount: result.token.usage_count,
        maxUses: result.token.max_uses || 'unlimited',
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
    const now = Math.floor(Date.now() / 1000);
    const allTokens = Array.from(this.tokens.values());

    return allTokens.filter((token) => {
      // Filter revoked tokens
      if (token.revoked && !options?.includeRevoked) {
        return false;
      }

      // Filter expired tokens
      if (token.expires_at > 0 && token.expires_at < now && !options?.includeExpired) {
        return false;
      }

      return true;
    });
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
      // Remove expired tokens
      if (token.expires_at > 0 && token.expires_at < now) {
        this.tokens.delete(id);
        this.tokensByValue.delete(token.token);
        cleaned++;
        continue;
      }

      // Remove revoked tokens
      if (token.revoked) {
        this.tokens.delete(id);
        this.tokensByValue.delete(token.token);
        cleaned++;
        continue;
      }

      // Remove tokens that have exceeded max uses
      if (token.max_uses && token.max_uses > 0 && token.usage_count >= token.max_uses) {
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

    logger.info('InMemoryTokenStore disposed');
  }
}