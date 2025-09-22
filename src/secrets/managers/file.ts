/**
 * File-based secret manager (.env files)
 */

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { SecretManager } from '../types.js';

export class FileSecretManager implements SecretManager {
  private envCache: Map<string, string> = new Map();
  private loaded = false;

  constructor(private envPath: string = '.env') {}

  async getSecret(key: string): Promise<string> {
    if (!this.loaded) {
      await this.loadEnvFile();
    }

    const value = this.envCache.get(key);
    if (!value) {
      throw new Error(`Secret ${key} not found in ${this.envPath}`);
    }
    return value;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await readFile(resolve(this.envPath));
      return true;
    } catch {
      return false;
    }
  }

  getName(): string {
    return `File(${this.envPath})`;
  }

  private async loadEnvFile(): Promise<void> {
    try {
      const content = await readFile(resolve(this.envPath), 'utf-8');

      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').replace(/^["']|["']$/g, '');
            this.envCache.set(key.trim(), value);
          }
        }
      }
      this.loaded = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load ${this.envPath}: ${message}`);
    }
  }
}
