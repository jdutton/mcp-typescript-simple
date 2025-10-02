/**
 * Vercel KV OAuth Token Store
 *
 * Redis-based token storage for Vercel serverless deployments.
 * Provides persistent token storage across serverless function invocations.
 *
 * Features:
 * - Automatic expiration using Redis TTL
 * - Scales across multiple serverless instances
 * - No cleanup needed (Redis handles expiration)
 */

import { kv } from '@vercel/kv';
import { OAuthTokenStore } from './oauth-token-store-interface.js';
import { StoredTokenInfo } from '../providers/types.js';
import { logger } from '../../observability/logger.js';

const KEY_PREFIX = 'oauth:token:';

export class VercelKVOAuthTokenStore implements OAuthTokenStore {
  private getTokenKey(accessToken: string): string {
    return `${KEY_PREFIX}${accessToken}`;
  }

  async storeToken(accessToken: string, tokenInfo: StoredTokenInfo): Promise<void> {
    const key = this.getTokenKey(accessToken);

    // Calculate TTL from expiresAt
    const now = Date.now();
    const ttlMs = tokenInfo.expiresAt - now;
    const ttlSeconds = Math.max(Math.floor(ttlMs / 1000), 1); // At least 1 second

    await kv.setex(key, ttlSeconds, JSON.stringify(tokenInfo));

    logger.debug('OAuth token stored in Vercel KV', {
      tokenPrefix: accessToken.substring(0, 8),
      provider: tokenInfo.provider,
      ttlSeconds,
      expiresAt: new Date(tokenInfo.expiresAt).toISOString()
    });
  }

  async getToken(accessToken: string): Promise<StoredTokenInfo | null> {
    const key = this.getTokenKey(accessToken);
    const data = await kv.get<string>(key);

    if (!data) {
      logger.debug('OAuth token not found in Vercel KV', {
        tokenPrefix: accessToken.substring(0, 8)
      });
      return null;
    }

    const tokenInfo = JSON.parse(data) as StoredTokenInfo;

    // Double-check expiration (Redis should have already handled this)
    if (tokenInfo.expiresAt && tokenInfo.expiresAt < Date.now()) {
      logger.warn('OAuth token expired (cleaning up)', {
        tokenPrefix: accessToken.substring(0, 8),
        expiredAt: new Date(tokenInfo.expiresAt).toISOString()
      });
      await this.deleteToken(accessToken);
      return null;
    }

    logger.debug('OAuth token retrieved from Vercel KV', {
      tokenPrefix: accessToken.substring(0, 8),
      provider: tokenInfo.provider
    });

    return tokenInfo;
  }

  async deleteToken(accessToken: string): Promise<void> {
    const key = this.getTokenKey(accessToken);
    await kv.del(key);

    logger.debug('OAuth token deleted from Vercel KV', {
      tokenPrefix: accessToken.substring(0, 8)
    });
  }

  async cleanup(): Promise<number> {
    // No cleanup needed - Redis automatically expires keys
    logger.debug('OAuth token cleanup skipped (Redis auto-expiration enabled)');
    return 0;
  }

  async getTokenCount(): Promise<number> {
    // Scan for all keys with our prefix
    let cursor = 0;
    let count = 0;

    do {
      const result = await kv.scan(cursor, { match: `${KEY_PREFIX}*`, count: 100 });
      cursor = typeof result[0] === 'string' ? parseInt(result[0], 10) : result[0];
      count += result[1].length;
    } while (cursor !== 0);

    return count;
  }

  dispose(): void {
    // No resources to dispose (Vercel KV handles connections)
    logger.info('VercelKVOAuthTokenStore disposed');
  }
}
