/**
 * OAuth 2.0 Dynamic Client Registration (RFC 7591) Client Store Interface
 *
 * This interface defines the contract for storing and retrieving dynamically
 * registered OAuth clients. Implementations can use various backends:
 * - In-memory (development, testing)
 * - File-based (development with persistence)
 * - Redis (production, serverless)
 */

import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

/**
 * Storage interface for dynamically registered OAuth clients
 *
 * Implementations MUST handle:
 * - Thread-safe operations (concurrent reads/writes)
 * - Client secret expiration (check client_secret_expires_at)
 * - Unique client_id generation (typically UUID v4)
 */
export interface OAuthRegisteredClientsStore {
  /**
   * Register a new OAuth client dynamically
   *
   * @param client - Client metadata (without client_id, will be auto-generated)
   * @returns Full client information including generated client_id and client_secret
   *
   * Implementation notes:
   * - Generate secure client_id (UUID v4 recommended)
   * - Generate cryptographically secure client_secret (32+ bytes)
   * - Set client_id_issued_at to current timestamp
   * - Set client_secret_expires_at if expiry is configured
   * - Validate redirect_uris (no wildcards in production)
   * - Store client metadata for future retrieval
   */
  registerClient(
    _client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>
  ): Promise<OAuthClientInformationFull>;

  /**
   * Retrieve a registered OAuth client by client_id
   *
   * @param clientId - The client identifier
   * @returns Full client information, or undefined if not found
   *
   * Implementation notes:
   * - Return undefined (not null) if client doesn't exist
   * - Do NOT automatically delete expired secrets (let middleware handle)
   * - Include all metadata fields for validation
   */
  getClient(_clientId: string): Promise<OAuthClientInformationFull | undefined>;

  /**
   * Delete a registered OAuth client
   *
   * @param clientId - The client identifier to delete
   * @returns true if client was deleted, false if not found
   *
   * Optional method for client cleanup/revocation
   */
  deleteClient?(_clientId: string): Promise<boolean>;

  /**
   * List all registered clients (admin/debugging)
   *
   * @returns Array of all registered clients
   *
   * Optional method for admin UI, should include expired clients
   */
  listClients?(): Promise<OAuthClientInformationFull[]>;

  /**
   * Clean up expired client secrets
   *
   * @returns Number of clients cleaned up
   *
   * Optional method for background cleanup jobs
   */
  cleanupExpired?(): Promise<number>;
}

/**
 * Extended client information with internal metadata
 *
 * Additional fields beyond RFC 7591 spec for operational tracking
 */
export interface ExtendedOAuthClientInformation extends OAuthClientInformationFull {
  /** Registration type (public or trusted) */
  registration_type?: 'public' | 'trusted';

  /** Timestamp when client was registered */
  registered_at?: number;

  /** Endpoint used for registration (/register or /admin/register) */
  registered_via?: string;

  /** Initial access token used (for audit trail) */
  initial_access_token_used?: string;

  /** Maximum allowed scopes for this client */
  max_scopes?: string[];

  /** Whether this is a trusted client (less restrictions) */
  trusted?: boolean;

  /** Last time this client was used */
  last_used_at?: number;

  /** IP address of registration request */
  registration_ip?: string;

  /** User agent of registration request */
  registration_user_agent?: string;
}

/**
 * Configuration options for client stores
 */
export interface ClientStoreOptions {
  /** Default client secret expiry in seconds (0 = no expiry) */
  defaultSecretExpirySeconds?: number;

  /** Enable automatic cleanup of expired clients */
  enableAutoCleanup?: boolean;

  /** Cleanup interval in milliseconds */
  cleanupIntervalMs?: number;

  /** Maximum number of clients to store (prevent unbounded growth) */
  maxClients?: number;
}

/**
 * Store type identifier for factory selection
 */
export type ClientStoreType =
  | 'memory'      // In-memory only (lost on restart)
  | 'file'        // File-based persistence (single instance)
  | 'redis'       // Redis (multi-instance, production)
  | 'auto';       // Auto-detect based on environment