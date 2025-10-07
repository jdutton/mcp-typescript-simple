/**
 * MCP Server Instance Manager
 *
 * Manages the lifecycle of MCP Server + Transport instances with just-in-time
 * reconstruction from persistent metadata.
 *
 * Architecture:
 * - Metadata: Stored in Redis (serializable, persistent)
 * - Instances: Cached in-memory (non-serializable, reconstructed on-demand)
 * - Any server instance can handle any session (horizontal scalability)
 *
 * Based on: https://github.com/yigitkonur/example-mcp-server-streamable-http
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { MCPSessionMetadataStore, MCPSessionMetadata, AuthInfo } from '../session/mcp-session-metadata-store-interface.js';
import { createMCPMetadataStore } from '../session/mcp-metadata-store-factory.js';
import { EventStoreFactory } from '../session/event-store.js';
import { setupMCPServer } from './mcp-setup.js';
import { LLMManager } from '../llm/manager.js';
import { logger } from '../observability/logger.js';

/**
 * MCP Server instance with associated transport (non-serializable)
 */
export interface MCPServerInstance {
  server: Server;
  transport: StreamableHTTPServerTransport;
  sessionId: string;
  lastUsed: number;
}

/**
 * Options for creating transport with existing session
 */
export interface TransportCreationOptions {
  sessionId: string;
  metadata: MCPSessionMetadata;
  enableJsonResponse?: boolean;
  enableResumability?: boolean;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  onSessionInitialized?: (sessionId: string) => Promise<void>;
  onSessionClosed?: (sessionId: string) => Promise<void>;
}

/**
 * Manages MCP server instances with metadata-based reconstruction
 */
export class MCPInstanceManager {
  private metadataStore: MCPSessionMetadataStore;
  private instanceCache: Map<string, MCPServerInstance> = new Map();
  private llmManager: LLMManager;
  private readonly INSTANCE_TTL = 10 * 60 * 1000; // 10 minutes
  private cleanupTimer?: NodeJS.Timeout;

