import { vi } from 'vitest';

import { MemorySessionManager } from '../../src/session/memory-session-manager.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

const createAuthInfo = (token: string): AuthInfo => ({
  token,
  clientId: 'client',
  scopes: ['scope'],
  expiresAt: Date.now() / 1000 + 3600
});

describe('MemorySessionManager', () => {
  const managers: MemorySessionManager[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(async () => {
    // Clean up all session managers to prevent timer leaks
    await Promise.all(managers.map(manager => manager.destroy()));
    managers.length = 0;

    vi.useRealTimers();
  });

  it('creates, retrieves, and closes sessions', async () => {
    const manager = new MemorySessionManager();
    managers.push(manager); // Track for cleanup

    const session = await manager.createSession(createAuthInfo('token-1'), { foo: 'bar' });
    expect(session.sessionId).toBeDefined();

    const fetched = await manager.getSession(session.sessionId);
    expect(fetched?.authInfo?.token).toBe('token-1');
    expect(fetched?.metadata).toEqual({ foo: 'bar' });

    expect(await manager.closeSession(session.sessionId)).toBe(true);
    expect(await manager.getSession(session.sessionId)).toBeUndefined();
    expect(await manager.closeSession('missing')).toBe(false);

    await manager.destroy();
  });

  it('validates session expiration', async () => {
    const manager = new MemorySessionManager();
    managers.push(manager); // Track for cleanup
    const session = await manager.createSession();

    expect(await manager.isSessionValid(session.sessionId)).toBe(true);

    vi.setSystemTime(new Date('2024-01-02T01:00:00Z')); // > 24h later
    expect(await manager.isSessionValid(session.sessionId)).toBe(false);
    expect(await manager.getSession(session.sessionId)).toBeUndefined();

    await manager.destroy();
  });

  it('reports session statistics and cleanup removes stale sessions', async () => {
    const manager = new MemorySessionManager();
    managers.push(manager); // Track for cleanup

    // Create first session at T0
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    const active = await manager.createSession();

    // Create second session 12 hours later (will expire 12 hours after first)
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
    const expired = await manager.createSession();

    // Move to a time when first session is expired but second is still valid
    vi.setSystemTime(new Date('2024-01-02T00:30:00Z')); // First expires at 00:00, second at 12:00
    await manager.cleanup();

    const stats = await manager.getStats();
    expect(stats.totalSessions).toBe(1);
    expect(stats.activeSessions).toBe(1);
    expect(stats.expiredSessions).toBe(0);
    const activeSessions = await manager.getActiveSessions();
    expect(activeSessions.map(s => s.sessionId)).toEqual([expired.sessionId]);
    expect(await manager.getSession(active.sessionId)).toBeUndefined();

    await manager.destroy();
  });

  it('destroys session manager and clears timers', async () => {
    const manager = new MemorySessionManager();
    managers.push(manager); // Track for cleanup
    const internal = manager as unknown as { cleanupInterval?: NodeJS.Timeout; sessions: Map<string, unknown> };
    await manager.createSession();

    await manager.destroy();
    expect(internal.cleanupInterval).toBeUndefined();
    expect(internal.sessions.size).toBe(0);
  });
});
