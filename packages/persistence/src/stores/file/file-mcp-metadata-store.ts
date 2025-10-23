/**
 * File-Based MCP Session Metadata Store
 *
 * Persists MCP session metadata to a JSON file on disk. Suitable for:
 * - Development with restart tolerance
 * - Single-instance deployments
 * - Self-hosted servers with local filesystem
 *
 * Features:
 * - Survives server restarts
 * - Atomic writes (write to temp file, then rename)
 * - Automatic backup on write
 * - Configurable TTL for testing
 * - JSON format for easy inspection/debugging
 *
 * Limitations:
 * - Not suitable for multi-instance deployments (race conditions)
 * - Not suitable for serverless (ephemeral filesystem)
 * - Performance degrades with many sessions (full file read/write)
 */

import { promises as fs, readFileSync } from 'fs';
import { dirname } from 'path';
import {
  MCPSessionMetadataStore,
  MCPSessionMetadata,
} from '../../interfaces/mcp-metadata-store.js';
import { logger } from '../../logger.js';

interface PersistedSessionData {
  version: number;
  updatedAt: string;
  sessions: MCPSessionMetadata[];
}

const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface FileMCPMetadataStoreOptions {
  /** File path for persistence (default: './data/mcp-sessions.json') */
  filePath?: string;
  /** Session TTL in milliseconds (default: 7 days) */
  ttl?: number;
}

export class FileMCPMetadataStore implements MCPSessionMetadataStore {
  private sessions = new Map<string, MCPSessionMetadata>();
  private readonly filePath: string;
  private readonly backupPath: string;
  private readonly ttl: number;
  private writePromise: Promise<void> = Promise.resolve();

  constructor(options: FileMCPMetadataStoreOptions | string = {}) {
    // Support both new options object and legacy string filePath
    if (typeof options === 'string') {
      this.filePath = options;
      this.ttl = DEFAULT_TTL;
    } else {
      this.filePath = options.filePath || './data/mcp-sessions.json';
      this.ttl = options.ttl ?? DEFAULT_TTL;
    }

    this.backupPath = `${this.filePath}.backup`;

    logger.info('FileMCPMetadataStore initializing', {
      filePath: this.filePath,
      ttl: this.ttl,
    });

    // Load existing sessions synchronously during construction
    this.loadSync();
  }

