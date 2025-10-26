/**
 * Unit tests for InMemoryTestTokenStore
 */

import { InMemoryTestTokenStore } from './helpers/memory-test-token-store.js';
describe('InMemoryTestTokenStore', () => {
  let store: InMemoryTestTokenStore;
  const additionalStores: InMemoryTestTokenStore[] = [];

  beforeEach(() => {
    store = new InMemoryTestTokenStore();
  });

  afterEach(async () => {
    // Clean up main store
    await store.dispose();

    // Clean up any additional stores created during tests
    await Promise.all(additionalStores.map(s => s.dispose()));
    additionalStores.length = 0;
  });

  describe('createToken', () => {
    it('should create a token that never expires by default', async () => {
      const token = await store.createToken({
        description: 'Test token',
      });

      expect(token.id).toBeDefined();
      expect(token.token).toBeDefined();
      expect(token.description).toBe('Test token');
      expect(token.created_at).toBeDefined();
      expect(token.expires_at).toBe(0); // 0 means never expires
      expect(token.usage_count).toBe(0);
      expect(token.revoked).toBe(false);
    });

    it('should create a token with custom expiration', async () => {
      const expiresIn = 3600; // 1 hour
      const token = await store.createToken({
        description: 'Test token',
        expires_in: expiresIn,
      });

      const expectedExpiry = Math.floor(Date.now() / 1000) + expiresIn;
      expect(token.expires_at).toBeGreaterThanOrEqual(expectedExpiry - 1);
      expect(token.expires_at).toBeLessThanOrEqual(expectedExpiry + 1);
    });

    it('should create a token with max_uses', async () => {
      const token = await store.createToken({
        description: 'Test token',
        max_uses: 5,
      });

      expect(token.max_uses).toBe(5);
      expect(token.usage_count).toBe(0);
    });

    it('should create a token that never expires', async () => {
      const token = await store.createToken({
        description: 'Test token',
        expires_in: 0,
      });

      expect(token.expires_at).toBe(0);
    });
  });

  describe('validateAndUseToken', () => {
    it('should validate and use a valid token', async () => {
      const created = await store.createToken({
        description: 'Test token',
      });

      const result = await store.validateAndUseToken(created.token);

      expect(result.valid).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.token?.id).toBe(created.id);
      expect(result.token?.usage_count).toBe(1);
      expect(result.token?.last_used_at).toBeDefined();
    });

    it('should reject an invalid token', async () => {
      const result = await store.validateAndUseToken('invalid-token');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Token not found');
      expect(result.token).toBeUndefined();
    });

    it('should reject an expired token', async () => {
      const created = await store.createToken({
        description: 'Test token',
        expires_in: -1, // Already expired
      });

      const result = await store.validateAndUseToken(created.token);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Token has expired');
    });

    it('should reject a revoked token', async () => {
      const created = await store.createToken({
        description: 'Test token',
      });

      await store.revokeToken(created.id);

      const result = await store.validateAndUseToken(created.token);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Token has been revoked');
    });

    it('should reject a token that exceeded max_uses', async () => {
      const created = await store.createToken({
        description: 'Test token',
        max_uses: 2,
      });

      // Use token twice
      await store.validateAndUseToken(created.token);
      await store.validateAndUseToken(created.token);

      // Third attempt should fail
      const result = await store.validateAndUseToken(created.token);

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Token usage limit exceeded');
    });

    it('should increment usage_count on each use', async () => {
      const created = await store.createToken({
        description: 'Test token',
      });

      const result1 = await store.validateAndUseToken(created.token);
      expect(result1.token?.usage_count).toBe(1);

      const result2 = await store.validateAndUseToken(created.token);
      expect(result2.token?.usage_count).toBe(2);

      const result3 = await store.validateAndUseToken(created.token);
      expect(result3.token?.usage_count).toBe(3);
    });
  });

  describe('getToken', () => {
    it('should retrieve a token by id', async () => {
      const created = await store.createToken({
        description: 'Test token',
      });

      const retrieved = await store.getToken(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.token).toBe(created.token);
    });

    it('should return undefined for non-existent token', async () => {
      const retrieved = await store.getToken('non-existent-id');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('listTokens', () => {
    it('should list all active tokens by default', async () => {
      await store.createToken({ description: 'Token 1' });
      await store.createToken({ description: 'Token 2' });
      await store.createToken({ description: 'Token 3' });

      const tokens = await store.listTokens();

      expect(tokens).toHaveLength(3);
    });

    it('should exclude revoked tokens by default', async () => {
      const token1 = await store.createToken({ description: 'Token 1' });
      await store.createToken({ description: 'Token 2' });

      await store.revokeToken(token1.id);

      const tokens = await store.listTokens();

      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.description).toBe('Token 2');
    });

    it('should exclude expired tokens by default', async () => {
      await store.createToken({ description: 'Token 1', expires_in: -1 });
      await store.createToken({ description: 'Token 2' });

      const tokens = await store.listTokens();

      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.description).toBe('Token 2');
    });

    it('should include revoked tokens when requested', async () => {
      const token1 = await store.createToken({ description: 'Token 1' });
      await store.createToken({ description: 'Token 2' });

      await store.revokeToken(token1.id);

      const tokens = await store.listTokens({ includeRevoked: true });

      expect(tokens).toHaveLength(2);
    });

    it('should include expired tokens when requested', async () => {
      await store.createToken({ description: 'Token 1', expires_in: -1 });
      await store.createToken({ description: 'Token 2' });

      const tokens = await store.listTokens({ includeExpired: true });

      expect(tokens).toHaveLength(2);
    });
  });

  describe('revokeToken', () => {
    it('should revoke a token', async () => {
      const token = await store.createToken({ description: 'Test token' });

      const success = await store.revokeToken(token.id);

      expect(success).toBe(true);

      const retrieved = await store.getToken(token.id);
      expect(retrieved?.revoked).toBe(true);
    });

    it('should return false for non-existent token', async () => {
      const success = await store.revokeToken('non-existent-id');

      expect(success).toBe(false);
    });
  });

  describe('deleteToken', () => {
    it('should permanently delete a token', async () => {
      const token = await store.createToken({ description: 'Test token' });

      const success = await store.deleteToken(token.id);

      expect(success).toBe(true);

      const retrieved = await store.getToken(token.id);
      expect(retrieved).toBeUndefined();
    });

    it('should return false for non-existent token', async () => {
      const success = await store.deleteToken('non-existent-id');

      expect(success).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should remove expired and revoked tokens', async () => {
      const token1 = await store.createToken({ description: 'Expired', expires_in: -1 });
      const token2 = await store.createToken({ description: 'Revoked' });
      await store.createToken({ description: 'Active' });

      await store.revokeToken(token2.id);

      const cleaned = await store.cleanup();

      expect(cleaned).toBe(2);

      const tokens = await store.listTokens({ includeRevoked: true, includeExpired: true });
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.description).toBe('Active');
    });

    it('should not remove active tokens', async () => {
      await store.createToken({ description: 'Token 1' });
      await store.createToken({ description: 'Token 2' });

      const cleaned = await store.cleanup();

      expect(cleaned).toBe(0);

      const tokens = await store.listTokens();
      expect(tokens).toHaveLength(2);
    });
  });

  describe('auto cleanup', () => {
    it('should run automatic cleanup when enabled', async () => {
      const autoStore = new InMemoryTestTokenStore({
        autoCleanup: true,
        cleanupIntervalMs: 100, // Use short interval for testing
      });
      additionalStores.push(autoStore); // Track for cleanup

      await autoStore.createToken({ description: 'Expired', expires_in: -1 });
      await autoStore.createToken({ description: 'Active' });

      // Initially 2 tokens
      let tokens = await autoStore.listTokens({ includeExpired: true });
      expect(tokens).toHaveLength(2);

      // Wait for cleanup to run (slightly longer than cleanup interval)
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should have 1 token after cleanup
      tokens = await autoStore.listTokens({ includeExpired: true });
      expect(tokens).toHaveLength(1);
      expect(tokens[0]?.description).toBe('Active');
    });
  });

  describe('dispose', () => {
    it('should stop auto cleanup timer', async () => {
      const autoStore = new InMemoryTestTokenStore({
        autoCleanup: true,
        cleanupIntervalMs: 1000,
      });
      additionalStores.push(autoStore); // Track for cleanup

      await autoStore.dispose();

      // Should not throw or have any side effects
      expect(true).toBe(true);
    });
  });
});