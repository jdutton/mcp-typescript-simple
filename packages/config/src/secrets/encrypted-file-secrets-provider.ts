/**
 * Encrypted File Secrets Provider
 *
 * Vault-like encrypted secrets storage for local development.
 * Stores secrets encrypted at rest in a JSON file, providing a secure
 * alternative to plaintext .env files.
 *
 * Use Cases:
 * - Local development with encryption at rest
 * - Practice encryption key management
 * - Smooth transition to Vault (same security model)
 * - Single-developer projects needing encryption
 *
 * Security Features:
 * - AES-256-GCM encryption at rest
 * - Secrets never stored in plaintext
 * - Master key stored separately from secrets file
 * - Atomic writes (write to temp, then rename)
 * - Automatic backup on write
 * - OCSF structured audit events via BaseSecretsProvider
 *
 * Setup:
 * ```bash
 * # Generate master encryption key
 * node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 *
 * # Store in environment or separate file
 * export SECRETS_MASTER_KEY="<generated-key>"
 * ```
 *
 * Comparison to FileSecretsProvider:
 * - FileSecretsProvider: Plaintext .env.local (simple, insecure)
 * - EncryptedFileSecretsProvider: Encrypted file (Vault-like, secure)
 * - VaultSecretsProvider: Real Vault server (production-grade)
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { SecretsProviderOptions } from './secrets-provider.js';
import { BaseSecretsProvider } from './base-secrets-provider.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

interface EncryptedSecretsFile {
  version: number;
  updatedAt: string;
  secrets: Record<string, string>; // key -> encrypted value (base64url)
}

export interface EncryptedFileSecretsProviderOptions extends SecretsProviderOptions {
  /**
   * Path to encrypted secrets file (default: '.secrets.encrypted')
   */
  filePath?: string;

  /**
   * Master encryption key (base64-encoded 256-bit key)
   * Default: process.env.SECRETS_MASTER_KEY
   * Generate with: crypto.randomBytes(32).toString('base64')
   */
  masterKey?: string;
}

export class EncryptedFileSecretsProvider extends BaseSecretsProvider {
  readonly name = 'encrypted-file';
  readonly readOnly = false;

  private readonly filePath: string;
  private readonly backupPath: string;
  private readonly masterKey: Buffer;
  private secrets: Record<string, string> = {}; // key -> encrypted value

  constructor(options: EncryptedFileSecretsProviderOptions = {}) {
    super(options);

    this.filePath = options.filePath || '.secrets.encrypted';
    this.backupPath = `${this.filePath}.backup`;

    // Get master key
    const masterKeyB64 = options.masterKey || process.env.SECRETS_MASTER_KEY;
    if (!masterKeyB64) {
      throw new Error(
        'Master encryption key not configured. Set SECRETS_MASTER_KEY environment variable.\n' +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
      );
    }

    this.masterKey = Buffer.from(masterKeyB64, 'base64');
    if (this.masterKey.length !== KEY_LENGTH) {
      throw new Error(
        `Invalid master key length: expected ${KEY_LENGTH} bytes (256 bits), got ${this.masterKey.length} bytes`
      );
    }

    // Load encrypted secrets file (synchronous during construction)
    this.loadSecretsSync();

    this.emitInitializationEvent({
      filePath: this.filePath,
      secretCount: Object.keys(this.secrets).length,
      cacheTtlMs: this.cacheTtlMs,
    });
  }

  /**
   * Load encrypted secrets from file (synchronous for constructor)
   */
  private loadSecretsSync(): void {
    try {
      const data = require('node:fs').readFileSync(this.filePath, 'utf8');
      const parsed: EncryptedSecretsFile = JSON.parse(data);

      if (parsed.version !== 1) {
        throw new Error(`Unsupported file version: ${parsed.version}`);
      }

      this.secrets = parsed.secrets;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist yet, start fresh
      } else {
        throw error;
      }
    }
  }

  /**
   * Encrypt a value using AES-256-GCM
   */
  private encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const encrypted = Buffer.concat([iv, ciphertext, authTag]);
    return encrypted.toString('base64url');
  }

  /**
   * Decrypt a value using AES-256-GCM
   */
  private decrypt(encrypted: string): string {
    const encryptedBuffer = Buffer.from(encrypted, 'base64url');
    const iv = encryptedBuffer.subarray(0, IV_LENGTH);
    const authTag = encryptedBuffer.subarray(encryptedBuffer.length - AUTH_TAG_LENGTH);
    const ciphertext = encryptedBuffer.subarray(IV_LENGTH, encryptedBuffer.length - AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, this.masterKey, iv);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  }

  /**
   * Save encrypted secrets to file (atomic with backup)
   */
  private async saveToFile(): Promise<void> {
    // Ensure directory exists
    await fs.mkdir(dirname(this.filePath), { recursive: true });

    const data: EncryptedSecretsFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      secrets: this.secrets,
    };

    const json = JSON.stringify(data, null, 2);

    // Atomic write: temp file → rename
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, json, 'utf8');

    // Backup existing file
    try {
      await fs.copyFile(this.filePath, this.backupPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    // Atomic rename
    await fs.rename(tempPath, this.filePath);
  }

  protected async retrieveSecret<T = string>(key: string): Promise<T | undefined> {
    // Get encrypted value from file
    const encryptedValue = this.secrets[key];
    if (!encryptedValue) {
      return undefined;
    }

    // Decrypt the value
    try {
      const decrypted = this.decrypt(encryptedValue);

      // Parse JSON if applicable
      let parsedValue: unknown = decrypted;
      if (decrypted.startsWith('{') || decrypted.startsWith('[')) {
        try {
          parsedValue = JSON.parse(decrypted);
        } catch {
          parsedValue = decrypted;
        }
      }

      return parsedValue as T;
    } catch (error) {
      throw new Error('Failed to decrypt secret: invalid key or corrupted data');
    }
  }

  protected async storeSecret<T = string>(key: string, value: T): Promise<void> {
    // Convert to string for encryption
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

    // Encrypt the value
    const encrypted = this.encrypt(stringValue);

    // Store encrypted value
    this.secrets[key] = encrypted;

    // Save to file
    await this.saveToFile();
  }

  async hasSecret(key: string): Promise<boolean> {
    return this.secrets[key] !== undefined;
  }

  protected async disposeResources(): Promise<void> {
    this.secrets = {};
  }

  /**
   * Generate a new master encryption key
   */
  static generateMasterKey(): string {
    return randomBytes(KEY_LENGTH).toString('base64');
  }

  /**
   * Migrate from plaintext .env.local to encrypted secrets file
   */
  static async migrateFromPlaintext(
    envFilePath: string,
    masterKey: string,
    outputPath = '.secrets.encrypted'
  ): Promise<void> {
    const provider = new EncryptedFileSecretsProvider({
      filePath: outputPath,
      masterKey,
    });

    // Read plaintext env file
    const envContent = await fs.readFile(envFilePath, 'utf8');
    const lines = envContent.split('\n');

    let migrated = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const [key, ...valueParts] = trimmed.split('=');
      if (!key || valueParts.length === 0) {
        continue;
      }

      const value = valueParts.join('=').trim().replaceAll(/(^["'])|(["']$)/g, '');
      await provider.setSecret(key.trim(), value);
      migrated++;
    }

    console.log(`Migrated ${migrated} secrets from ${envFilePath} to ${outputPath}`);
    console.log(`Master key (save securely): ${masterKey}`);
  }
}
