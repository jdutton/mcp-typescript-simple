/**
 * Transport layer types and interfaces for dual-mode MCP server
 */

// import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { TransportMode } from "../config/environment.js";

/**
 * Configuration options for different transport types
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface StdioTransportOptions {
  // Currently no configuration options for STDIO transport
  // This interface is reserved for future configuration options
}

export interface SSETransportOptions {
  port: number;
  host: string;
  endpoint: string;
  requireAuth: boolean;
  allowedOrigins?: string[];
  allowedHosts?: string[];
  sessionSecret: string;
}

export interface StreamableHTTPTransportOptions {
  port: number;
  host: string;
  endpoint: string;
  requireAuth: boolean;
  allowedOrigins?: string[];
  allowedHosts?: string[];
  sessionSecret: string;
  enableResumability?: boolean;
  enableJsonResponse?: boolean;
}

export type TransportOptions = StdioTransportOptions | SSETransportOptions | StreamableHTTPTransportOptions;

/**
 * Interface for transport lifecycle management
 */
export interface TransportManager {
  /**
   * Initialize the transport with the given MCP server
   */
  initialize(server: Server): Promise<void>;

  /**
   * Start the transport and begin accepting connections
   */
  start(): Promise<void>;

  /**
   * Stop the transport and cleanup resources
   */
  stop(): Promise<void>;

  /**
   * Get information about the transport for logging
   */
  getInfo(): string;

  /**
   * Get the transport mode
   */
  getMode(): TransportMode;
}

/**
 * Factory interface for creating transport instances
 */
export interface TransportFactory {
  createTransport(mode: TransportMode, options: TransportOptions): TransportManager;
}