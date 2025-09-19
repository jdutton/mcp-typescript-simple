/**
 * Environment variable secret manager
 */

import { SecretManager } from '../types.js';

export class EnvironmentSecretManager implements SecretManager {
  async getSecret(key: string): Promise<string> {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Environment variable ${key} not found`);
    }
    return value;
  }

  async isAvailable(): Promise<boolean> {
    return true; // Environment variables are always available
  }

  getName(): string {
    return 'Environment';
  }
}