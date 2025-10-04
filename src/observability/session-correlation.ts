/**
 * Session correlation for distributed tracing
 *
 * Uses existing UUID v4 session IDs which are cryptographically secure
 * and contain no PII - safe to use in traces
 */

import { trace } from '@opentelemetry/api';
import type { SessionInfo } from '../session/session-manager.js';

/**
 * Session correlation context for spans
 */
export interface SessionContext {
  sessionId: string;
  createdAt: number;
  authenticated: boolean;
  expiresAt: number;
}

/**
 * Extract safe session context from SessionInfo
 * Session IDs are UUID v4 - cryptographically random with no PII
 */
export function extractSessionContext(session: SessionInfo): SessionContext {
  return {
    sessionId: session.sessionId, // Safe: UUID v4 contains no personal data
    createdAt: session.createdAt,
    authenticated: !!session.authInfo,
    expiresAt: session.expiresAt
  };
}

/**
 * Add session correlation to current span
 */
export function addSessionToSpan(sessionContext: SessionContext): void {
  const span = trace.getActiveSpan();
  if (!span) {
    return;
  }

  // Add session attributes - all safe technical identifiers
  span.setAttributes({
    'mcp.session.id': sessionContext.sessionId,
    'mcp.session.created_at': sessionContext.createdAt,
    'mcp.session.authenticated': sessionContext.authenticated,
    'mcp.session.expires_at': sessionContext.expiresAt
  });
}

/**
 * Create session span for session lifecycle events
 */
export function createSessionSpan(
  operation: string,
  sessionContext: SessionContext,
  callback: () => Promise<void> | void
): Promise<void> {
  const tracer = trace.getTracer('mcp-session');

  return tracer.startActiveSpan(`session.${operation}`, async (span) => {
    try {
      addSessionToSpan(sessionContext);
      span.setAttributes({
        'mcp.operation': operation,
        'mcp.component': 'session-manager'
      });

      await callback();
      span.setStatus({ code: 1 }); // OK status
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: 2 }); // ERROR status
      throw error;
    } finally {
      span.end();
    }
  });
}