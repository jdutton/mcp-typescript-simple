/**
 * Transport factory for creating stdio, SSE, and streamable_http transport managers
 * Supports modes: stdio, sse, streamable_http
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { TransportMode, EnvironmentConfig } from "../config/environment.js";
import {
  TransportManager,
  TransportFactory as ITransportFactory,
  TransportOptions,
  StdioTransportOptions,
  SSETransportOptions,
  StreamableHTTPTransportOptions
} from "./types.js";
import { MCPHttpServer } from "../server/http-server.js";
import { MCPStreamableHttpServer } from "../server/streamable-http-server.js";

/**
 * Transport manager for stdio mode (development)
 */
export class StdioTransportManager implements TransportManager {
  private server?: Server;
  private transport?: StdioServerTransport;

  constructor(private options: StdioTransportOptions) {}

  async initialize(server: Server): Promise<void> {
    this.server = server;
    this.transport = new StdioServerTransport();
  }

  async start(): Promise<void> {
    if (!this.server || !this.transport) {
      throw new Error('Transport not initialized');
    }

    await this.server.connect(this.transport);
    console.error("🚀 MCP TypeScript Simple server running on stdio");
  }

  async stop(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
    }
  }

  getInfo(): string {
    return "Standard Input/Output (stdio)";
  }

  getMode(): TransportMode {
    return TransportMode.STDIO;
  }
}

/**
 * Transport manager for SSE mode (production with OAuth)
 */
export class SSETransportManager implements TransportManager {
  private server?: Server;
  private httpServer?: MCPHttpServer;
  private sseTransports: Map<string, SSEServerTransport> = new Map();

  constructor(private options: SSETransportOptions) {}

  async initialize(server: Server): Promise<void> {
    this.server = server;

    // Create HTTP server with OAuth support
    this.httpServer = new MCPHttpServer({
      port: this.options.port,
      host: this.options.host,
      endpoint: this.options.endpoint,
      requireAuth: this.options.requireAuth,
      allowedOrigins: this.options.allowedOrigins,
      allowedHosts: this.options.allowedHosts,
      sessionSecret: this.options.sessionSecret,
    });

    // Configure HTTP server to handle SSE connections
    this.httpServer.onSSEConnection(async (sseTransport: SSEServerTransport) => {
      const sessionId = sseTransport.sessionId;
      this.sseTransports.set(sessionId, sseTransport);

      const removeTransport = () => {
        this.sseTransports.delete(sessionId);
      };

      sseTransport.onclose = () => {
        removeTransport();
        console.error(`🔌 SSE connection closed: ${sessionId}`);
      };

      sseTransport.onerror = (error: Error) => {
        console.error(`❌ SSE connection error for ${sessionId}:`, error);
        removeTransport();
      };

      try {
        await server.connect(sseTransport);
        console.error(`🔗 New SSE connection established: ${sessionId}`);
      } catch (error) {
        removeTransport();
        console.error(`❌ Failed to connect SSE transport ${sessionId}:`, error);
        try {
          await sseTransport.close();
        } catch (closeError) {
          console.error(`Failed to close SSE transport ${sessionId} after connection error:`, closeError);
        }
      }
    });
  }

  async start(): Promise<void> {
    if (!this.httpServer) {
      throw new Error('HTTP server not initialized');
    }

    await this.httpServer.start();

    const authMode = this.options.requireAuth ? 'with OAuth authentication' : 'without authentication (dev mode)';
    console.error(`🚀 MCP TypeScript Simple server running on ${this.options.host}:${this.options.port} ${authMode}`);
    console.error(`🔗 SSE endpoint: ${this.options.endpoint}`);
  }

