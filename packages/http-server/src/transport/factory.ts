/**
 * Transport factory for creating stdio and streamable_http transport managers
 * Supports modes: stdio, streamable_http
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { TransportMode, EnvironmentConfig } from '@mcp-typescript-simple/config';
import {
  TransportManager,
  TransportFactory as ITransportFactory,
  TransportOptions,
  StdioTransportOptions,
  StreamableHTTPTransportOptions
} from "./types.js";
import { MCPStreamableHttpServer } from "../server/streamable-http-server.js";
import { LLMManager } from "@mcp-typescript-simple/tools-llm";
import { ToolRegistry } from "@mcp-typescript-simple/tools";
import { basicTools } from "@mcp-typescript-simple/example-tools-basic";
import { createLLMTools } from "@mcp-typescript-simple/example-tools-llm";
import { setupMCPServerWithRegistry } from "@mcp-typescript-simple/server";
import { logger } from '@mcp-typescript-simple/observability';

/**
 * Transport manager for stdio mode (development)
 */
export class StdioTransportManager implements TransportManager {
  private server?: Server;
  private transport?: StdioServerTransport;

  constructor(private options: StdioTransportOptions) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async initialize(server: Server, _toolRegistry?: ToolRegistry): Promise<void> {
    this.server = server;
    this.transport = new StdioServerTransport();
  }

  async start(): Promise<void> {
    if (!this.server || !this.transport) {
      throw new Error('Transport not initialized');
    }

    await this.server.connect(this.transport);
    logger.info("MCP TypeScript Simple server running on stdio");
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
 * Transport manager for Streamable HTTP mode (modern production with OAuth)
 */
export class StreamableHTTPTransportManager implements TransportManager {
  private httpServer?: MCPStreamableHttpServer;
  private streamableTransports: Map<string, StreamableHTTPServerTransport> = new Map();
  private llmManager?: LLMManager;

  constructor(private options: StreamableHTTPTransportOptions) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async initialize(server: Server, toolRegistry?: ToolRegistry): Promise<void> {
    // Note: server and toolRegistry parameters unused - HTTPServer creates its own instances
    // The HTTPServer creates its own registry and server instances internally
    this.llmManager = undefined; // Will be recreated by the HTTPServer

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

    // Initialize async components (OAuth)
    await this.httpServer.initialize();

    // Configure HTTP server to handle Streamable HTTP connections
    this.httpServer.onStreamableHTTPTransport(async (streamableTransport: StreamableHTTPServerTransport) => {
      const sessionId = streamableTransport.sessionId || 'anonymous';
      this.streamableTransports.set(sessionId, streamableTransport);

      const removeTransport = () => {
        this.streamableTransports.delete(sessionId);
      };

      streamableTransport.onclose = () => {
        removeTransport();
        logger.info("Streamable HTTP connection closed", { sessionId });
      };

      streamableTransport.onerror = (error: Error) => {
        logger.error("Streamable HTTP connection error", { sessionId, error });
        removeTransport();
      };

      try {
        // Create a fresh MCP server instance for each transport
        // This is the correct approach since each HTTP request needs its own server
        logger.debug("Creating new MCP server instance for transport", { sessionId });
        const transportServer = new Server(
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

        // Set up the server with tool registry (new package-based architecture)
        const toolRegistry = new ToolRegistry();
        toolRegistry.merge(basicTools);

        // Add LLM tools if available
        if (this.llmManager) {
          try {
            const llmTools = createLLMTools(this.llmManager);
            toolRegistry.merge(llmTools);
          } catch {
            logger.debug("LLM tools not available for this connection", { sessionId });
          }
        }

        await setupMCPServerWithRegistry(transportServer, toolRegistry);

        await transportServer.connect(streamableTransport);
        logger.info("New Streamable HTTP connection established", { sessionId });
      } catch (error) {
        removeTransport();
        logger.error("Failed to connect Streamable HTTP transport", { sessionId, error });
        try {
          await streamableTransport.close();
        } catch (closeError) {
          logger.error("Failed to close Streamable HTTP transport after connection error", { sessionId, error: closeError });
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

    logger.info("MCP TypeScript Simple server running", {
      host: this.options.host,
      port: this.options.port,
      authMode,
      endpoint: this.options.endpoint,
      features
    });
  }

  async stop(): Promise<void> {
    const errors: Error[] = [];

    // Close all Streamable HTTP connections
    for (const [sessionId, transport] of this.streamableTransports) {
      try {
        await transport.close();
      } catch (error) {
        logger.error("Error closing Streamable HTTP transport", { sessionId, error });
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    this.streamableTransports.clear();

    // Stop HTTP server
    if (this.httpServer) {
      try {
        await this.httpServer.stop();
      } catch (error) {
        logger.error('Error stopping Streamable HTTP server', error);
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
          enableJsonResponse: true, // Use JSON responses for HTTP clients
        });

      default:
        throw new Error(`Unsupported transport mode: ${mode}`);
    }
  }
}
