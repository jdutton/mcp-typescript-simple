/**
 * PKCE (Proof Key for Code Exchange) store interface
 *
 * Stores authorization code → code_verifier mappings for OAuth 2.0 PKCE flows.
 * Must be implemented with distributed storage (Redis) for multi-instance deployments.
 */

export interface PKCEData {
  codeVerifier: string;
  state: string;
}

export interface PKCEStore {
  /**
   * Store code_verifier and state for an authorization code
   * @param code - Authorization code from OAuth provider
   * @param data - PKCE data (code_verifier and state)
   * @param ttlSeconds - Time to live in seconds (default: 600 = 10 minutes)
   */
  storeCodeVerifier(code: string, data: PKCEData, ttlSeconds?: number): Promise<void>;

  /**
   * Retrieve code_verifier and state for an authorization code
   * @param code - Authorization code from OAuth provider
   * @returns PKCE data if found, null otherwise
   */
  getCodeVerifier(code: string): Promise<PKCEData | null>;

  /**
   * Atomically retrieve and delete code_verifier and state for an authorization code
   * Prevents authorization code reuse attacks
   * @param code - Authorization code from OAuth provider
   * @returns PKCE data if found, null otherwise
   */
  getAndDeleteCodeVerifier(code: string): Promise<PKCEData | null>;

  /**
   * Check if a code_verifier exists for an authorization code
   * @param code - Authorization code from OAuth provider
   * @returns true if code_verifier exists, false otherwise
   */
  hasCodeVerifier(code: string): Promise<boolean>;

  /**
   * Delete code_verifier and state for an authorization code
   * @param code - Authorization code from OAuth provider
   */
  deleteCodeVerifier(code: string): Promise<void>;
}