  constructor(llmManager: LLMManager, metadataStore?: MCPSessionMetadataStore) {
    this.llmManager = llmManager;
    this.metadataStore = metadataStore || createMCPMetadataStore();

    // Start cleanup timer for expired instances
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredInstances();
    }, 5 * 60 * 1000); // Every 5 minutes

    logger.info('MCPInstanceManager initialized', {
      storeType: this.metadataStore.constructor.name,
    });
  }

  /**
   * Get or recreate MCP server instance for session
   *
   * This pattern enables horizontal scalability by:
   * 1. Checking local instance cache (fast path - same instance)
   * 2. Verifying session exists in Redis (authoritative source)
   * 3. Reconstructing Server + Transport from metadata
   * 4. Caching locally for subsequent requests
   */
  async getOrRecreateInstance(
    sessionId: string,
    options: Omit<TransportCreationOptions, 'sessionId' | 'metadata'>
  ): Promise<MCPServerInstance> {
    // 1. Check local cache (warm path - same instance)
    let instance = this.instanceCache.get(sessionId);
    if (instance) {
      instance.lastUsed = Date.now();
      logger.debug('Reusing cached MCP instance', {
        sessionId: sessionId.substring(0, 8) + '...',
        cacheSize: this.instanceCache.size,
      });
      return instance;
    }

    // 2. Verify session exists in Redis (authoritative source)
    const metadata = await this.metadataStore.getSession(sessionId);
    if (!metadata) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 3. Reconstruct server + transport from metadata
    logger.info('Reconstructing MCP server instance', {
      sessionId: sessionId.substring(0, 8) + '...',
      age: Math.round((Date.now() - metadata.createdAt) / 1000) + 's',
      ttl: Math.round((metadata.expiresAt - Date.now()) / 1000) + 's',
      hasAuth: !!metadata.authInfo,
      eventCount: metadata.events?.length || 0,
    });

    instance = await this.createInstance(sessionId, metadata, options);

    // 4. Cache locally for subsequent requests
    this.instanceCache.set(sessionId, instance);

    logger.debug('MCP instance cached', {
      sessionId: sessionId.substring(0, 8) + '...',
      cacheSize: this.instanceCache.size,
    });

    return instance;
  }

  /**
   * Create a new MCP server instance
   */
  private async createInstance(
    sessionId: string,
    metadata: MCPSessionMetadata,
    options: Omit<TransportCreationOptions, 'sessionId' | 'metadata'>
  ): Promise<MCPServerInstance> {
    // Create MCP server
    const server = new Server(
      {
        name: "mcp-typescript-simple",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Setup server with tools
    await setupMCPServer(server, this.llmManager);

    // Create transport with existing session ID
    const transport = this.createTransportWithSessionId(sessionId, metadata, {
      ...options,
      onSessionInitialized: async (sid: string) => {
        // Session already exists in metadata store (no activity update needed - immutable)
        if (options.onSessionInitialized) {
          await options.onSessionInitialized(sid);
        }
      },
      onSessionClosed: async (sid: string) => {
        // Remove from cache and metadata store
        this.instanceCache.delete(sid);
        await this.metadataStore.deleteSession(sid);
        if (options.onSessionClosed) {
          await options.onSessionClosed(sid);
        }
      },
    });

    // CRITICAL FIX: Set the transport's sessionId and _initialized properties directly
    // The sessionIdGenerator callback and initialization flow are only invoked during
    // initialize requests, but reconstructed sessions never receive initialize (already
    // initialized). We must set these properties manually for the transport to work correctly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (transport as any).sessionId = sessionId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (transport as any)._initialized = true;

    // Connect transport to server for reconstruction
    // This is needed because we're creating fresh server + transport instances
    // The streamable-http-server.ts will skip connection for reconstructed sessions
    await server.connect(transport);

    logger.debug('MCP instance reconstructed and connected', {
      sessionId: sessionId.substring(0, 8) + '...',
      transportSessionId: transport.sessionId,
    });

    return {
      server,
      transport,
      sessionId,
      lastUsed: Date.now(),
    };
  }

  /**
   * Create transport with existing session ID
   * (skips session ID generation, uses provided ID)
   */
  private createTransportWithSessionId(
    sessionId: string,
    metadata: MCPSessionMetadata,
    options: Omit<TransportCreationOptions, 'sessionId' | 'metadata'>
  ): StreamableHTTPServerTransport {
    const eventStore = options.enableResumability
      ? EventStoreFactory.createEventStore('memory')
      : undefined;

    return new StreamableHTTPServerTransport({
      // Return existing session ID instead of generating new one
      sessionIdGenerator: () => {
        logger.debug('Transport using existing session ID', {
          sessionId: sessionId.substring(0, 8) + '...',
        });
        return sessionId;
      },
      onsessioninitialized: options.onSessionInitialized,
      onsessionclosed: options.onSessionClosed,
      enableJsonResponse: options.enableJsonResponse,
      eventStore,
      allowedHosts: options.allowedHosts,
      allowedOrigins: options.allowedOrigins,
      enableDnsRebindingProtection: !!(options.allowedHosts || options.allowedOrigins),
    });
  }

  /**
   * Store session metadata for new session
   */
  async storeSessionMetadata(
    sessionId: string,
    authInfo?: AuthInfo
  ): Promise<void> {
    const now = Date.now();
    const metadata: MCPSessionMetadata = {
      sessionId,
      createdAt: now,
      expiresAt: now + (30 * 60 * 1000), // 30 minutes default TTL
      authInfo,
    };

    await this.metadataStore.storeSession(sessionId, metadata);

    logger.debug('Session metadata stored', {
      sessionId: sessionId.substring(0, 8) + '...',
      hasAuth: !!authInfo,
    });
  }

  /**
   * Clean up expired instances from local cache
   */
  private cleanupExpiredInstances(): void {
    const now = Date.now();
    const expiredSessions: string[] = [];

    for (const [sessionId, instance] of this.instanceCache) {
      const age = now - instance.lastUsed;
      if (age > this.INSTANCE_TTL) {
        expiredSessions.push(sessionId);
      }
    }

    for (const sessionId of expiredSessions) {
      this.instanceCache.delete(sessionId);
    }

    if (expiredSessions.length > 0) {
      logger.info('Cleaned up expired MCP instances', {
        count: expiredSessions.length,
        ttlMinutes: this.INSTANCE_TTL / 60000,
      });
    }
  }

  /**
   * Get statistics about instance cache
   */
  getStats(): {
    cachedInstances: number;
    oldestInstanceAge: number;
  } {
    const now = Date.now();
    let oldestAge = 0;

    for (const instance of this.instanceCache.values()) {
      const age = now - instance.lastUsed;
      if (age > oldestAge) {
        oldestAge = age;
      }
    }

    return {
      cachedInstances: this.instanceCache.size,
      oldestInstanceAge: oldestAge,
    };
  }

  /**
   * Delete a session and clean up all associated resources
   *
   * This method provides proper encapsulation for session cleanup, removing the need
   * for external code to access private members via type assertions.
   *
   * @param sessionId - The session ID to delete
   * @returns Promise that resolves when cleanup is complete
   */
  async deleteSession(sessionId: string): Promise<void> {
    // Remove from instance cache
    const instance = this.instanceCache.get(sessionId);
    if (instance) {
      this.instanceCache.delete(sessionId);
      logger.debug('Deleted session from instance cache', {
        sessionId: sessionId.substring(0, 8) + '...',
      });
    }

    // Remove from metadata store
    await this.metadataStore.deleteSession(sessionId);

    logger.debug('Session fully deleted', {
      sessionId: sessionId.substring(0, 8) + '...',
      hadInstance: !!instance,
    });
  }

  /**
   * Dispose of resources
   *
   * Note: Does NOT dispose the metadata store as it may be shared across
   * multiple instances (e.g., Redis). The metadata store should
   * be managed separately by the application lifecycle.
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    this.instanceCache.clear();

    logger.info('MCPInstanceManager disposed');
  }
}