  async stop(): Promise<void> {
    const errors: Error[] = [];

    // Close all SSE connections
    for (const [sessionId, transport] of this.sseTransports) {
      try {
        await transport.close();
      } catch (error) {
        console.error(`Error closing SSE transport ${sessionId}:`, error);
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    this.sseTransports.clear();

    // Stop HTTP server
    if (this.httpServer) {
      try {
        await this.httpServer.stop();
      } catch (error) {
        console.error('Error stopping SSE HTTP server:', error);
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (errors.length > 0) {
      const message = errors.map(err => err.message).join('; ');
      throw new Error(`Failed to shut down SSE transport manager: ${message}`);
    }
  }

  getInfo(): string {
    const authMode = this.options.requireAuth ? 'with OAuth' : 'dev mode';
    return `Server-Sent Events on ${this.options.host}:${this.options.port} (${authMode})`;
  }

  getMode(): TransportMode {
    return TransportMode.SSE;
  }

  getConnectionCount(): number {
    return this.sseTransports.size;
  }

  getConnectedSessions(): string[] {
    return Array.from(this.sseTransports.keys());
  }
}

/**
 * Transport manager for Streamable HTTP mode (modern production with OAuth)
 */
export class StreamableHTTPTransportManager implements TransportManager {
  private server?: Server;
  private httpServer?: MCPStreamableHttpServer;
  private streamableTransports: Map<string, StreamableHTTPServerTransport> = new Map();

  constructor(private options: StreamableHTTPTransportOptions) {}

  async initialize(server: Server): Promise<void> {
    this.server = server;

    // Create HTTP server with OAuth support and Streamable HTTP transport
    this.httpServer = new MCPStreamableHttpServer({
      port: this.options.port,
      host: this.options.host,
      endpoint: this.options.endpoint,
      requireAuth: this.options.requireAuth,
      allowedOrigins: this.options.allowedOrigins,
      allowedHosts: this.options.allowedHosts,
      sessionSecret: this.options.sessionSecret,
      enableResumability: this.options.enableResumability,
      enableJsonResponse: this.options.enableJsonResponse,
    });

    // Configure HTTP server to handle Streamable HTTP connections
    this.httpServer.onStreamableHTTPTransport(async (streamableTransport: StreamableHTTPServerTransport) => {
      const sessionId = streamableTransport.sessionId || 'anonymous';
      this.streamableTransports.set(sessionId, streamableTransport);

      const removeTransport = () => {
        this.streamableTransports.delete(sessionId);
      };

      streamableTransport.onclose = () => {
        removeTransport();
        console.error(`🔌 Streamable HTTP connection closed: ${sessionId}`);
      };

      streamableTransport.onerror = (error: Error) => {
        console.error(`❌ Streamable HTTP connection error for ${sessionId}:`, error);
        removeTransport();
      };

      try {
        await server.connect(streamableTransport);
        console.error(`🔗 New Streamable HTTP connection established: ${sessionId}`);
      } catch (error) {
        removeTransport();
        console.error(`❌ Failed to connect Streamable HTTP transport ${sessionId}:`, error);
        try {
          await streamableTransport.close();
        } catch (closeError) {
          console.error(`Failed to close Streamable HTTP transport ${sessionId} after connection error:`, closeError);
        }
      }
    });
  }

  async start(): Promise<void> {
    if (!this.httpServer) {
      throw new Error('HTTP server not initialized');
    }

    await this.httpServer.start();

    const authMode = this.options.requireAuth ? 'with OAuth authentication' : 'without authentication (dev mode)';
    const features = [];
    if (this.options.enableResumability) features.push('resumability');
    if (this.options.enableJsonResponse) features.push('JSON responses');
    const featureStr = features.length > 0 ? ` (${features.join(', ')})` : '';

    console.error(`🚀 MCP TypeScript Simple server running on ${this.options.host}:${this.options.port} ${authMode}`);
    console.error(`🔗 Streamable HTTP endpoint: ${this.options.endpoint}${featureStr}`);
  }

  async stop(): Promise<void> {
    const errors: Error[] = [];

    // Close all Streamable HTTP connections
    for (const [sessionId, transport] of this.streamableTransports) {
      try {
        await transport.close();
      } catch (error) {
        console.error(`Error closing Streamable HTTP transport ${sessionId}:`, error);
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    this.streamableTransports.clear();

    // Stop HTTP server
    if (this.httpServer) {
      try {
        await this.httpServer.stop();
      } catch (error) {
        console.error('Error stopping Streamable HTTP server:', error);
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (errors.length > 0) {
      const message = errors.map(err => err.message).join('; ');
      throw new Error(`Failed to shut down Streamable HTTP transport manager: ${message}`);
    }
  }

  getInfo(): string {
    const authMode = this.options.requireAuth ? 'with OAuth' : 'dev mode';
    const features = [];
    if (this.options.enableResumability) features.push('resumability');
    if (this.options.enableJsonResponse) features.push('JSON responses');
    const featureStr = features.length > 0 ? ` (${features.join(', ')})` : '';

    return `Streamable HTTP on ${this.options.host}:${this.options.port} (${authMode})${featureStr}`;
  }

  getMode(): TransportMode {
    return TransportMode.STREAMABLE_HTTP;
  }

  getConnectionCount(): number {
    return this.streamableTransports.size;
  }

  getConnectedSessions(): string[] {
    return Array.from(this.streamableTransports.keys());
  }

  getHttpServer(): MCPStreamableHttpServer | undefined {
    return this.httpServer;
  }
}

/**
 * Factory for creating transport managers based on mode and configuration
 */
export class TransportFactory implements ITransportFactory {
  createTransport(mode: TransportMode, options: TransportOptions): TransportManager {
    switch (mode) {
      case TransportMode.STDIO:
        return new StdioTransportManager(options as StdioTransportOptions);

      case TransportMode.SSE:
        return new SSETransportManager(options as SSETransportOptions);

      case TransportMode.STREAMABLE_HTTP:
        return new StreamableHTTPTransportManager(options as StreamableHTTPTransportOptions);

      default:
        throw new Error(`Unsupported transport mode: ${mode}`);
    }
  }

  /**
   * Get the current transport mode from environment
   */
  static getTransportMode(): TransportMode {
    return EnvironmentConfig.getTransportMode();
  }

  /**
   * Create transport with environment-based configuration
   */
  static createFromEnvironment(): TransportManager {
    const mode = EnvironmentConfig.getTransportMode();
    const factory = new TransportFactory();

    switch (mode) {
      case TransportMode.STDIO:
        return factory.createTransport(mode, {});

      case TransportMode.SSE:
        const serverConfig = EnvironmentConfig.getServerConfig();
        const securityConfig = EnvironmentConfig.getSecurityConfig();

        return factory.createTransport(mode, {
          port: serverConfig.port,
          host: serverConfig.host,
          endpoint: '/mcp/sse',
          requireAuth: !EnvironmentConfig.shouldSkipAuth(),
          allowedOrigins: securityConfig.allowedOrigins,
          allowedHosts: securityConfig.allowedHosts,
          sessionSecret: securityConfig.sessionSecret,
        });

      case TransportMode.STREAMABLE_HTTP:
        const streamableServerConfig = EnvironmentConfig.getServerConfig();
        const streamableSecurityConfig = EnvironmentConfig.getSecurityConfig();

        return factory.createTransport(mode, {
          port: streamableServerConfig.port,
          host: streamableServerConfig.host,
          endpoint: '/mcp',
          requireAuth: !EnvironmentConfig.shouldSkipAuth(),
          allowedOrigins: streamableSecurityConfig.allowedOrigins,
          allowedHosts: streamableSecurityConfig.allowedHosts,
          sessionSecret: streamableSecurityConfig.sessionSecret,
          enableResumability: true, // Enable resumability by default
          enableJsonResponse: false, // Use SSE streaming by default
        });

      default:
        throw new Error(`Unsupported transport mode: ${mode}`);
    }
  }
}