  /**
   * Load sessions from file (synchronous for constructor)
   */
  private loadSync(): void {
    try {
      const data = readFileSync(this.filePath, 'utf8');
      const parsed: PersistedSessionData = JSON.parse(data);

      if (parsed.version !== 1) {
        throw new Error(`Unsupported file version: ${parsed.version}`);
      }

      for (const session of parsed.sessions) {
        this.sessions.set(session.sessionId, session);
      }

      logger.info('Sessions loaded from file', {
        count: this.sessions.size,
        updatedAt: parsed.updatedAt,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info('No existing session file found, starting fresh');
      } else {
        logger.error('Failed to load sessions from file', error as Record<string, any>);
        throw error;
      }
    }
  }

  /**
   * Save sessions to file (asynchronous, atomic)
   * Made public for caching store sync
   */
  async save(): Promise<void> {
    // Serialize write operations to prevent concurrent writes
    this.writePromise = this.writePromise.then(() => this.doSave());
    return this.writePromise;
  }

  private async doSave(): Promise<void> {
    try {
      // Ensure directory exists
      await fs.mkdir(dirname(this.filePath), { recursive: true });

      // Prepare data
      const data: PersistedSessionData = {
        version: 1,
        updatedAt: new Date().toISOString(),
        sessions: Array.from(this.sessions.values()),
      };

      // Write to temporary file first (atomic write)
      const tempPath = `${this.filePath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');

      // Backup existing file if it exists
      try {
        await fs.copyFile(this.filePath, this.backupPath);
      } catch (error) {
        // Ignore if file doesn't exist yet
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // Rename temp file to actual file (atomic on POSIX systems)
      await fs.rename(tempPath, this.filePath);

      logger.debug('Sessions saved to file', {
        count: this.sessions.size,
        filePath: this.filePath,
      });
    } catch (error) {
      logger.error('Failed to save sessions to file', error as Record<string, any>);
      throw error;
    }
  }

  async storeSession(sessionId: string, metadata: MCPSessionMetadata): Promise<void> {
    // Set expiresAt if not provided
    const sessionMetadata: MCPSessionMetadata = {
      ...metadata,
      expiresAt: metadata.expiresAt || (Date.now() + this.ttl),
    };

    this.sessions.set(sessionId, sessionMetadata);
    await this.save();

    logger.debug('Session stored and persisted', {
      sessionId: sessionId.substring(0, 8) + '...',
      hasAuth: !!sessionMetadata.authInfo,
      expiresAt: new Date(sessionMetadata.expiresAt).toISOString(),
    });
  }

  async getSession(sessionId: string): Promise<MCPSessionMetadata | null> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      logger.debug('Session not found', {
        sessionId: sessionId.substring(0, 8) + '...',
      });
      return null;
    }

    // Check if expired
    const now = Date.now();
    if (now > session.expiresAt) {
      logger.warn('Session expired', {
        sessionId: sessionId.substring(0, 8) + '...',
        expiresAt: new Date(session.expiresAt).toISOString(),
      });
      await this.deleteSession(sessionId);
      return null;
    }

    logger.debug('Session retrieved', {
      sessionId: sessionId.substring(0, 8) + '...',
      hasAuth: !!session.authInfo,
      ttlSeconds: Math.round((session.expiresAt - now) / 1000),
    });

    return session;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const existed = this.sessions.delete(sessionId);

    if (existed) {
      await this.save();
      logger.info('Session deleted and persisted', {
        sessionId: sessionId.substring(0, 8) + '...',
      });
    } else {
      logger.debug('Session delete failed: not found', {
        sessionId: sessionId.substring(0, 8) + '...',
      });
    }
  }

  /**
   * Reload sessions from file (for manual refresh)
   */
  async reload(): Promise<void> {
    try {
      const data = await fs.readFile(this.filePath, 'utf8');
      const parsed: PersistedSessionData = JSON.parse(data);

      if (parsed.version !== 1) {
        throw new Error(`Unsupported file version: ${parsed.version}`);
      }

      this.sessions.clear();
      for (const session of parsed.sessions) {
        this.sessions.set(session.sessionId, session);
      }

      logger.info('Sessions reloaded from file', {
        count: this.sessions.size,
        updatedAt: parsed.updatedAt,
      });
    } catch (error) {
      logger.error('Failed to reload sessions from file', error as Record<string, any>);
      throw error;
    }
  }

  /**
   * Set session directly (internal use only - for caching store sync)
   * @internal
   */
  setSession(sessionId: string, metadata: MCPSessionMetadata): void {
    this.sessions.set(sessionId, metadata);
  }

  /**
   * Get all sessions as readonly map (internal use only - for caching store sync)
   * @internal
   */
  getAllSessions(): ReadonlyMap<string, MCPSessionMetadata> {
    return this.sessions;
  }

  /**
   * Clean up expired sessions
   * @returns Number of sessions cleaned up
   */
  async cleanup(): Promise<number> {
    const now = Date.now();
    const expiredSessions: string[] = [];

    // Find expired sessions
    for (const [sessionId, metadata] of this.sessions) {
      if (now > metadata.expiresAt) {
        expiredSessions.push(sessionId);
      }
    }

    // Remove expired sessions
    for (const sessionId of expiredSessions) {
      this.sessions.delete(sessionId);
    }

    // Save to file if any sessions were removed
    if (expiredSessions.length > 0) {
      await this.save();
      logger.info('Cleaned up expired sessions', {
        count: expiredSessions.length,
        remainingCount: this.sessions.size,
      });
    }

    return expiredSessions.length;
  }

  /**
   * Get current number of sessions
   */
  async getSessionCount(): Promise<number> {
    return this.sessions.size;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.sessions.clear();
    logger.info('FileMCPMetadataStore disposed');
  }
}
