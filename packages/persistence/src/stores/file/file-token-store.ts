/**
 * File-Based Initial Access Token Store
 *
 * Persists tokens to a JSON file on disk. Suitable for:
 * - Development with restart tolerance
 * - Single-instance deployments
 * - Self-hosted servers with local filesystem
 *
 * Features:
 * - Survives server restarts
 * - Atomic writes (write to temp file, then rename)
 * - Automatic backup on write
 * - JSON format for easy inspection/debugging
 *
 * Limitations:
 * - Not suitable for multi-instance deployments (race conditions)
 * - Not suitable for serverless (ephemeral filesystem)
 * - Performance degrades with many tokens (full file read/write)
 */

import { promises as fs, readFileSync } from 'fs';
import { dirname } from 'path';
import { randomBytes, randomUUID } from 'crypto';
import {
  InitialAccessTokenStore,
  InitialAccessToken,
  CreateTokenOptions,
  TokenValidationResult,
  validateTokenCommon,
} from '../../interfaces/token-store.js';
import { logger } from '../../logger.js';

interface PersistedTokenData {
  version: number;
  updatedAt: string;
  tokens: InitialAccessToken[];
}

export interface FileTokenStoreOptions {
  /** Path to the JSON file (default: './data/access-tokens.json') */
  filePath?: string;

  /** Debounce writes to avoid excessive disk I/O (milliseconds, default: 1000) */
  debounceMs?: number;
}

export class FileTokenStore implements InitialAccessTokenStore {
  private tokens = new Map<string, InitialAccessToken>();
  private tokensByValue = new Map<string, InitialAccessToken>();
  private readonly filePath: string;
  private readonly backupPath: string;
  private writePromise: Promise<void> = Promise.resolve();
  private pendingWrite: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;

  constructor(options: FileTokenStoreOptions = {}) {
    this.filePath = options.filePath || './data/access-tokens.json';
    this.backupPath = `${this.filePath}.backup`;
    this.debounceMs = options.debounceMs ?? 1000;

    // Load existing tokens synchronously during construction
    this.loadSync();

    logger.info('FileTokenStore initialized', {
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
      const parsed: PersistedTokenData = JSON.parse(data);

      if (parsed.version !== 1) {
        throw new Error(`Unsupported file version: ${parsed.version}`);
      }

      for (const token of parsed.tokens) {
        this.tokens.set(token.id, token);
        this.tokensByValue.set(token.token, token);
      }

      logger.info('Tokens loaded from file', {
        count: parsed.tokens.length,
        updatedAt: parsed.updatedAt,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist yet, that's fine
        logger.info('No existing token file found, starting fresh');
      } else {
        logger.error('Failed to load tokens from file', error as Record<string, any>);
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

      const data: PersistedTokenData = {
        version: 1,
        updatedAt: new Date().toISOString(),
        tokens: Array.from(this.tokens.values()),
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

      logger.info('Tokens saved to file', {
        tokenCount: this.tokens.size,
        filePath: this.filePath,
      });
    } catch (error) {
      logger.error('Failed to save tokens to file', error as Record<string, any>);
      throw error;
    }
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

    this.scheduleSave();

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

      this.scheduleSave();

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
    this.scheduleSave();

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
    this.scheduleSave();

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
      this.scheduleSave();
      logger.info('Token cleanup completed', { cleanedCount: cleaned });
    }

    return cleaned;
  }

  async dispose(): Promise<void> {
    // Cancel pending write
    if (this.pendingWrite) {
      clearTimeout(this.pendingWrite);
      this.pendingWrite = null;
    }

    // Wait for any in-progress write to complete
    await this.writePromise;

    // Final save
    if (this.tokens.size > 0) {
      await this.saveToFile();
    }

    this.tokens.clear();
    this.tokensByValue.clear();

    logger.info('FileTokenStore disposed');
  }
}