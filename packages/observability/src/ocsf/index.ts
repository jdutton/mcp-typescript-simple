/**
 * @mcp-typescript-simple/ocsf
 *
 * OCSF (Open Cybersecurity Schema Framework) structured audit events for MCP servers.
 *
 * This package provides TypeScript types and builders for creating standards-based
 * security audit events compatible with SIEM systems (AWS Security Lake, Splunk, Datadog).
 *
 * Based on OCSF 1.3.0 specification: https://schema.ocsf.io/1.3.0
 */

// Export all types
export * from './types/index.js';

// Export all builders
export * from './builders/index.js';

// Export OCSF-OTEL bridge
export * from './ocsf-otel-bridge.js';

// Re-export commonly used types and functions for convenience
export {
  // Type enums
  SeverityId,
  StatusId,
  // Authentication enums
  AuthenticationActivityId,
  AuthProtocolId,
  LogonTypeId,
  // API Activity enums
  APIActivityId,
} from './types/index.js';

export {
  // Authentication builders
  logonEvent,
  logoffEvent,
  authenticationEvent,
  // API Activity builders
  createAPIEvent,
  readAPIEvent,
  updateAPIEvent,
  deleteAPIEvent,
  apiActivityEvent,
} from './builders/index.js';
