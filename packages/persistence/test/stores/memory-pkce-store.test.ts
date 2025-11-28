/**
 * Unit tests for MemoryPKCEStore
 */

import { MemoryPKCEStore , PKCEData } from '../../src/index.js';

describe('MemoryPKCEStore', () => {
  let store: MemoryPKCEStore;

  beforeEach(() => {
    store = new MemoryPKCEStore();
  });

  afterEach(async () => {
    await store.clear();
  });

  describe('storeCodeVerifier', () => {
    it('should store PKCE data', async () => {
      const code = 'test_auth_code';
      const data: PKCEData = {
        codeVerifier: 'test_code_verifier',
        state: 'test_state'
      };

      await store.storeCodeVerifier(code, data);

      const retrieved = await store.getCodeVerifier(code);
      expect(retrieved).toEqual(data);
    });

    it('should expire data after TTL', async () => {
      const code = 'test_auth_code';
      const data: PKCEData = {
        codeVerifier: 'test_code_verifier',
        state: 'test_state'
      };

      // Store with 1 second TTL
      await store.storeCodeVerifier(code, data, 1);

      // Data should exist immediately
      let retrieved = await store.getCodeVerifier(code);
      expect(retrieved).toEqual(data);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Data should be gone
      retrieved = await store.getCodeVerifier(code);
      expect(retrieved).toBeNull();
    });
  });

  describe('getCodeVerifier', () => {
    it('should return null for non-existent code', async () => {
      const retrieved = await store.getCodeVerifier('non_existent_code');
      expect(retrieved).toBeNull();
    });

    it('should return stored data', async () => {
      const code = 'test_auth_code';
      const data: PKCEData = {
        codeVerifier: 'test_code_verifier',
        state: 'test_state'
      };

      await store.storeCodeVerifier(code, data);

      const retrieved = await store.getCodeVerifier(code);
      expect(retrieved).toEqual(data);
    });
  });

  describe('getAndDeleteCodeVerifier', () => {
    it('should return null for non-existent code', async () => {
      const retrieved = await store.getAndDeleteCodeVerifier('non_existent_code');
      expect(retrieved).toBeNull();
    });

    it('should return and delete stored data atomically', async () => {
      const code = 'test_auth_code';
      const data: PKCEData = {
        codeVerifier: 'test_code_verifier',
        state: 'test_state'
      };

      await store.storeCodeVerifier(code, data);

      // First retrieval should return data and delete it
      const retrieved = await store.getAndDeleteCodeVerifier(code);
      expect(retrieved).toEqual(data);

      // Second retrieval should return null (already deleted)
      const secondRetrieval = await store.getAndDeleteCodeVerifier(code);
      expect(secondRetrieval).toBeNull();

      // Regular get should also return null
      const getAfterDelete = await store.getCodeVerifier(code);
      expect(getAfterDelete).toBeNull();
    });

    it('should prevent code reuse attacks', async () => {
      const code = 'test_auth_code';
      const data: PKCEData = {
        codeVerifier: 'test_code_verifier',
        state: 'test_state'
      };

      await store.storeCodeVerifier(code, data);

      // First token exchange succeeds
      const firstExchange = await store.getAndDeleteCodeVerifier(code);
      expect(firstExchange).toEqual(data);

      // Replay attack fails (code already used)
      const replayAttempt = await store.getAndDeleteCodeVerifier(code);
      expect(replayAttempt).toBeNull();
    });
  });

  describe('hasCodeVerifier', () => {
    it('should return false for non-existent code', async () => {
      const exists = await store.hasCodeVerifier('non_existent_code');
      expect(exists).toBe(false);
    });

    it('should return true for stored code', async () => {
      const code = 'test_auth_code';
      const data: PKCEData = {
        codeVerifier: 'test_code_verifier',
        state: 'test_state'
      };

      await store.storeCodeVerifier(code, data);

      const exists = await store.hasCodeVerifier(code);
      expect(exists).toBe(true);
    });

    it('should return false after deletion', async () => {
      const code = 'test_auth_code';
      const data: PKCEData = {
        codeVerifier: 'test_code_verifier',
        state: 'test_state'
      };

      await store.storeCodeVerifier(code, data);
      await store.deleteCodeVerifier(code);

      const exists = await store.hasCodeVerifier(code);
      expect(exists).toBe(false);
    });
  });

  describe('deleteCodeVerifier', () => {
    it('should delete stored data', async () => {
      const code = 'test_auth_code';
      const data: PKCEData = {
        codeVerifier: 'test_code_verifier',
        state: 'test_state'
      };

      await store.storeCodeVerifier(code, data);
      await store.deleteCodeVerifier(code);

      const retrieved = await store.getCodeVerifier(code);
      expect(retrieved).toBeNull();
    });

    it('should not throw for non-existent code', async () => {
      await expect(store.deleteCodeVerifier('non_existent_code')).resolves.not.toThrow();
    });
  });

  describe('multi-provider routing support', () => {
    it('should support checking multiple providers for authorization code', async () => {
      const code = 'google_auth_code';
      const googleData: PKCEData = {
        codeVerifier: 'google_verifier',
        state: 'google_state'
      };

      // Simulate Google provider storing code
      await store.storeCodeVerifier(code, googleData);

      // Simulate multi-provider routing checking which provider has the code
      const hasGoogle = await store.hasCodeVerifier(code);
      const hasGitHub = await store.hasCodeVerifier('github_auth_code');
      const hasMicrosoft = await store.hasCodeVerifier('microsoft_auth_code');

      expect(hasGoogle).toBe(true);
      expect(hasGitHub).toBe(false);
      expect(hasMicrosoft).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all stored data', async () => {
      const code1 = 'code1';
      const code2 = 'code2';
      const data: PKCEData = {
        codeVerifier: 'verifier',
        state: 'state'
      };

      await store.storeCodeVerifier(code1, data);
      await store.storeCodeVerifier(code2, data);

      expect(store.size).toBe(2);

      await store.clear();

      expect(store.size).toBe(0);
      expect(await store.getCodeVerifier(code1)).toBeNull();
      expect(await store.getCodeVerifier(code2)).toBeNull();
    });
  });
});
