/**
 * Unit tests for Vercel KV Client Store and Token Store
 *
 * Tests Dynamic Client Registration client storage and Initial Access Token storage
 * using Vercel KV (Redis) for serverless persistence.
 */

import { VercelKVClientStore } from '../../../../src/auth/stores/vercel-kv-client-store.js';
import { VercelKVTokenStore } from '../../../../src/auth/stores/vercel-kv-token-store.js';
import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

// Mock @vercel/kv
jest.mock('@vercel/kv', () => ({
  kv: {
    scard: jest.fn(),
    setex: jest.fn(),
    set: jest.fn(),
    sadd: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    srem: jest.fn(),
    smembers: jest.fn(),
    scan: jest.fn(),
    exists: jest.fn(),
    mget: jest.fn(),
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

describe('VercelKVClientStore', () => {
  let store: VercelKVClientStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new VercelKVClientStore({
      defaultSecretExpirySeconds: 2592000, // 30 days
      maxClients: 100,
    });
  });

  describe('registerClient', () => {
    it('registers a new client with TTL', async () => {
      const clientInfo = {
        client_name: 'Test Client',
        redirect_uris: ['http://localhost:3000/callback'],
        grant_types: ['authorization_code'],
      };

      mockKv.scard.mockResolvedValueOnce(10); // Current count
      mockKv.setex.mockResolvedValueOnce('OK');
      mockKv.sadd.mockResolvedValueOnce(1);

      const result = await store.registerClient(clientInfo);

      expect(result.client_id).toBeDefined();
      expect(result.client_secret).toBeDefined();
      expect(result.client_name).toBe('Test Client');
      expect(result.client_id_issued_at).toBeDefined();
      expect(result.client_secret_expires_at).toBeDefined();
      expect(mockKv.setex).toHaveBeenCalled();
      expect(mockKv.sadd).toHaveBeenCalled();
    });

    it('registers a client without TTL when expiry is 0', async () => {
      const clientInfo = {
        client_name: 'Permanent Client',
        redirect_uris: ['http://localhost:3000/callback'],
      };

      store = new VercelKVClientStore({
        defaultSecretExpirySeconds: 0, // No expiration
        maxClients: 100,
      });

      mockKv.scard.mockResolvedValueOnce(5);
      mockKv.set.mockResolvedValueOnce('OK');
      mockKv.sadd.mockResolvedValueOnce(1);

      const result = await store.registerClient(clientInfo);

      expect(result.client_secret_expires_at).toBeUndefined();
      expect(mockKv.set).toHaveBeenCalled();
      expect(mockKv.setex).not.toHaveBeenCalled();
    });

    it('throws error when max clients limit reached', async () => {
      mockKv.scard.mockResolvedValueOnce(100); // At limit

      const clientInfo = {
        client_name: 'Test Client',
        redirect_uris: ['http://localhost:3000/callback'],
      };

      await expect(store.registerClient(clientInfo)).rejects.toThrow('Maximum number of registered clients reached');
      expect(mockKv.setex).not.toHaveBeenCalled();
    });
  });

  describe('getClient', () => {
    it('retrieves and parses client from KV', async () => {
      const clientData: OAuthClientInformationFull = {
        client_id: 'client-123',
        client_secret: 'secret-456',
        client_name: 'Test Client',
        redirect_uris: ['http://localhost:3000/callback'],
        client_id_issued_at: Date.now() / 1000,
      };

      mockKv.get.mockResolvedValueOnce(JSON.stringify(clientData));

      const result = await store.getClient('client-123');

      expect(result).toEqual(clientData);
      expect(mockKv.get).toHaveBeenCalledWith('oauth:client:client-123');
    });

    it('returns undefined when client not found', async () => {
      mockKv.get.mockResolvedValueOnce(null);

      const result = await store.getClient('nonexistent');

      expect(result).toBeUndefined();
    });

    it('returns client even if expired (TTL handles cleanup)', async () => {
      const expiredClient = {
        client_id: 'expired-client',
        client_secret: 'secret',
        client_name: 'Expired',
        redirect_uris: ['http://localhost/callback'],
        client_id_issued_at: Date.now() / 1000 - 3600,
        client_secret_expires_at: Date.now() / 1000 - 10,
        registered_at: Date.now(),
      };

      mockKv.get.mockResolvedValueOnce(JSON.stringify(expiredClient));

      const result = await store.getClient('expired-client');

      // Client is returned even if expired - TTL will auto-delete from KV
      expect(result).toEqual(expiredClient);
    });
  });

  describe('deleteClient', () => {
    it('deletes client from KV and index', async () => {
      mockKv.exists.mockResolvedValueOnce(1);
      mockKv.del.mockResolvedValueOnce(1);
      mockKv.srem.mockResolvedValueOnce(1);

      const result = await store.deleteClient('client-to-delete');

      expect(result).toBe(true);
      expect(mockKv.exists).toHaveBeenCalledWith('oauth:client:client-to-delete');
      expect(mockKv.del).toHaveBeenCalledWith('oauth:client:client-to-delete');
      expect(mockKv.srem).toHaveBeenCalledWith('oauth:clients:index', 'client-to-delete');
    });

    it('returns false when client does not exist', async () => {
      mockKv.exists.mockResolvedValueOnce(0);

      const result = await store.deleteClient('nonexistent');

      expect(result).toBe(false);
      expect(mockKv.del).not.toHaveBeenCalled();
    });
  });

  describe('listClients', () => {
    it('lists all registered clients', async () => {
      const clientIds = ['client-1', 'client-2', 'client-3'];
      const clients = clientIds.map((id) => ({
        client_id: id,
        client_secret: `secret-${id}`,
        client_name: `Client ${id}`,
        redirect_uris: ['http://localhost/callback'],
        client_id_issued_at: Date.now() / 1000,
        registered_at: Date.now(),
      }));

      mockKv.smembers.mockResolvedValueOnce(clientIds);
      mockKv.mget.mockResolvedValueOnce([
        JSON.stringify(clients[0]),
        JSON.stringify(clients[1]),
        JSON.stringify(clients[2]),
      ]);

      const result = await store.listClients();

      expect(result).toHaveLength(3);
      expect(result[0]?.client_id).toBe('client-1');
      expect(mockKv.mget).toHaveBeenCalledWith(
        'oauth:client:client-1',
        'oauth:client:client-2',
        'oauth:client:client-3'
      );
    });

    it('handles empty client list', async () => {
      mockKv.smembers.mockResolvedValueOnce([]);

      const result = await store.listClients();

      expect(result).toEqual([]);
    });

    it('filters out expired clients from results', async () => {
      const clientIds = ['client-1', 'client-2', 'client-3'];
      const clients = [
        {
          client_id: 'client-1',
          client_secret: 'secret-1',
          client_name: 'Client 1',
          redirect_uris: ['http://localhost/callback'],
          client_id_issued_at: Date.now() / 1000,
          registered_at: Date.now(),
        },
        {
          client_id: 'client-3',
          client_secret: 'secret-3',
          client_name: 'Client 3',
          redirect_uris: ['http://localhost/callback'],
          client_id_issued_at: Date.now() / 1000,
          registered_at: Date.now(),
        },
      ];

      mockKv.smembers.mockResolvedValueOnce(clientIds);
      // client-2 is null (expired)
      mockKv.mget.mockResolvedValueOnce([
        JSON.stringify(clients[0]),
        null, // client-2 expired
        JSON.stringify(clients[1]),
      ]);
      mockKv.srem.mockResolvedValueOnce(1);

      const result = await store.listClients();

      expect(result).toHaveLength(2);
      expect(result[0]?.client_id).toBe('client-1');
      expect(result[1]?.client_id).toBe('client-3');
      // Should have removed expired client from index
      expect(mockKv.srem).toHaveBeenCalledWith('oauth:clients:index', 'client-2');
    });
  });
});

describe('VercelKVTokenStore', () => {
  let store: VercelKVTokenStore;

  beforeEach(() => {
    jest.clearAllMocks();
    store = new VercelKVTokenStore();
  });

  describe('createToken', () => {
    it('creates token with expiration and TTL', async () => {
      mockKv.set.mockResolvedValue('OK');
      mockKv.sadd.mockResolvedValueOnce(1);

      const result = await store.createToken({
        description: 'Test token',
        expires_in: 3600,
        max_uses: 10,
      });

      expect(result.id).toBeDefined();
      expect(result.token).toBeDefined();
      expect(result.description).toBe('Test token');
      expect(result.expires_at).toBeGreaterThan(0);
      expect(result.max_uses).toBe(10);
      expect(result.usage_count).toBe(0);
      expect(result.revoked).toBe(false);
      expect(mockKv.set).toHaveBeenCalledTimes(2); // Token key and value key
      expect(mockKv.sadd).toHaveBeenCalled();
    });

    it('creates token without expiration', async () => {
      mockKv.set.mockResolvedValue('OK');
      mockKv.sadd.mockResolvedValueOnce(1);

      const result = await store.createToken({
        description: 'Permanent token',
      });

      expect(result.expires_at).toBe(0);
      expect(mockKv.set).toHaveBeenCalledTimes(2);
    });
  });

  describe('validateAndUseToken', () => {
    it('validates and increments usage count for valid token', async () => {
      const tokenData = {
        id: 'token-id',
        token: 'valid-token',
        description: 'Test',
        created_at: Date.now() / 1000 - 60,
        expires_at: Date.now() / 1000 + 3600,
        usage_count: 0,
        max_uses: 10,
        revoked: false,
      };

      mockKv.get
        .mockResolvedValueOnce('token-id') // Value lookup (dcr:value:valid-token → token-id)
        .mockResolvedValueOnce(JSON.stringify(tokenData)); // Token data (dcr:token:token-id → data)

      mockKv.set.mockResolvedValue('OK');

      const result = await store.validateAndUseToken('valid-token');

      expect(result.valid).toBe(true);
      expect(result.token?.usage_count).toBe(1);
      expect(result.token?.last_used_at).toBeDefined();
      expect(mockKv.set).toHaveBeenCalledWith(
        'dcr:token:token-id',
        expect.stringContaining('"usage_count":1')
      );
    });

    it('rejects expired token', async () => {
      const expiredToken = {
        id: 'expired-id',
        token: 'expired-token',
        description: 'Expired',
        created_at: Date.now() / 1000 - 7200,
        expires_at: Date.now() / 1000 - 3600,
        usage_count: 0,
        revoked: false,
      };

      mockKv.get
        .mockResolvedValueOnce('expired-id')
        .mockResolvedValueOnce(JSON.stringify(expiredToken));

      const result = await store.validateAndUseToken('expired-token');

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/expired/i);
    });

    it('rejects revoked token', async () => {
      const revokedToken = {
        id: 'revoked-id',
        token: 'revoked-token',
        description: 'Revoked',
        created_at: Date.now() / 1000 - 60,
        expires_at: Date.now() / 1000 + 3600,
        usage_count: 5,
        revoked: true,
      };

      mockKv.get
        .mockResolvedValueOnce('revoked-id')
        .mockResolvedValueOnce(JSON.stringify(revokedToken));

      const result = await store.validateAndUseToken('revoked-token');

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/revoked/i);
    });

    it('rejects token that exceeded max uses', async () => {
      const maxedToken = {
        id: 'maxed-id',
        token: 'maxed-token',
        description: 'Maxed',
        created_at: Date.now() / 1000 - 60,
        expires_at: Date.now() / 1000 + 3600,
        usage_count: 10,
        max_uses: 10,
        revoked: false,
      };

      mockKv.get
        .mockResolvedValueOnce('maxed-id')
        .mockResolvedValueOnce(JSON.stringify(maxedToken));

      const result = await store.validateAndUseToken('maxed-token');

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/usage.*limit|maximum usage|max.*use/i);
    });

    it('rejects non-existent token', async () => {
      mockKv.get.mockResolvedValueOnce(null);

      const result = await store.validateAndUseToken('nonexistent');

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/not found/i);
    });
  });

  describe('revokeToken', () => {
    it('revokes a token', async () => {
      const tokenData = {
        id: 'token-id',
        token: 'token-value',
        description: 'Test',
        created_at: Date.now() / 1000,
        expires_at: 0,
        usage_count: 0,
        revoked: false,
      };

      mockKv.get.mockResolvedValueOnce(JSON.stringify(tokenData));
      mockKv.set.mockResolvedValue('OK');

      const result = await store.revokeToken('token-id');

      expect(result).toBe(true);
      expect(mockKv.set).toHaveBeenCalled();
    });

    it('returns false for non-existent token', async () => {
      mockKv.get.mockResolvedValueOnce(null);

      const result = await store.revokeToken('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('deleteToken', () => {
    it('deletes token and value mapping', async () => {
      const tokenData = {
        id: 'token-id',
        token: 'token-value',
        description: 'Test',
        created_at: Date.now() / 1000,
        expires_at: 0,
        usage_count: 0,
        revoked: false,
      };

      mockKv.get.mockResolvedValueOnce(JSON.stringify(tokenData));
      mockKv.del.mockResolvedValue(2);
      mockKv.srem.mockResolvedValueOnce(1);

      const result = await store.deleteToken('token-id');

      expect(result).toBe(true);
      expect(mockKv.del).toHaveBeenCalledTimes(2); // Token key and value key
      expect(mockKv.srem).toHaveBeenCalled();
    });

    it('returns false when token not found', async () => {
      mockKv.get.mockResolvedValueOnce(null);

      const result = await store.deleteToken('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('returns 0 as TTL handles cleanup', async () => {
      const result = await store.cleanup();

      expect(result).toBe(0);
    });
  });

  describe('dispose', () => {
    it('disposes without errors', () => {
      expect(() => store.dispose()).not.toThrow();
    });
  });
});
