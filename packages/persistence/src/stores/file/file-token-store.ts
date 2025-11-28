/**
 * File-Based Initial Access Token Store (Development Only)
 *
 * **SECURITY STANCE:** Hard security - encryption REQUIRED, no plaintext fallback.
 * Zero tolerance for unencrypted data. Supports SOC-2, ISO 27001, GDPR, HIPAA compliance.
 *
 * **Encryption:**
 * - AES-256-GCM encryption at rest
 * - Cryptographically secure random IVs (NIST SP 800-90A)
 * - Authentication tags for integrity verification
 * - Format: `iv:ciphertext:authTag` (base64url)
 *
 * **File Permissions:**
 * - 0600 (owner read/write only) for token files
 * - 0700 (owner only) for directories
 *
 * Suitable for:
 * - Local development with restart tolerance
 * - Single-instance deployments (NOT production - use Redis)
 * - Self-hosted servers with local filesystem
 *
 * Features:
 * - Survives server restarts
 * - Atomic writes (write to temp file, then rename)
 * - Automatic backup on write
 * - Encrypted storage format
 *
 * Limitations:
 * - **DEVELOPMENT ONLY** - NOT suitable for production (use Redis)
 * - Not suitable for multi-instance deployments (race conditions)
 * - Not suitable for serverless (ephemeral filesystem)
 * - Performance degrades with many tokens (full file read/write)
 */

/* eslint-disable security/detect-non-literal-fs-filename -- File store requires dynamic file paths for persistence */

import { promises as fs, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  InitialAccessTokenStore,
  InitialAccessToken,
  CreateTokenOptions,
  TokenValidationResult,
  validateTokenCommon,
  filterTokens,
  shouldCleanupToken,
  createTokenData,
} from '../../interfaces/token-store.js';
import { TokenEncryptionService } from '../../encryption/token-encryption-service.js';
import { logger } from '../../logger.js';

interface PersistedTokenData {
  version: number;
  updatedAt: string;
  tokens: InitialAccessToken[];
}

export interface FileTokenStoreOptions {
  /** Path to the encrypted JSON file (default: './data/access-tokens.json.enc') */
  filePath?: string;

  /** Debounce writes to avoid excessive disk I/O (milliseconds, default: 1000) */
  debounceMs?: number;

  /** Token encryption service (REQUIRED - no plaintext storage) */
  encryptionService: TokenEncryptionService;
}

export class FileTokenStore implements InitialAccessTokenStore {
  private tokens = new Map<string, InitialAccessToken>();
  private tokensByValue = new Map<string, InitialAccessToken>();
  private readonly filePath: string;
  private readonly backupPath: string;
  private writePromise: Promise<void> = Promise.resolve();
  private pendingWrite: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;
  private readonly encryptionService: TokenEncryptionService;

  constructor(options: FileTokenStoreOptions) {
    // SECURITY: Encryption service is REQUIRED - no plaintext storage
    if (!options.encryptionService) {
      throw new Error(
        'FileTokenStore requires encryptionService - plaintext token storage is not allowed'
      );
    }

    this.filePath = options.filePath ?? './data/access-tokens.json.enc';
    this.backupPath = `${this.filePath}.backup`;
    this.debounceMs = options.debounceMs ?? 1000;
    this.encryptionService = options.encryptionService;

    // Load existing tokens synchronously during construction
    this.loadSync();

    logger.info('FileTokenStore initialized', {
      filePath: this.filePath,
      tokensLoaded: this.tokens.size,
      debounceMs: this.debounceMs,
      encrypted: true,
    });
  }

  /**
   * Serialize and encrypt token data for file storage
   */
  private serializeTokenData(tokens: InitialAccessToken[]): string {
    const data: PersistedTokenData = {
      version: 1,
      updatedAt: new Date().toISOString(),
      tokens,
    };
    const json = JSON.stringify(data);
    return this.encryptionService.encrypt(json);
  }

  /**
   * Decrypt and deserialize token data from file storage
   */
  private deserializeTokenData(encrypted: string): PersistedTokenData {
    const json = this.encryptionService.decrypt(encrypted);
    return JSON.parse(json);
  }

  /**
   * Enforce strict file permissions (0600 - owner read/write only)
   */
  private async enforceFilePermissions(filePath: string): Promise<void> {
    try {
      await fs.chmod(filePath, 0o600);
      logger.debug('File permissions set to 0600', { filePath });
    } catch (error) {
      logger.error('Failed to set file permissions', {
        filePath,
        error: error as Record<string, unknown>,
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

      for (const token of parsed.tokens) {
        this.tokens.set(token.id, token);
        this.tokensByValue.set(token.token, token);
      }

      logger.info('Tokens loaded from encrypted file', {
        count: parsed.tokens.length,
        updatedAt: parsed.updatedAt,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist yet, that's fine
        logger.info('No existing token file found, starting fresh');
      } else {
        logger.error('Failed to load tokens from file', error as Record<string, unknown>);
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
   * Actually write to file (atomic with backup, encrypted, strict permissions)
   */
  private async saveToFile(): Promise<void> {
    try {
      // Ensure directory exists with secure permissions (0700)
      const dir = dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });

      // Serialize and encrypt token data
      const tokens = Array.from(this.tokens.values());
      const encrypted = this.serializeTokenData(tokens);

      // Atomic write: write to temp file, then rename
      const tempPath = `${this.filePath}.tmp`;
      await fs.writeFile(tempPath, encrypted, 'utf8');
      await this.enforceFilePermissions(tempPath);

      // Backup existing file if it exists
      try {
        await fs.copyFile(this.filePath, this.backupPath);
        await this.enforceFilePermissions(this.backupPath);
      } catch (error) {
        // Ignore if file doesn't exist yet
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // Rename temp to actual (atomic on POSIX systems)
      await fs.rename(tempPath, this.filePath);
      await this.enforceFilePermissions(this.filePath);

      logger.info('Tokens saved to encrypted file', {
        tokenCount: this.tokens.size,
        filePath: this.filePath,
        permissions: '0600',
      });
    } catch (error) {
      logger.error('Failed to save tokens to file', error as Record<string, unknown>);
      throw error;
    }
  }

  async createToken(options: CreateTokenOptions): Promise<InitialAccessToken> {
    const tokenData = createTokenData(options);

    this.tokens.set(tokenData.id, tokenData);
    this.tokensByValue.set(tokenData.token, tokenData);

    this.scheduleSave();

    logger.info('Initial access token created', {
      tokenId: tokenData.id,
      description: options.description,
      expiresAt: tokenData.expires_at === 0 ? 'never' : new Date(tokenData.expires_at * 1000).toISOString(),
      maxUses: options.max_uses ?? 'unlimited',
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
        maxUses: result.token.max_uses ?? 'unlimited',
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
    const allTokens = Array.from(this.tokens.values());
    return filterTokens(allTokens, options);
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
      if (shouldCleanupToken(token, now)) {
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