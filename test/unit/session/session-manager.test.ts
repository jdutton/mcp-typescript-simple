import { vi } from 'vitest';

import { SessionManager } from '../../../src/session/session-manager.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

const createAuthInfo = (token: string): AuthInfo => ({
  token,
  clientId: 'client',
  scopes: ['scope'],
  expiresAt: Date.now() / 1000 + 3600
});

describe('SessionManager', () => {
  const managers: SessionManager[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    // Clean up all session managers to prevent timer leaks
    managers.forEach(manager => manager.destroy());
    managers.length = 0;

    vi.useRealTimers();
  });

  it('creates, retrieves, updates, and closes sessions', () => {
    const manager = new SessionManager();
    managers.push(manager); // Track for cleanup

    const session = manager.createSession(createAuthInfo('token-1'), { foo: 'bar' });
    expect(session.sessionId).toBeDefined();

    const fetched = manager.getSession(session.sessionId);
    expect(fetched?.authInfo?.token).toBe('token-1');

    manager.updateSession(session.sessionId, {
      authInfo: createAuthInfo('token-2'),
      metadata: { baz: 'qux' }
    });

    const updated = manager.getSession(session.sessionId);
    expect(updated?.authInfo?.token).toBe('token-2');
    expect(updated?.metadata).toEqual({ foo: 'bar', baz: 'qux' });

    expect(manager.closeSession(session.sessionId)).toBe(true);
    expect(manager.getSession(session.sessionId)).toBeUndefined();
    expect(manager.closeSession('missing')).toBe(false);

    manager.destroy();
  });

  it('validates session expiration', () => {
    const manager = new SessionManager();
    managers.push(manager); // Track for cleanup
    const session = manager.createSession();

    expect(manager.isSessionValid(session.sessionId)).toBe(true);

    vi.setSystemTime(new Date('2024-01-02T01:00:00Z')); // > 24h later
    expect(manager.isSessionValid(session.sessionId)).toBe(false);
    expect(manager.getSession(session.sessionId)).toBeUndefined();

    manager.destroy();
  });

  it('reports session statistics and cleanup removes stale sessions', () => {
    const manager = new SessionManager();
    managers.push(manager); // Track for cleanup

    // Create first session at T0
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    const active = manager.createSession();

    // Create second session 12 hours later (will expire 12 hours after first)
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
    const expired = manager.createSession();

    // Move to a time when first session is expired but second is still valid
    vi.setSystemTime(new Date('2024-01-02T00:30:00Z')); // First expires at 00:00, second at 12:00
    const internal = manager as unknown as { cleanup(): void };
    internal.cleanup();

    const stats = manager.getStats();
    expect(stats.totalSessions).toBe(1);
    expect(stats.activeSessions).toBe(1);
    expect(stats.expiredSessions).toBe(0);
    expect(manager.getActiveSessions().map(s => s.sessionId)).toEqual([expired.sessionId]);
    expect(manager.getSession(active.sessionId)).toBeUndefined();

    manager.destroy();
  });

  it('destroys session manager and clears timers', () => {
    const manager = new SessionManager();
    managers.push(manager); // Track for cleanup
    const internal = manager as unknown as { cleanupInterval?: NodeJS.Timeout; sessions: Map<string, unknown> };
    manager.createSession();

    manager.destroy();
    expect(internal.cleanupInterval).toBeUndefined();
    expect(internal.sessions.size).toBe(0);
  });
});
