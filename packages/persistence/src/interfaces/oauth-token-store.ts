/**
 * OAuth Token Store Interface
 *
 * Manages OAuth access tokens, refresh tokens, and associated user information
 * for authentication across serverless function invocations.
 */

import { StoredTokenInfo } from '../types.js';

/**
 * OAuth Token Store Interface
 *
 * Implementations:
 * - MemoryOAuthTokenStore: Testing only (not persistent across instances)
 * - FileOAuthTokenStore: Development/single-instance (persistent across restarts)
 * - RedisOAuthTokenStore: Serverless/multi-instance deployments with Redis
 */
export interface OAuthTokenStore {
  /**
   * Store an OAuth token with associated metadata
   *
   * @param accessToken The access token to use as the key
   * @param tokenInfo The token metadata to store
   */
  storeToken(accessToken: string, tokenInfo: StoredTokenInfo): Promise<void>;

  /**
   * Retrieve token information by access token
   *
   * @param accessToken The access token to look up
   * @returns Token metadata or null if not found/expired
   */
  getToken(accessToken: string): Promise<StoredTokenInfo | null>;

  /**
   * Find token information by refresh token
   *
   * @param refreshToken The refresh token to look up
   * @returns Object containing access token and token info, or null if not found/expired
   */
  findByRefreshToken(refreshToken: string): Promise<{ accessToken: string; tokenInfo: StoredTokenInfo } | null>;

  /**
   * Delete a token by access token
   *
   * @param accessToken The access token to delete
   */
  deleteToken(accessToken: string): Promise<void>;

  /**
   * Clean up expired tokens
   *
   * @returns Number of tokens cleaned up
   */
  cleanup(): Promise<number>;

  /**
   * Get the current number of stored tokens
   *
   * @returns Token count
   */
  getTokenCount(): Promise<number>;

  /**
   * Dispose of store resources (close connections, timers, etc.)
   */
  dispose(): void;
}
