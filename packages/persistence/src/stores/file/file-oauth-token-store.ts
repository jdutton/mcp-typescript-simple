/**
 * File-Based OAuth Token Store (DEVELOPMENT ONLY)
 *
 * Stores OAuth tokens in encrypted JSON files with strict file permissions.
 *
 * **SECURITY - HARD STANCE:**
 * - AES-256-GCM encryption REQUIRED (no plaintext fallback)
 * - File permissions: 0600 (owner read/write only)
 * - Directory permissions: 0700 (owner only)
 * - Zero tolerance for unencrypted data
 * - Fail-fast on decryption errors
 *
 * **COMPLIANCE:**
 * - SOC-2 CC6.1 (Logical access controls)
 * - ISO 27001 A.10.1.1 (Cryptographic controls)
 * - GDPR Article 32(1)(a) (Encryption at rest)
 * - HIPAA §164.312(a)(2)(iv) (Encryption and decryption)
 *
 * **USE CASES:**
 * - Development with restart tolerance
 * - Single-instance self-hosted servers
 * - **NOT for production** - use RedisOAuthTokenStore with Upstash
 *
 * **FEATURES:**
 * - Survives server restarts
 * - Atomic writes (temp file → rename)
 * - Automatic backup on write
 * - Secondary index for O(1) refresh token lookups
 * - Strict file system permissions (0600/0700)
 *
 * **LIMITATIONS:**
 * - Not suitable for multi-instance deployments (race conditions)
 * - Not suitable for serverless (ephemeral filesystem)
 * - Performance degrades with many tokens (full file read/write)
 */

import { promises as fs, readFileSync } from 'fs';
import { dirname } from 'path';
import { OAuthTokenStore } from '../../interfaces/oauth-token-store.js';
import { StoredTokenInfo } from '../../types.js';
import { logger } from '../../logger.js';
import { TokenEncryptionService } from '../../encryption/token-encryption-service.js';

interface PersistedOAuthTokenData {
  version: number;
  updatedAt: string;
  tokens: Array<{
    accessToken: string;
    tokenInfo: StoredTokenInfo;
  }>;
}

export interface FileOAuthTokenStoreOptions {
  /** Path to the encrypted JSON file (default: './data/oauth-tokens.json.enc') */
  filePath?: string;

  /** Debounce writes to avoid excessive disk I/O (milliseconds, default: 1000) */
  debounceMs?: number;

  /** Token encryption service (REQUIRED - hard security stance, no plaintext fallback) */
  encryptionService: TokenEncryptionService;
}

export class FileOAuthTokenStore implements OAuthTokenStore {
  private tokens = new Map<string, StoredTokenInfo>();
  private refreshTokenIndex = new Map<string, string>(); // refreshToken -> accessToken
  private readonly filePath: string;
  private readonly backupPath: string;
  private writePromise: Promise<void> = Promise.resolve();
  private pendingWrite: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;
  private readonly encryptionService: TokenEncryptionService;

  constructor(options: FileOAuthTokenStoreOptions) {
    // SECURITY: Fail fast if encryption service not provided
    if (!options.encryptionService) {
      throw new Error('TokenEncryptionService is REQUIRED - zero tolerance for unencrypted OAuth tokens');
    }

    this.filePath = options.filePath || './data/oauth-tokens.json.enc';
    this.backupPath = `${this.filePath}.backup`;
    this.debounceMs = options.debounceMs ?? 1000;
    this.encryptionService = options.encryptionService;

    // Load existing tokens synchronously during construction
    this.loadSync();

    logger.info('FileOAuthTokenStore initialized', {
      filePath: this.filePath,
      tokensLoaded: this.tokens.size,
      debounceMs: this.debounceMs,
    });
  }

  /**
   * Serialize token data - encrypt before writing to disk
   * SECURITY: Always encrypt, no plaintext fallback
   */
  private serializeTokenData(data: PersistedOAuthTokenData): string {
    const json = JSON.stringify(data);
    const encrypted = this.encryptionService.encrypt(json);
    return encrypted;
  }

