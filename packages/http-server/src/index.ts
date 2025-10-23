/**
 * HTTP Server package for MCP
 * Provides HTTP transport, session management, middleware, and server infrastructure
 */

// Transport layer
export { TransportFactory } from './transport/factory.js';
export type {
  TransportManager,
  TransportOptions,
  StdioTransportOptions,
  StreamableHTTPTransportOptions
} from './transport/types.js';

// HTTP Server
export { MCPStreamableHttpServer } from './server/streamable-http-server.js';
export { MCPInstanceManager } from './server/mcp-instance-manager.js';

// Session Management
export { SessionManager } from './session/session-manager.js';

// Middleware (re-export all middleware functions)
export * from './middleware/dcr-auth.js';

// Routes (re-export all route setup functions and types)
export * from './server/routes/health-routes.js';
export * from './server/routes/oauth-routes.js';
export * from './server/routes/dcr-routes.js';
export * from './server/routes/discovery-routes.js';
export * from './server/routes/admin-routes.js';
export * from './server/routes/admin-token-routes.js';
export * from './server/routes/docs-routes.js';
