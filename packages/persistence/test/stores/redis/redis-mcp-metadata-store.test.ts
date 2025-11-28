/**
 * Unit tests for RedisMCPMetadataStore - Encryption Validation
 *
 * CRITICAL: These tests verify that MCP session metadata is encrypted before
 * storing in Redis. Without encryption, PII (email, user IDs, provider info)
 * would be exposed in Redis as plaintext JSON.
 *
 * Security Requirements:
 * - Session data MUST be encrypted with AES-256-GCM before storing
 * - Direct Redis inspection should show encrypted data, not plaintext JSON
 * - TokenEncryptionService MUST be required in constructor
 * - Store MUST fail fast if encryption service not provided
 */

import { vi } from 'vitest';
import { RedisMCPMetadataStore, MCPSessionMetadata } from '../../../src/index.js';
import { TokenEncryptionService } from '../../../src/encryption/token-encryption-service.js';

// Hoist Redis mock to avoid initialization issues

/* eslint-disable sonarjs/no-unused-vars */
const RedisMock = vi.hoisted(() => require('ioredis-mock'));

// Mock Redis for testing - Vitest requires both default and named exports
vi.mock('ioredis', () => ({
  default: RedisMock,
  Redis: RedisMock,
}));

// Create a shared Redis instance for direct inspection
let sharedRedis: any = null;

describe('RedisMCPMetadataStore - Encryption Validation', () => {
  let store: RedisMCPMetadataStore;
  let encryptionService: TokenEncryptionService;

  beforeEach(async () => {
    // Set encryption key for tests (required - must be 32 bytes base64)
    process.env.TOKEN_ENCRYPTION_KEY = 'Wp3suOcV+cleewUEOGUkE7JNgsnzwmiBMNqF7q9sQSI=';

    // Create encryption service
    encryptionService = new TokenEncryptionService({
      encryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
    });

    // Create shared Redis instance if not exists
    if (!sharedRedis) {
      sharedRedis = new (RedisMock as any)();
    }

    // Flush all data between tests
    await sharedRedis.flushall();
  });

  afterAll(async () => {
    // Clean up shared Redis instance
    if (sharedRedis) {
      await sharedRedis.quit();
      sharedRedis = null;
    }
  });

  describe('Constructor Requirements', () => {
    it('should require TokenEncryptionService parameter', () => {
      // CRITICAL: Constructor should throw if encryption service not provided
      // Zero-tolerance security stance - no silent fallback to unencrypted storage
      expect(() => {
         
        const _store = new RedisMCPMetadataStore('redis://localhost:6379', undefined as any);
      }).toThrow(/TokenEncryptionService is REQUIRED/);
    });

    it('should accept TokenEncryptionService in constructor', () => {
      // Valid constructor call with encryption service
      expect(() => {
        const store = new RedisMCPMetadataStore('redis://localhost:6379', encryptionService);
        expect(store).toBeDefined();
      }).not.toThrow();
    });
  });

  describe('Encryption at Rest', () => {
    beforeEach(() => {
      // NOTE: This will fail until we fix the constructor signature
      // For now, we'll skip creating the store in beforeEach
    });

    it('should encrypt session data before storing in Redis', async () => {
      // CRITICAL TEST: Verifies that session data is encrypted, not plaintext JSON
      //
      // Without encryption, this data would be visible in Redis:
      // { "user": { "email": "jeff.r.dutton@gmail.com" }, ... }
      //
      // With encryption, Redis should contain base64-encoded encrypted data

      // Create store with encryption service (will fail until constructor updated)
      store = new (RedisMCPMetadataStore as any)('redis://localhost:6379', encryptionService);

      const sessionId = 'test-session-123';
      const metadata: MCPSessionMetadata = {
        sessionId,
        state: 'test-state',
        transport: 'http',
        createdAt: Date.now(),
        expiresAt: Date.now() + 600000, // 10 minutes
        user: {
          email: 'jeff.r.dutton@gmail.com', // PII - MUST be encrypted!
          sub: 'user-123',
          name: 'Test User',
          provider: 'google',
        },
        provider: 'google',
        scopes: ['openid', 'email', 'profile'],
      };

      await store.storeSession(sessionId, metadata);

      // Direct Redis inspection - verify data is encrypted
      const key = `mcp:session:${sessionId}`;
      const rawData = await sharedRedis.get(key);

      // CRITICAL ASSERTION: Data should NOT be parseable as JSON (it's encrypted)
      expect(() => JSON.parse(rawData)).toThrow();

      // CRITICAL ASSERTION: Email should NOT be visible in plaintext
      expect(rawData).not.toContain('jeff.r.dutton@gmail.com');
      expect(rawData).not.toContain('Test User');
      expect(rawData).not.toContain('google');

      // Verify data can be retrieved and decrypted through the store
      const retrieved = await store.getSession(sessionId);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.user.email).toBe('jeff.r.dutton@gmail.com');
      expect(retrieved?.provider).toBe('google');
    });

    it('should decrypt session data when reading from Redis', async () => {
      store = new (RedisMCPMetadataStore as any)('redis://localhost:6379', encryptionService);

      const sessionId = 'test-session-456';
      const metadata: MCPSessionMetadata = {
        sessionId,
        state: 'test-state-2',
        transport: 'http',
        createdAt: Date.now(),
        expiresAt: Date.now() + 600000,
        user: {
          email: 'test@example.com',
          sub: 'user-456',
          name: 'Another User',
          provider: 'github',
        },
        provider: 'github',
        scopes: ['user:email'],
      };

      await store.storeSession(sessionId, metadata);

      // Retrieve and verify decryption works
      const retrieved = await store.getSession(sessionId);
      expect(retrieved).toEqual(metadata);
    });

    it('should fail fast on decryption errors', async () => {
      store = new (RedisMCPMetadataStore as any)('redis://localhost:6379', encryptionService);

      const sessionId = 'corrupt-session';
      const key = `mcp:session:${sessionId}`;

      // Store corrupted/invalid encrypted data
      await sharedRedis.setex(key, 3600, 'invalid-encrypted-data-not-base64');

      // Should fail fast when trying to decrypt
      await expect(store.getSession(sessionId)).rejects.toThrow();
    });
  });

  describe('TTL and Expiration', () => {
    it('should set Redis TTL based on expiresAt', async () => {
      store = new (RedisMCPMetadataStore as any)('redis://localhost:6379', encryptionService);

      const sessionId = 'ttl-session';
      const expiresAt = Date.now() + 10000; // 10 seconds from now

      const metadata: MCPSessionMetadata = {
        sessionId,
        state: 'test-state',
        transport: 'http',
        createdAt: Date.now(),
        expiresAt,
        user: {
          email: 'ttl@example.com',
          sub: 'user-ttl',
          name: 'TTL User',
          provider: 'google',
        },
        provider: 'google',
        scopes: ['openid'],
      };

      await store.storeSession(sessionId, metadata);

      // Check TTL is set correctly (within 1 second margin)
      const key = `mcp:session:${sessionId}`;
      const ttl = await sharedRedis.ttl(key);
      expect(ttl).toBeGreaterThan(8); // At least 8 seconds remaining
      expect(ttl).toBeLessThanOrEqual(10); // At most 10 seconds
    });
  });
});
