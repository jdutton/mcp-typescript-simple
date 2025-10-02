/**
 * Unit tests for Vercel KV Store implementations
 *
 * Tests OAuth session store, token store, and client store implementations
 * using Vercel KV (Redis) for serverless persistence.
 */

import { VercelKVSessionStore } from '../../../../src/auth/stores/vercel-kv-session-store.js';
import { VercelKVOAuthTokenStore } from '../../../../src/auth/stores/vercel-kv-oauth-token-store.js';
import { OAuthSession, StoredTokenInfo } from '../../../../src/auth/providers/types.js';

// Mock @vercel/kv
jest.mock('@vercel/kv', () => ({
  kv: {
    setex: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    keys: jest.fn(),
    scan: jest.fn(),
  },
}));

// Mock logger
jest.mock('../../../../src/observability/logger.js', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { kv } from '@vercel/kv';

const mockKv = kv as jest.Mocked<typeof kv>;

describe('VercelKVSessionStore', () => {
  let store: VercelKVSessionStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new VercelKVSessionStore();
  });

  describe('storeSession', () => {
    it('stores session with TTL in Redis', async () => {
      const session: OAuthSession = {
        state: 'state-123',
        codeVerifier: 'verifier-abc',
        codeChallenge: 'challenge-xyz',
        redirectUri: 'http://localhost:3000/callback',
        provider: 'google',
        scopes: ['openid', 'email'],
        expiresAt: Date.now() + 600000, // 10 minutes
      };

      mockKv.setex.mockResolvedValueOnce('OK');

      await store.storeSession('state-123', session);

      expect(mockKv.setex).toHaveBeenCalledWith(
        'oauth:session:state-123',
        600, // 10 minutes in seconds
        JSON.stringify(session)
      );
    });

    it('handles storage errors gracefully', async () => {
      const session: OAuthSession = {
        state: 'error-state',
        codeVerifier: 'verifier',
        codeChallenge: 'challenge',
        redirectUri: 'http://localhost:3000/callback',
        provider: 'github',
        scopes: ['user:email'],
        expiresAt: Date.now() + 600000,
      };

      mockKv.setex.mockRejectedValueOnce(new Error('Redis connection failed'));

      await expect(store.storeSession('error-state', session)).rejects.toThrow('Session storage failed');
    });
  });

  describe('getSession', () => {
    it('retrieves and parses session from Redis', async () => {
      const session: OAuthSession = {
        state: 'state-456',
        codeVerifier: 'verifier-def',
        codeChallenge: 'challenge-uvw',
        redirectUri: 'http://localhost:3000/callback',
        provider: 'microsoft',
        scopes: ['openid', 'profile'],
        expiresAt: Date.now() + 300000,
      };

      mockKv.get.mockResolvedValueOnce(JSON.stringify(session));

      const result = await store.getSession('state-456');

      expect(mockKv.get).toHaveBeenCalledWith('oauth:session:state-456');
      expect(result).toEqual(session);
    });

    it('returns null when session not found', async () => {
      mockKv.get.mockResolvedValueOnce(null);

      const result = await store.getSession('nonexistent-state');

      expect(result).toBeNull();
    });

    it('returns null and deletes expired session', async () => {
      const expiredSession: OAuthSession = {
        state: 'expired-state',
        codeVerifier: 'verifier',
        codeChallenge: 'challenge',
        redirectUri: 'http://localhost:3000/callback',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() - 100000, // Expired
      };

      mockKv.get.mockResolvedValueOnce(JSON.stringify(expiredSession));
      mockKv.del.mockResolvedValueOnce(1);

      const result = await store.getSession('expired-state');

      expect(result).toBeNull();
      expect(mockKv.del).toHaveBeenCalledWith('oauth:session:expired-state');
    });

    it('handles retrieval errors gracefully', async () => {
      mockKv.get.mockRejectedValueOnce(new Error('Network error'));

      const result = await store.getSession('error-state');

      expect(result).toBeNull();
    });
  });

  describe('deleteSession', () => {
    it('deletes session from Redis', async () => {
      mockKv.del.mockResolvedValueOnce(1);

      await store.deleteSession('state-to-delete');

      expect(mockKv.del).toHaveBeenCalledWith('oauth:session:state-to-delete');
    });

    it('handles deletion errors gracefully', async () => {
      mockKv.del.mockRejectedValueOnce(new Error('Redis error'));

      // Should not throw
      await expect(store.deleteSession('error-state')).resolves.toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('returns 0 as TTL handles cleanup automatically', async () => {
      const result = await store.cleanup();

      expect(result).toBe(0);
      expect(mockKv.del).not.toHaveBeenCalled();
    });
  });

  describe('getSessionCount', () => {
    it('returns count of active sessions', async () => {
      mockKv.keys.mockResolvedValueOnce([
        'oauth:session:state-1',
        'oauth:session:state-2',
        'oauth:session:state-3',
      ]);

      const count = await store.getSessionCount();

      expect(count).toBe(3);
      expect(mockKv.keys).toHaveBeenCalledWith('oauth:session:*');
    });

    it('returns 0 on error', async () => {
      mockKv.keys.mockRejectedValueOnce(new Error('Redis error'));

      const count = await store.getSessionCount();

      expect(count).toBe(0);
    });
  });

  describe('dispose', () => {
    it('disposes without errors', () => {
      expect(() => store.dispose()).not.toThrow();
    });
  });
});

describe('VercelKVOAuthTokenStore', () => {
  let store: VercelKVOAuthTokenStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new VercelKVOAuthTokenStore();
  });

  describe('storeToken', () => {
    it('stores token with TTL based on expiration', async () => {
      const now = Date.now();
      const tokenInfo: StoredTokenInfo = {
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-456',
        expiresAt: now + 3600000, // 1 hour
        userInfo: {
          sub: 'user-123',
          email: 'user@example.com',
          name: 'Test User',
          provider: 'google',
        },
        provider: 'google',
        scopes: ['openid', 'email'],
      };

      mockKv.setex.mockResolvedValueOnce('OK');

      await store.storeToken('access-token-123', tokenInfo);

      // TTL can vary by 1 second due to timing
      const call = mockKv.setex.mock.calls[0];
      expect(call).toBeDefined();
      expect(call![0]).toBe('oauth:token:access-token-123');
      expect(call![1]).toBeGreaterThanOrEqual(3599);
      expect(call![1]).toBeLessThanOrEqual(3600);
      expect(call![2]).toBe(JSON.stringify(tokenInfo));
    });

    it('uses minimum TTL of 1 second for tokens about to expire', async () => {
      const now = Date.now();
      const tokenInfo: StoredTokenInfo = {
        accessToken: 'expiring-token',
        expiresAt: now + 500, // 0.5 seconds
        userInfo: {
          sub: 'user-456',
          email: 'test@example.com',
          name: 'User',
          provider: 'github',
        },
        provider: 'github',
        scopes: ['user:email'],
      };

      mockKv.setex.mockResolvedValueOnce('OK');

      await store.storeToken('expiring-token', tokenInfo);

      expect(mockKv.setex).toHaveBeenCalledWith(
        'oauth:token:expiring-token',
        1, // Minimum 1 second
        JSON.stringify(tokenInfo)
      );
    });
  });

  describe('getToken', () => {
    it('retrieves and parses token from Redis', async () => {
      const tokenInfo: StoredTokenInfo = {
        accessToken: 'stored-token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
        userInfo: {
          sub: 'user-789',
          email: 'stored@example.com',
          name: 'Stored User',
          provider: 'microsoft',
        },
        provider: 'microsoft',
        scopes: ['openid', 'profile'],
      };

      mockKv.get.mockResolvedValueOnce(JSON.stringify(tokenInfo));

      const result = await store.getToken('stored-token');

      expect(mockKv.get).toHaveBeenCalledWith('oauth:token:stored-token');
      expect(result).toEqual(tokenInfo);
    });

    it('returns null when token not found', async () => {
      mockKv.get.mockResolvedValueOnce(null);

      const result = await store.getToken('nonexistent-token');

      expect(result).toBeNull();
    });

    it('returns null and deletes expired token', async () => {
      const expiredToken: StoredTokenInfo = {
        accessToken: 'expired-token',
        expiresAt: Date.now() - 1000, // Expired
        userInfo: {
          sub: 'user-expired',
          email: 'expired@example.com',
          name: 'Expired',
          provider: 'google',
        },
        provider: 'google',
        scopes: ['openid'],
      };

      mockKv.get.mockResolvedValueOnce(JSON.stringify(expiredToken));
      mockKv.del.mockResolvedValueOnce(1);

      const result = await store.getToken('expired-token');

      expect(result).toBeNull();
      expect(mockKv.del).toHaveBeenCalledWith('oauth:token:expired-token');
    });
  });

  describe('deleteToken', () => {
    it('deletes token from Redis', async () => {
      mockKv.del.mockResolvedValueOnce(1);

      await store.deleteToken('token-to-delete');

      expect(mockKv.del).toHaveBeenCalledWith('oauth:token:token-to-delete');
    });
  });

  describe('cleanup', () => {
    it('returns 0 as Redis auto-expiration handles cleanup', async () => {
      const result = await store.cleanup();

      expect(result).toBe(0);
    });
  });

  describe('getTokenCount', () => {
    it('returns count of active tokens using scan', async () => {
      // First scan iteration
      mockKv.scan.mockResolvedValueOnce([
        '10', // Next cursor
        ['oauth:token:token1', 'oauth:token:token2'],
      ]);

      // Second scan iteration
      mockKv.scan.mockResolvedValueOnce([
        '0', // Cursor 0 means done
        ['oauth:token:token3'],
      ]);

      const count = await store.getTokenCount();

      expect(count).toBe(3);
      expect(mockKv.scan).toHaveBeenCalledTimes(2);
    });

    it('handles string cursor from scan result', async () => {
      mockKv.scan.mockResolvedValueOnce([
        '0', // String cursor
        ['oauth:token:token1'],
      ]);

      const count = await store.getTokenCount();

      expect(count).toBe(1);
    });
  });

  describe('dispose', () => {
    it('disposes without errors', () => {
      expect(() => store.dispose()).not.toThrow();
    });
  });
});
