/**
 * Transport layer types and interfaces for MCP server
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { TransportMode } from '@mcp-typescript-simple/config';
import type { ToolRegistry } from "@mcp-typescript-simple/tools";

/**
 * Configuration options for different transport types
 */
export interface StdioTransportOptions {
  // Currently no configuration options for STDIO transport
  // This interface is reserved for future configuration options
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

export type TransportOptions = StdioTransportOptions | StreamableHTTPTransportOptions;

/**
 * Interface for transport lifecycle management
 */
export interface TransportManager {
  /**
   * Initialize the transport with the given MCP server
   */
  initialize(_server: Server, _toolRegistry?: ToolRegistry): Promise<void>;

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
  createTransport(_mode: TransportMode, _options: TransportOptions): TransportManager;
}