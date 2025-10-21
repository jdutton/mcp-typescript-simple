/**
 * File-Based OAuth Token Store
 *
 * Persists OAuth access/refresh tokens to a JSON file on disk. Suitable for:
 * - Development with restart tolerance
 * - Single-instance deployments
 * - Self-hosted servers with local filesystem
 *
 * Features:
 * - Survives server restarts
 * - Atomic writes (write to temp file, then rename)
 * - Automatic backup on write
 * - JSON format for easy inspection/debugging
 * - Secondary index for O(1) refresh token lookups
 *
 * Limitations:
 * - Not suitable for multi-instance deployments (race conditions)
 * - Not suitable for serverless (ephemeral filesystem)
 * - Performance degrades with many tokens (full file read/write)
 */

import { promises as fs, readFileSync } from 'fs';
import { dirname } from 'path';
import { OAuthTokenStore } from '../../interfaces/oauth-token-store.js';
import { StoredTokenInfo } from '../../types.js';
import { logger } from '../../logger.js';

interface PersistedOAuthTokenData {
  version: number;
  updatedAt: string;
  tokens: Array<{
    accessToken: string;
    tokenInfo: StoredTokenInfo;
  }>;
}

export interface FileOAuthTokenStoreOptions {
  /** Path to the JSON file (default: './data/oauth-tokens.json') */
  filePath?: string;

  /** Debounce writes to avoid excessive disk I/O (milliseconds, default: 1000) */
  debounceMs?: number;
}

export class FileOAuthTokenStore implements OAuthTokenStore {
  private tokens = new Map<string, StoredTokenInfo>();
  private refreshTokenIndex = new Map<string, string>(); // refreshToken -> accessToken
  private readonly filePath: string;
  private readonly backupPath: string;
  private writePromise: Promise<void> = Promise.resolve();
  private pendingWrite: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;

  constructor(options: FileOAuthTokenStoreOptions = {}) {
    this.filePath = options.filePath || './data/oauth-tokens.json';
    this.backupPath = `${this.filePath}.backup`;
    this.debounceMs = options.debounceMs ?? 1000;

    // Load existing tokens synchronously during construction
    this.loadSync();

    logger.info('FileOAuthTokenStore initialized', {
      filePath: this.filePath,
      tokensLoaded: this.tokens.size,
      debounceMs: this.debounceMs,
    });
  }

  /**
   * Load tokens from file (synchronous for constructor)
   */
  private loadSync(): void {
    try {
      const data = readFileSync(this.filePath, 'utf8');
      const parsed: PersistedOAuthTokenData = JSON.parse(data);

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
   */
  private async saveToFile(): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(dirname(this.filePath), { recursive: true });

      const data: PersistedOAuthTokenData = {
        version: 1,
        updatedAt: new Date().toISOString(),
        tokens: Array.from(this.tokens.entries()).map(([accessToken, tokenInfo]) => ({
          accessToken,
          tokenInfo,
        })),
      };

      const json = JSON.stringify(data, null, 2);

      // Atomic write: write to temp file, then rename
      const tempPath = `${this.filePath}.tmp`;
      await fs.writeFile(tempPath, json, 'utf8');

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

      logger.info('OAuth tokens saved to file', {
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
