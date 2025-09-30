/**
 * Vercel KV Initial Access Token Store
 *
 * Redis-compatible token storage for Vercel serverless deployments.
 *
 * Features:
 * - Serverless-native (no persistent connections)
 * - Global edge network with low latency
 * - Automatic TTL support for expiration
 * - Scales to millions of tokens
 * - Multi-instance deployment support
 *
 * Setup:
 * 1. Add Vercel KV integration: `vercel link` then add KV storage
 * 2. Environment variables auto-set: KV_REST_API_URL, KV_REST_API_TOKEN
 * 3. No code changes needed - factory auto-detects Vercel environment
 *
 * Limitations:
 * - Requires Vercel KV subscription (free tier: 256MB, 10K commands/day)
 * - Network latency for token operations (optimized with edge caching)
 */

import { kv } from '@vercel/kv';
import { randomBytes, randomUUID } from 'crypto';
import {
  InitialAccessTokenStore,
  InitialAccessToken,
  CreateTokenOptions,
  TokenValidationResult,
  validateTokenCommon,
} from './token-store-interface.js';
import { logger } from '../../utils/logger.js';

/**
 * Redis key prefixes for namespacing
 */
const KEY_PREFIX = 'dcr:token:';
const VALUE_PREFIX = 'dcr:value:';
const INDEX_KEY = 'dcr:tokens:all';

export class VercelKVTokenStore implements InitialAccessTokenStore {
  constructor() {
    logger.info('VercelKVTokenStore initialized');
  }

  /**
   * Generate Redis key for token ID
   */
  private getTokenKey(id: string): string {
    return `${KEY_PREFIX}${id}`;
  }

  /**
   * Generate Redis key for token value lookup
   */
  private getValueKey(token: string): string {
    return `${VALUE_PREFIX}${token}`;
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

    // Store token data by ID
    const tokenKey = this.getTokenKey(id);
    const valueKey = this.getValueKey(token);

    // Calculate TTL (if expiration is set)
    const ttlSeconds = tokenData.expires_at > 0 ? tokenData.expires_at - now : undefined;

    // Store token metadata
    if (ttlSeconds) {
      await kv.set(tokenKey, JSON.stringify(tokenData), { ex: ttlSeconds });
      await kv.set(valueKey, id, { ex: ttlSeconds });
    } else {
      await kv.set(tokenKey, JSON.stringify(tokenData));
      await kv.set(valueKey, id);
    }

    // Add to index (for listing)
    await kv.sadd(INDEX_KEY, id);

    logger.info('Initial access token created in Vercel KV', {
      tokenId: id,
      description: options.description,
      expiresAt: tokenData.expires_at === 0 ? 'never' : new Date(tokenData.expires_at * 1000).toISOString(),
      maxUses: options.max_uses || 'unlimited',
      ttl: ttlSeconds ? `${ttlSeconds}s` : 'none',
    });

    return tokenData;
  }

  async validateAndUseToken(token: string): Promise<TokenValidationResult> {
    // Look up token ID from value
    const valueKey = this.getValueKey(token);
    const id = await kv.get<string>(valueKey);

    if (!id) {
      logger.warn('Token validation failed: token not found', { token: token.substring(0, 8) + '...' });
      return {
        valid: false,
        reason: 'Token not found',
      };
    }

    // Get token data
    const tokenKey = this.getTokenKey(id);
    const tokenJson = await kv.get<string>(tokenKey);

    if (!tokenJson) {
      logger.warn('Token validation failed: token data not found', { tokenId: id });
      return {
        valid: false,
        reason: 'Token not found',
      };
    }

    const tokenData: InitialAccessToken = JSON.parse(tokenJson);

    // Use common validation logic
    const result = validateTokenCommon(tokenData, token);

    if (result.valid && result.token) {
      // Increment usage count and update last_used_at
      result.token.usage_count++;
      result.token.last_used_at = Math.floor(Date.now() / 1000);

      // Update token in KV
      await kv.set(tokenKey, JSON.stringify(result.token));

      logger.info('Token validated and used', {
        tokenId: result.token.id,
        usageCount: result.token.usage_count,
        maxUses: result.token.max_uses || 'unlimited',
      });
    }

    return result;
  }

  async getToken(id: string): Promise<InitialAccessToken | undefined> {
    const tokenKey = this.getTokenKey(id);
    const tokenJson = await kv.get<string>(tokenKey);

    if (!tokenJson) {
      return undefined;
    }

    return JSON.parse(tokenJson);
  }

  async getTokenByValue(token: string): Promise<InitialAccessToken | undefined> {
    const valueKey = this.getValueKey(token);
    const id = await kv.get<string>(valueKey);

    if (!id) {
      return undefined;
    }

    return this.getToken(id);
  }

  async listTokens(options?: {
    includeRevoked?: boolean;
    includeExpired?: boolean;
  }): Promise<InitialAccessToken[]> {
    // Get all token IDs from index
    const idsResult = await kv.smembers(INDEX_KEY);
    const ids = Array.isArray(idsResult) ? idsResult : [];

    if (ids.length === 0) {
      return [];
    }

    // Fetch all tokens in parallel
    const tokenPromises = ids.map((id) => this.getToken(String(id)));
    const tokens = (await Promise.all(tokenPromises)).filter((t): t is InitialAccessToken => t !== undefined);

    const now = Math.floor(Date.now() / 1000);

    return tokens.filter((token) => {
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
    const token = await this.getToken(id);
    if (!token) {
      return false;
    }

    token.revoked = true;

    const tokenKey = this.getTokenKey(id);
    await kv.set(tokenKey, JSON.stringify(token));

    logger.info('Token revoked', { tokenId: id });
    return true;
  }

  async deleteToken(id: string): Promise<boolean> {
    const token = await this.getToken(id);
    if (!token) {
      return false;
    }

    const tokenKey = this.getTokenKey(id);
    const valueKey = this.getValueKey(token.token);

    // Delete from KV
    await kv.del(tokenKey);
    await kv.del(valueKey);

    // Remove from index
    await kv.srem(INDEX_KEY, id);

    logger.info('Token deleted', { tokenId: id });
    return true;
  }

  async cleanup(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    let cleaned = 0;

    const tokens = await this.listTokens({ includeRevoked: true, includeExpired: true });

    for (const token of tokens) {
      let shouldDelete = false;

      // Remove expired tokens
      if (token.expires_at > 0 && token.expires_at < now) {
        shouldDelete = true;
      }

      // Remove revoked tokens
      if (token.revoked) {
        shouldDelete = true;
      }

      // Remove tokens that have exceeded max uses
      if (token.max_uses && token.max_uses > 0 && token.usage_count >= token.max_uses) {
        shouldDelete = true;
      }

      if (shouldDelete) {
        await this.deleteToken(token.id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info('Token cleanup completed', { cleanedCount: cleaned });
    }

    return cleaned;
  }

  async dispose(): Promise<void> {
    // Vercel KV is connectionless (REST API), no cleanup needed
    logger.info('VercelKVTokenStore disposed');
  }
}