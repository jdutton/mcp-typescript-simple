/**
 * Initial Access Token Store Interface
 *
 * Manages initial access tokens for protected OAuth 2.0 Dynamic Client Registration.
 * These tokens are used to authenticate requests to the protected /admin/register endpoint.
 *
 * Per RFC 7591 Section 3.1.1:
 * "The authorization server MAY require an initial access token that is provisioned
 * out-of-band (in a manner that is out of scope for this specification)."
 *
 * Security considerations:
 * - Tokens are cryptographically secure random values (32+ bytes)
 * - Tokens have expiration timestamps
 * - Tokens can be revoked at any time
 * - Failed validation attempts should be logged for security monitoring
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { logger } from '../logger.js';

/**
 * Initial Access Token metadata
 */
export interface InitialAccessToken {
  /** Unique token identifier (UUID) */
  id: string;

  /** The actual token value (cryptographically secure random string) */
  token: string;

  /** Human-readable description of the token's purpose */
  description: string;

  /** Unix timestamp when token was created (seconds since epoch) */
  created_at: number;

  /** Unix timestamp when token expires (seconds since epoch), or 0 for never */
  expires_at: number;

  /** Unix timestamp of last usage, or undefined if never used */
  last_used_at?: number;

  /** Number of times this token has been used */
  usage_count: number;

  /** Optional: Maximum number of times token can be used (0 = unlimited) */
  max_uses?: number;

  /** Whether this token has been revoked */
  revoked: boolean;
}

/**
 * Options for creating a new initial access token
 */
export interface CreateTokenOptions {
  /** Human-readable description */
  description: string;

  /** Expiration time in seconds from now (0 = never expires) */
  expires_in?: number;

  /** Maximum number of uses (0 or undefined = unlimited) */
  max_uses?: number;
}

/**
 * Token validation result
 */
export interface TokenValidationResult {
  /** Whether the token is valid */
  valid: boolean;

  /** The token metadata if valid, undefined otherwise */
  token?: InitialAccessToken;

  /** Reason for validation failure */
  reason?: string;
}

/**
 * Initial Access Token Store Interface
 *
 * Implementations:
 * - InMemoryTestTokenStore: Testing/dev only (ephemeral, no encryption, process-isolated)
 * - FileTokenStore: Single-instance deployments (persistent, encrypted, local filesystem)
 * - RedisTokenStore: Multi-instance deployments (persistent, encrypted, Redis)
 */
export interface InitialAccessTokenStore {
  /**
   * Create a new initial access token
   *
   * @param options Token creation options
   * @returns The created token with all metadata
   */
  createToken(options: CreateTokenOptions): Promise<InitialAccessToken>;

  /**
   * Validate a token and mark it as used
   *
   * This method:
   * 1. Checks if token exists
   * 2. Checks if token is expired
   * 3. Checks if token is revoked
   * 4. Checks if max uses exceeded
   * 5. Increments usage count
   * 6. Updates last_used_at timestamp
   *
   * @param token The token value to validate
   * @returns Validation result with token metadata if valid
   */
  validateAndUseToken(token: string): Promise<TokenValidationResult>;

  /**
   * Get token metadata by ID (without marking as used)
   *
   * @param id Token ID
   * @returns Token metadata or undefined if not found
   */
  getToken(id: string): Promise<InitialAccessToken | undefined>;

  /**
   * Get token metadata by token value (without marking as used)
   *
   * @param token Token value
   * @returns Token metadata or undefined if not found
   */
  getTokenByValue(token: string): Promise<InitialAccessToken | undefined>;

  /**
   * List all tokens (optionally filtered)
   *
   * @param options Filter options
   * @returns Array of token metadata
   */
  listTokens(options?: {
    includeRevoked?: boolean;
    includeExpired?: boolean;
  }): Promise<InitialAccessToken[]>;

  /**
   * Revoke a token by ID
   *
   * @param id Token ID
   * @returns True if token was revoked, false if not found
   */
  revokeToken(id: string): Promise<boolean>;

  /**
   * Delete a token by ID (permanent removal)
   *
   * @param id Token ID
   * @returns True if token was deleted, false if not found
   */
  deleteToken(id: string): Promise<boolean>;

  /**
   * Clean up expired and revoked tokens
   *
   * @returns Number of tokens cleaned up
   */
  cleanup(): Promise<number>;

  /**
   * Dispose of store resources (close connections, etc.)
   */
  dispose(): Promise<void>;
}

/**
 * Base validation logic shared across implementations
 */
export function validateTokenCommon(
  token: InitialAccessToken | undefined,
  requestedToken: string
): TokenValidationResult {
  if (!token) {
    logger.warn('Token validation failed: token not found', { requestedToken });
    return {
      valid: false,
      reason: 'Token not found',
    };
  }

  if (token.revoked) {
    logger.warn('Token validation failed: token revoked', { tokenId: token.id });
    return {
      valid: false,
      reason: 'Token has been revoked',
    };
  }

  const now = Math.floor(Date.now() / 1000);
  if (token.expires_at > 0 && token.expires_at < now) {
    logger.warn('Token validation failed: token expired', { tokenId: token.id, expiresAt: token.expires_at });
    return {
      valid: false,
      reason: 'Token has expired',
    };
  }

  if (token.max_uses && token.max_uses > 0 && token.usage_count >= token.max_uses) {
    logger.warn('Token validation failed: max uses exceeded', { tokenId: token.id, maxUses: token.max_uses, usageCount: token.usage_count });
    return {
      valid: false,
      reason: 'Token usage limit exceeded',
    };
  }

  return {
    valid: true,
    token,
  };
}

/**
 * Filter tokens based on revoked/expired status
 * Shared utility to eliminate code duplication in listTokens implementations
 */
export function filterTokens(
  tokens: InitialAccessToken[],
  options?: {
    includeRevoked?: boolean;
    includeExpired?: boolean;
  }
): InitialAccessToken[] {
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

/**
 * Check if token should be cleaned up
 * Shared utility to eliminate code duplication in cleanup implementations
 */
export function shouldCleanupToken(token: InitialAccessToken, now: number): boolean {
  // Remove expired tokens
  if (token.expires_at > 0 && token.expires_at < now) {
    return true;
  }

  // Remove revoked tokens
  if (token.revoked) {
    return true;
  }

  // Remove tokens that have exceeded max uses
  if (token.max_uses && token.max_uses > 0 && token.usage_count >= token.max_uses) {
    return true;
  }

  return false;
}

/**
 * Create initial access token data structure
 * Shared utility to eliminate token creation duplication across implementations
 */
export function createTokenData(options: CreateTokenOptions): InitialAccessToken {
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const now = Math.floor(Date.now() / 1000);

  return {
    id,
    token,
    description: options.description,
    created_at: now,
    expires_at: options.expires_in ? now + options.expires_in : 0,
    usage_count: 0,
    max_uses: options.max_uses,
    revoked: false,
  };
}