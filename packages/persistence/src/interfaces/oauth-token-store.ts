/**
 * OAuth Token Store Interface
 *
 * Manages OAuth access tokens, refresh tokens, and associated user information
 * for authentication across serverless function invocations.
 */

import { StoredTokenInfo } from '../types.js';
import type { TokenEncryptionService } from '../encryption/token-encryption-service.js';

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
  storeToken(_accessToken: string, _tokenInfo: StoredTokenInfo): Promise<void>;

  /**
   * Retrieve token information by access token
   *
   * @param accessToken The access token to look up
   * @returns Token metadata or null if not found/expired
   */
  getToken(_accessToken: string): Promise<StoredTokenInfo | null>;

  /**
   * Find token information by refresh token
   *
   * @param refreshToken The refresh token to look up
   * @returns Object containing access token and token info, or null if not found/expired
   */
  findByRefreshToken(_refreshToken: string): Promise<{ accessToken: string; tokenInfo: StoredTokenInfo } | null>;

  /**
   * Delete a token by access token
   *
   * @param accessToken The access token to delete
   */
  deleteToken(_accessToken: string): Promise<void>;

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

/**
 * Serialize and encrypt OAuth token data for storage
 * Shared utility to eliminate duplication across OAuth token stores
 *
 * @param data The data to serialize and encrypt
 * @param encryptionService The encryption service to use
 * @returns Encrypted string
 */
export function serializeOAuthToken<T>(data: T, encryptionService: TokenEncryptionService): string {
  const json = JSON.stringify(data);
  return encryptionService.encrypt(json);
}

/**
 * Decrypt and deserialize OAuth token data from storage
 * Shared utility to eliminate duplication across OAuth token stores
 *
 * @param encrypted The encrypted data string
 * @param encryptionService The encryption service to use
 * @returns Deserialized data
 */
export function deserializeOAuthToken<T>(encrypted: string, encryptionService: TokenEncryptionService): T {
  const json = encryptionService.decrypt(encrypted);
  return JSON.parse(json) as T;
}
