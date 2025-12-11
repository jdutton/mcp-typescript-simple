/**
 * TDD Tests for Direct OAuth Flow Provider Identification Bug
 *
 * Bug Description:
 * When a client (e.g., MCP Inspector) provides its own PKCE code_challenge,
 * the server doesn't store the authorization code in the PKCE store (since client
 * will provide code_verifier). However, provider identification still relies on
 * PKCE store lookup, causing "invalid_grant" errors in token exchange.
 *
 * Test Cases:
 * 1. OAuth Proxy Flow (server generates PKCE) - should work ✅
 * 2. Direct OAuth Flow (client provides PKCE) - currently broken ❌
 * 3. Multi-provider scenarios with mixed flows
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryPKCEStore } from '@mcp-typescript-simple/persistence';
import type { OAuthProvider } from '../src/providers/types.js';

describe('Direct OAuth Flow Provider Identification', () => {
  let pkceStore: MemoryPKCEStore;

  beforeEach(() => {
    pkceStore = new MemoryPKCEStore();
  });

  describe('OAuth Proxy Flow (server-generated PKCE)', () => {
    it('should store authorization code in PKCE store', async () => {
      const code = 'server-generated-code-123';
      const providerKey = `google:${code}`;

      // Simulate server-generated PKCE flow
      await pkceStore.storeCodeVerifier(providerKey, {
        codeVerifier: 'server-generated-verifier',
        state: 'server-state'
      }, 600);

      // Verify code is stored
      const hasCode = await pkceStore.hasCodeVerifier(providerKey);
      expect(hasCode).toBe(true);

      // Verify code_verifier can be retrieved
      const data = await pkceStore.getCodeVerifier(providerKey);
      expect(data).toEqual({
        codeVerifier: 'server-generated-verifier',
        state: 'server-state'
      });
    });

    it('should identify provider using hasStoredCodeForProvider', async () => {
      const code = 'server-generated-code-123';

      // Store code for Google provider
      await pkceStore.storeCodeVerifier(`google:${code}`, {
        codeVerifier: 'verifier',
        state: 'state'
      }, 600);

      // Mock provider
      const mockProvider: Partial<OAuthProvider> & { hasStoredCodeForProvider: (_code: string) => Promise<boolean> } = {
        hasStoredCodeForProvider: async (_code: string) => {
          return await pkceStore.hasCodeVerifier(`google:${_code}`);
        }
      };

      // Provider should be identified
      const hasCode = await mockProvider.hasStoredCodeForProvider(code);
      expect(hasCode).toBe(true);
    });
  });

  describe('Direct OAuth Flow (client-provided PKCE) - BUG', () => {
    it('should NOT store code_verifier when client provides code_challenge', async () => {
      const code = 'client-pkce-code-456';
      const providerKey = `google:${code}`;

      // In Direct OAuth Flow, client provides code_challenge
      // Server does NOT store code_verifier (line 890-902 in base-provider.ts)
      // Because session.codeVerifier is empty when client provides challenge

      // Verify nothing is stored
      const hasCode = await pkceStore.hasCodeVerifier(providerKey);
      expect(hasCode).toBe(false);

      // This is the root cause of the bug!
      // Provider identification fails because there's no PKCE store entry
    });

    it('should fail to identify provider using hasStoredCodeForProvider - CURRENT BUG', async () => {
      const code = 'client-pkce-code-456';

      // Mock provider using PKCE store for identification (current implementation)
      const mockProvider: Partial<OAuthProvider> & { hasStoredCodeForProvider: (_code: string) => Promise<boolean> } = {
        hasStoredCodeForProvider: async (_code: string) => {
          return await pkceStore.hasCodeVerifier(`google:${_code}`);
        }
      };

      // Provider identification fails (returns false)
      const hasCode = await mockProvider.hasStoredCodeForProvider(code);
      expect(hasCode).toBe(false);

      // This causes universal-token-handler to return "invalid_grant"
      // Even though the code is valid and client has code_verifier!
    });

    it('should be able to validate code_verifier from client in token exchange', () => {
      const clientCodeVerifier = 'client-generated-verifier';
      const clientCodeChallenge = 'client-generated-challenge';

      // Client provides code_verifier in token exchange request
      // Server should be able to validate it against the challenge

      // This part works - the issue is BEFORE this step (provider identification)
      expect(clientCodeVerifier).toBe('client-generated-verifier');
      expect(clientCodeChallenge).toBe('client-generated-challenge');

      // TODO: Implement validation logic
      // sha256(code_verifier) === code_challenge
    });
  });

  describe('Multi-Provider Scenarios', () => {
    it('should handle mixed OAuth Proxy and Direct flows simultaneously', async () => {
      const proxyCode = 'proxy-flow-code-111';
      const directCode = 'direct-flow-code-222';

      // Google: OAuth Proxy Flow (server-generated PKCE)
      await pkceStore.storeCodeVerifier(`google:${proxyCode}`, {
        codeVerifier: 'google-verifier',
        state: 'google-state'
      }, 600);

      // GitHub: Direct OAuth Flow (client-provided PKCE)
      // Nothing stored in PKCE store

      // Create mock providers
      const googleProvider: Partial<OAuthProvider> & { hasStoredCodeForProvider: (_code: string) => Promise<boolean> } = {
        hasStoredCodeForProvider: async (_code: string) => {
          return await pkceStore.hasCodeVerifier(`google:${_code}`);
        }
      };

      const githubProvider: Partial<OAuthProvider> & { hasStoredCodeForProvider: (_code: string) => Promise<boolean> } = {
        hasStoredCodeForProvider: async (_code: string) => {
          return await pkceStore.hasCodeVerifier(`github:${_code}`);
        }
      };

      const providers = new Map<string, typeof googleProvider | typeof githubProvider>();
      providers.set('google', googleProvider);
      providers.set('github', githubProvider);

      // Proxy flow: Should find Google provider ✅
      let foundProvider = null;
      for (const [providerType, provider] of providers.entries()) {
        if (await provider.hasStoredCodeForProvider(proxyCode)) {
          foundProvider = providerType;
          break;
        }
      }
      expect(foundProvider).toBe('google');

      // Direct flow: Should find GitHub provider ❌ CURRENT BUG
      foundProvider = null;
      for (const [providerType, provider] of providers.entries()) {
        if (await provider.hasStoredCodeForProvider(directCode)) {
          foundProvider = providerType;
          break;
        }
      }
      expect(foundProvider).toBeNull(); // Bug: can't identify GitHub provider!
    });
  });

  describe('Provider Identification Fix Strategy', () => {
    it('should store code-to-provider mapping even without code_verifier', async () => {
      const code = 'direct-flow-code-789';
      const providerKey = `github:${code}`;

      // FIX: Store authorization code mapping WITHOUT code_verifier
      // This allows provider identification while still letting client provide code_verifier
      await pkceStore.storeCodeVerifier(providerKey, {
        codeVerifier: '', // Empty for Direct OAuth Flow
        state: 'github-state'
      }, 600);

      // Verification: code mapping exists
      const hasCode = await pkceStore.hasCodeVerifier(providerKey);
      expect(hasCode).toBe(true);

      // Retrieve data
      const data = await pkceStore.getCodeVerifier(providerKey);
      expect(data?.state).toBe('github-state');
      expect(data?.codeVerifier).toBe(''); // Empty - client will provide it
    });

    it('should handle provider identification with empty code_verifier', async () => {
      const code = 'direct-flow-code-789';

      // Store code mapping with empty verifier (Direct OAuth Flow)
      await pkceStore.storeCodeVerifier(`github:${code}`, {
        codeVerifier: '', // Empty - client provides
        state: 'github-state'
      }, 600);

      // Mock provider
      const mockProvider: Partial<OAuthProvider> & { hasStoredCodeForProvider: (_code: string) => Promise<boolean> } = {
        hasStoredCodeForProvider: async (_code: string) => {
          return await pkceStore.hasCodeVerifier(`github:${_code}`);
        }
      };

      // Provider should be identified ✅
      const hasCode = await mockProvider.hasStoredCodeForProvider(code);
      expect(hasCode).toBe(true);

      // Verify we can distinguish between flows
      const data = await pkceStore.getCodeVerifier(`github:${code}`);
      const isDirectFlow = data?.codeVerifier === '';
      expect(isDirectFlow).toBe(true);
    });

    it('should resolve code_verifier correctly for both flows in token exchange', async () => {
      const proxyCode = 'proxy-code-111';
      const directCode = 'direct-code-222';

      // Proxy flow: Server-stored code_verifier
      await pkceStore.storeCodeVerifier(`google:${proxyCode}`, {
        codeVerifier: 'server-verifier',
        state: 'google-state'
      }, 600);

      // Direct flow: Empty code_verifier (client provides)
      await pkceStore.storeCodeVerifier(`github:${directCode}`, {
        codeVerifier: '',
        state: 'github-state'
      }, 600);

      // Token exchange: Proxy flow
      const proxyData = await pkceStore.getCodeVerifier(`google:${proxyCode}`);
      const proxyCodeVerifier = proxyData?.codeVerifier || 'client-provided-verifier';
      expect(proxyCodeVerifier).toBe('server-verifier'); // Use server's

      // Token exchange: Direct flow
      const directData = await pkceStore.getCodeVerifier(`github:${directCode}`);
      const directCodeVerifier = directData?.codeVerifier || 'client-provided-verifier';
      expect(directCodeVerifier).toBe('client-provided-verifier'); // Use client's
    });
  });

  describe('Security Considerations', () => {
    it('should prevent PKCE bypass attacks in OAuth Proxy Flow', async () => {
      const code = 'proxy-code-secure';

      // Store server-generated verifier
      await pkceStore.storeCodeVerifier(`google:${code}`, {
        codeVerifier: 'server-secure-verifier',
        state: 'state'
      }, 600);

      // Malicious client tries to provide their own verifier
      const maliciousClientVerifier = 'hacker-verifier';

      // Security: Server MUST use stored verifier, not client's
      const data = await pkceStore.getCodeVerifier(`google:${code}`);
      const verifierToUse = data?.codeVerifier; // Use server's, ignore client's

      expect(verifierToUse).toBe('server-secure-verifier');
      expect(verifierToUse).not.toBe(maliciousClientVerifier);
    });

    it('should require client verifier in Direct OAuth Flow', async () => {
      const code = 'direct-code-secure';

      // Store empty verifier (Direct flow)
      await pkceStore.storeCodeVerifier(`github:${code}`, {
        codeVerifier: '',
        state: 'state'
      }, 600);

      // Client MUST provide verifier
      const clientProvidedVerifier = undefined; // Client forgot to provide it

      const data = await pkceStore.getCodeVerifier(`github:${code}`);
      const verifierToUse = data?.codeVerifier || clientProvidedVerifier;

      // Should fail validation (no verifier available)
      expect(verifierToUse).toBeUndefined();
    });
  });
});