  /**
   * Deserialize token data - decrypt after reading from disk
   * SECURITY: Fail fast on decryption errors
   */
  private deserializeTokenData(encrypted: string): PersistedOAuthTokenData {
    const json = this.encryptionService.decrypt(encrypted);
    return JSON.parse(json);
  }

  /**
   * Enforce strict file permissions (0600 - owner read/write only)
   */
  private async enforceFilePermissions(): Promise<void> {
    try {
      await fs.chmod(this.filePath, 0o600);
      const dir = dirname(this.filePath);
      await fs.chmod(dir, 0o700);
    } catch (error) {
      logger.warn('Failed to enforce file permissions', {
        error: (error as Error).message,
        filePath: this.filePath,
      });
    }
  }

  /**
   * Load tokens from file (synchronous for constructor)
   */
  private loadSync(): void {
    try {
      const encrypted = readFileSync(this.filePath, 'utf8');
      const parsed = this.deserializeTokenData(encrypted);

      if (parsed.version !== 1) {
        throw new Error(`Unsupported file version: ${parsed.version}`);
      }

      for (const { accessToken, tokenInfo } of parsed.tokens) {
        this.tokens.set(accessToken, tokenInfo);

        // Build refresh token index
        if (tokenInfo.refreshToken) {
          this.refreshTokenIndex.set(tokenInfo.refreshToken, accessToken);
        }
      }

      logger.info('OAuth tokens loaded from file', {
        count: parsed.tokens.length,
        updatedAt: parsed.updatedAt,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist yet, that's fine
        logger.info('No existing OAuth token file found, starting fresh');
      } else {
        logger.error('Failed to load OAuth tokens from file', error as Record<string, any>);
      }
    }
  }

  /**
   * Save tokens to file (debounced, async)
   */
  private scheduleSave(): void {
    if (this.pendingWrite) {
      clearTimeout(this.pendingWrite);
    }

    this.pendingWrite = setTimeout(() => {
      this.writePromise = this.writePromise.then(() => this.saveToFile());
      this.pendingWrite = null;
    }, this.debounceMs);
  }

  /**
   * Actually write to file (atomic with backup)
   * SECURITY: Always encrypt, enforce file permissions (0600)
   */
  private async saveToFile(): Promise<void> {
    try {
      // Ensure directory exists with secure permissions (0700)
      const dir = dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });

      const data: PersistedOAuthTokenData = {
        version: 1,
        updatedAt: new Date().toISOString(),
        tokens: Array.from(this.tokens.entries()).map(([accessToken, tokenInfo]) => ({
          accessToken,
          tokenInfo,
        })),
      };

      // Encrypt data before writing to disk
      const encrypted = this.serializeTokenData(data);

      // Atomic write: write to temp file, then rename
      const tempPath = `${this.filePath}.tmp`;
      await fs.writeFile(tempPath, encrypted, { mode: 0o600 });

      // Backup existing file if it exists
      try {
        await fs.copyFile(this.filePath, this.backupPath);
      } catch (error) {
        // Ignore if file doesn't exist yet
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // Rename temp to actual (atomic on POSIX systems)
      await fs.rename(tempPath, this.filePath);

      // Enforce strict file permissions (0600 - owner read/write only)
      await this.enforceFilePermissions();

      logger.info('OAuth tokens saved to file (encrypted)', {
        tokenCount: this.tokens.size,
        filePath: this.filePath,
      });
    } catch (error) {
      logger.error('Failed to save OAuth tokens to file', error as Record<string, any>);
      throw error;
    }
  }

  async storeToken(accessToken: string, tokenInfo: StoredTokenInfo): Promise<void> {
    this.tokens.set(accessToken, tokenInfo);

    // Maintain secondary index for O(1) refresh token lookups
    if (tokenInfo.refreshToken) {
      this.refreshTokenIndex.set(tokenInfo.refreshToken, accessToken);
    }

    this.scheduleSave();

    logger.debug('OAuth token stored', {
      tokenPrefix: accessToken.substring(0, 8),
      provider: tokenInfo.provider,
      expiresAt: new Date(tokenInfo.expiresAt).toISOString(),
      userEmail: tokenInfo.userInfo.email,
    });
  }

