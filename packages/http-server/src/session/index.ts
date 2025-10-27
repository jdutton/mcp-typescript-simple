/**
 * Session Management Module
 *
 * Unified session management supporting both memory and Redis backends.
 *
 * Exports:
 * - SessionManager interface
 * - MemorySessionManager implementation (single-node)
 * - RedisSessionManager implementation (multi-node)
 * - Factory functions for automatic detection
 * - Utility functions (generateSessionId)
 */

// Core types
export type { SessionManager, SessionInfo, SessionStats } from './session-manager.js';

// Implementations
export { MemorySessionManager } from './memory-session-manager.js';
export { RedisSessionManager } from './redis-session-manager.js';

// Factory
export {
  createSessionManager,
  createSessionManagerFromStore,
} from './session-manager-factory.js';

// Utilities
export { generateSessionId } from './session-utils.js';
