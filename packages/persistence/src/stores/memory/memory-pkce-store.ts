/**
 * In-memory PKCE store implementation
 *
 * IMPORTANT: This is for TESTING ONLY and should NEVER be used in production.
 * Multi-instance deployments (Vercel, Kubernetes, AWS Lambda) MUST use RedisPKCEStore.
 */

import { PKCEStore, PKCEData } from '../../interfaces/pkce-store.js';
import { logger } from '../../logger.js';

export class MemoryPKCEStore implements PKCEStore {
  private store: Map<string, PKCEData> = new Map();

  async storeCodeVerifier(code: string, data: PKCEData, ttlSeconds: number = 600): Promise<void> {
    this.store.set(code, data);

    // Simulate TTL with setTimeout
    setTimeout(() => {
      this.store.delete(code);
      logger.oauthDebug?.('PKCE data expired (memory store)', {
        codePrefix: code.substring(0, 10)
      });
    }, ttlSeconds * 1000);

    logger.oauthDebug?.('Stored PKCE data in memory', {
      codePrefix: code.substring(0, 10),
      codeVerifierPrefix: data.codeVerifier.substring(0, 10),
      statePrefix: data.state.substring(0, 8),
      ttl: ttlSeconds
    });
  }

  async getCodeVerifier(code: string): Promise<PKCEData | null> {
    const data = this.store.get(code);

    if (!data) {
      logger.oauthDebug?.('PKCE data not found in memory', {
        codePrefix: code.substring(0, 10)
      });
      return null;
    }

    logger.oauthDebug?.('Retrieved PKCE data from memory', {
      codePrefix: code.substring(0, 10),
      codeVerifierPrefix: data.codeVerifier.substring(0, 10),
      statePrefix: data.state.substring(0, 8)
    });

    return data;
  }

  async getAndDeleteCodeVerifier(code: string): Promise<PKCEData | null> {
    const data = this.store.get(code);

    if (!data) {
      logger.oauthWarn?.('PKCE data not found during atomic retrieval (possible code reuse attack)', {
        codePrefix: code.substring(0, 10)
      });
      return null;
    }

    this.store.delete(code);

    logger.oauthDebug?.('Atomically retrieved and deleted PKCE data from memory', {
      codePrefix: code.substring(0, 10),
      codeVerifierPrefix: data.codeVerifier.substring(0, 10),
      statePrefix: data.state.substring(0, 8)
    });

    return data;
  }

  async hasCodeVerifier(code: string): Promise<boolean> {
    const exists = this.store.has(code);

    logger.oauthDebug?.('Checked PKCE data existence in memory', {
      codePrefix: code.substring(0, 10),
      exists
    });

    return exists;
  }

  async deleteCodeVerifier(code: string): Promise<void> {
    this.store.delete(code);

    logger.oauthDebug?.('Deleted PKCE data from memory', {
      codePrefix: code.substring(0, 10)
    });
  }

  /**
   * Clear all stored PKCE data (testing only)
   * @internal
   */
  async clear(): Promise<void> {
    this.store.clear();
    logger.oauthDebug?.('Cleared all PKCE data from memory');
  }

  /**
   * Get store size (testing only)
   * @internal
   */
  get size(): number {
    return this.store.size;
  }
}