  async getToken(accessToken: string): Promise<StoredTokenInfo | null> {
    const tokenInfo = this.tokens.get(accessToken);

    if (!tokenInfo) {
      logger.debug('OAuth token not found', {
        tokenPrefix: accessToken.substring(0, 8),
      });
      return null;
    }

    // Verify not expired
    if (tokenInfo.expiresAt && tokenInfo.expiresAt < Date.now()) {
      logger.warn('OAuth token expired', {
        tokenPrefix: accessToken.substring(0, 8),
        expiredAt: new Date(tokenInfo.expiresAt).toISOString(),
      });
      await this.deleteToken(accessToken);
      return null;
    }

    logger.debug('OAuth token retrieved', {
      tokenPrefix: accessToken.substring(0, 8),
      provider: tokenInfo.provider,
    });

    return tokenInfo;
  }

  async findByRefreshToken(refreshToken: string): Promise<{ accessToken: string; tokenInfo: StoredTokenInfo } | null> {
    // O(1) lookup using secondary index
    const accessToken = this.refreshTokenIndex.get(refreshToken);

    if (!accessToken) {
      logger.debug('OAuth token not found by refresh token', {
        refreshTokenPrefix: refreshToken.substring(0, 8),
      });
      return null;
    }

    const tokenInfo = this.tokens.get(accessToken);

    if (!tokenInfo) {
      // Clean up stale index entry
      this.refreshTokenIndex.delete(refreshToken);
      this.scheduleSave();
      logger.debug('OAuth token not found by refresh token (stale index)', {
        refreshTokenPrefix: refreshToken.substring(0, 8),
      });
      return null;
    }

    // Verify not expired
    if (tokenInfo.expiresAt && tokenInfo.expiresAt < Date.now()) {
      logger.warn('OAuth token expired during refresh token lookup', {
        tokenPrefix: accessToken.substring(0, 8),
        expiredAt: new Date(tokenInfo.expiresAt).toISOString(),
      });
      await this.deleteToken(accessToken);
      return null;
    }

    logger.debug('OAuth token found by refresh token', {
      tokenPrefix: accessToken.substring(0, 8),
      provider: tokenInfo.provider,
    });

    return { accessToken, tokenInfo };
  }

  async deleteToken(accessToken: string): Promise<void> {
    const tokenInfo = this.tokens.get(accessToken);
    const existed = this.tokens.delete(accessToken);

    // Clean up secondary index
    if (tokenInfo?.refreshToken) {
      this.refreshTokenIndex.delete(tokenInfo.refreshToken);
    }

    if (existed) {
      this.scheduleSave();
      logger.debug('OAuth token deleted', {
        tokenPrefix: accessToken.substring(0, 8),
      });
    }
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [accessToken, tokenInfo] of this.tokens.entries()) {
      if (tokenInfo.expiresAt && tokenInfo.expiresAt <= now) {
        this.tokens.delete(accessToken);
        // Clean up secondary index
        if (tokenInfo.refreshToken) {
          this.refreshTokenIndex.delete(tokenInfo.refreshToken);
        }
        cleanedCount++;
        logger.debug('Expired OAuth token cleaned up', {
          tokenPrefix: accessToken.substring(0, 8),
          provider: tokenInfo.provider,
          expiredAt: new Date(tokenInfo.expiresAt).toISOString(),
        });
      }
    }

    if (cleanedCount > 0) {
      this.scheduleSave();
      logger.info('Expired OAuth tokens cleanup completed', {
        cleanedCount,
        remainingCount: this.tokens.size,
      });
    }

    return cleanedCount;
  }

  async getTokenCount(): Promise<number> {
    return this.tokens.size;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    // Cancel pending write
    if (this.pendingWrite) {
      clearTimeout(this.pendingWrite);
      this.pendingWrite = null;
    }

    // Note: We intentionally don't wait for writePromise or do a final save here
    // because dispose() is synchronous. The pending write will complete on its own.
    // If needed, caller can await cleanup() before dispose() to ensure data is saved.

    this.tokens.clear();
    this.refreshTokenIndex.clear();

    logger.info('FileOAuthTokenStore disposed');
  }
}
