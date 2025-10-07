/**
 * Multi-Provider PKCE Isolation Tests
 *
 * Tests that PKCE data is properly namespaced by provider to prevent
 * cross-provider code collisions when multiple OAuth providers share
 * the same PKCE store instance.
 *
 * Bug: https://github.com/anthropics/mcp-typescript-simple/issues/XXX
 * When multiple providers share a PKCE store, authorization codes from
 * one provider could incorrectly match another provider, causing
 * invalid_grant errors during token exchange.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { GoogleOAuthProvider } from '../../../src/auth/providers/google-provider.js';
import { GitHubOAuthProvider } from '../../../src/auth/providers/github-provider.js';
import { MicrosoftOAuthProvider } from '../../../src/auth/providers/microsoft-provider.js';
import { MemoryPKCEStore } from '../../../src/auth/stores/memory-pkce-store.js';
import { MemorySessionStore } from '../../../src/auth/stores/memory-session-store.js';
import { MemoryOAuthTokenStore } from '../../../src/auth/stores/memory-oauth-token-store.js';
import type { GoogleOAuthConfig, GitHubOAuthConfig, MicrosoftOAuthConfig, OAuthProvider } from '../../../src/auth/providers/types.js';

describe('Multi-Provider PKCE Isolation', () => {
  let sharedPKCEStore: MemoryPKCEStore;
  let sharedSessionStore: MemorySessionStore;
  let sharedTokenStore: MemoryOAuthTokenStore;
  let googleProvider: GoogleOAuthProvider;
  let githubProvider: GitHubOAuthProvider;
  let microsoftProvider: MicrosoftOAuthProvider;

  beforeEach(() => {
    // Create shared stores (simulates production configuration)
    sharedPKCEStore = new MemoryPKCEStore();
    sharedSessionStore = new MemorySessionStore();
    sharedTokenStore = new MemoryOAuthTokenStore();

    // Create Google provider
    const googleConfig: GoogleOAuthConfig = {
      type: 'google',
      clientId: 'google-client-id',
      clientSecret: 'google-client-secret',
      redirectUri: 'http://localhost:3000/auth/google/callback',
      scopes: ['openid', 'email', 'profile'],
    };
    googleProvider = new GoogleOAuthProvider(
      googleConfig,
      sharedSessionStore,
      sharedTokenStore,
      sharedPKCEStore
    );

    // Create GitHub provider
    const githubConfig: GitHubOAuthConfig = {
      type: 'github',
      clientId: 'github-client-id',
      clientSecret: 'github-client-secret',
      redirectUri: 'http://localhost:3000/auth/github/callback',
      scopes: ['user:email', 'read:user'],
    };
    githubProvider = new GitHubOAuthProvider(
      githubConfig,
      sharedSessionStore,
      sharedTokenStore,
      sharedPKCEStore
    );

    // Create Microsoft provider
    const microsoftConfig: MicrosoftOAuthConfig = {
      type: 'microsoft',
      clientId: 'microsoft-client-id',
      clientSecret: 'microsoft-client-secret',
      redirectUri: 'http://localhost:3000/auth/microsoft/callback',
      scopes: ['openid', 'email', 'profile'],
      tenantId: 'common',
    };
    microsoftProvider = new MicrosoftOAuthProvider(
      microsoftConfig,
      sharedSessionStore,
      sharedTokenStore,
      sharedPKCEStore
    );
  });

  describe('PKCE Key Namespacing', () => {
    it('should namespace PKCE keys by provider type', async () => {
      const code = 'test-authorization-code-123';
      const googleKey = (googleProvider as any).getProviderCodeKey(code);
      const githubKey = (githubProvider as any).getProviderCodeKey(code);
      const microsoftKey = (microsoftProvider as any).getProviderCodeKey(code);

      expect(googleKey).toBe('google:test-authorization-code-123');
      expect(githubKey).toBe('github:test-authorization-code-123');
      expect(microsoftKey).toBe('microsoft:test-authorization-code-123');

      // Keys should be different for the same code
      expect(googleKey).not.toBe(githubKey);
      expect(googleKey).not.toBe(microsoftKey);
      expect(githubKey).not.toBe(microsoftKey);
    });
  });

  describe('PKCE Store Isolation', () => {
    it('should only find codes stored by the same provider', async () => {
      const googleCode = 'google-auth-code-abc';
      const githubCode = 'github-auth-code-xyz';
      const microsoftCode = 'microsoft-auth-code-123';

      // Store PKCE data for each provider
      await sharedPKCEStore.storeCodeVerifier((googleProvider as any).getProviderCodeKey(googleCode), {
        codeVerifier: 'google-verifier',
        state: 'google-state',
      });

      await sharedPKCEStore.storeCodeVerifier((githubProvider as any).getProviderCodeKey(githubCode), {
        codeVerifier: 'github-verifier',
        state: 'github-state',
      });

      await sharedPKCEStore.storeCodeVerifier((microsoftProvider as any).getProviderCodeKey(microsoftCode), {
        codeVerifier: 'microsoft-verifier',
        state: 'microsoft-state',
      });

      // Each provider should only find its own code
      expect(await googleProvider.hasStoredCodeForProvider(googleCode)).toBe(true);
      expect(await googleProvider.hasStoredCodeForProvider(githubCode)).toBe(false);
      expect(await googleProvider.hasStoredCodeForProvider(microsoftCode)).toBe(false);

      expect(await githubProvider.hasStoredCodeForProvider(googleCode)).toBe(false);
      expect(await githubProvider.hasStoredCodeForProvider(githubCode)).toBe(true);
      expect(await githubProvider.hasStoredCodeForProvider(microsoftCode)).toBe(false);

      expect(await microsoftProvider.hasStoredCodeForProvider(googleCode)).toBe(false);
      expect(await microsoftProvider.hasStoredCodeForProvider(githubCode)).toBe(false);
      expect(await microsoftProvider.hasStoredCodeForProvider(microsoftCode)).toBe(true);
    });

    it('should prevent cross-provider code collisions', async () => {
      // Simulate the same authorization code being issued by different providers
      // (extremely unlikely in practice, but theoretically possible)
      const sameCode = 'duplicate-code-collision-test';

      // Store the same code for both Google and GitHub
      await sharedPKCEStore.storeCodeVerifier((googleProvider as any).getProviderCodeKey(sameCode), {
        codeVerifier: 'google-verifier-for-duplicate',
        state: 'google-state',
      });

      await sharedPKCEStore.storeCodeVerifier((githubProvider as any).getProviderCodeKey(sameCode), {
        codeVerifier: 'github-verifier-for-duplicate',
        state: 'github-state',
      });

      // Both providers should find their own version of the code
      expect(await googleProvider.hasStoredCodeForProvider(sameCode)).toBe(true);
      expect(await githubProvider.hasStoredCodeForProvider(sameCode)).toBe(true);

      // Retrieve the code verifiers - should get different values
      const googleVerifier = await (googleProvider as any).getStoredCodeVerifier(sameCode);
      const githubVerifier = await (githubProvider as any).getStoredCodeVerifier(sameCode);

      expect(googleVerifier).toBe('google-verifier-for-duplicate');
      expect(githubVerifier).toBe('github-verifier-for-duplicate');
      expect(googleVerifier).not.toBe(githubVerifier);
    });

    it('should handle cleanup without affecting other providers', async () => {
      const code = 'shared-code-cleanup-test';

      // Store code for both providers
      await sharedPKCEStore.storeCodeVerifier((googleProvider as any).getProviderCodeKey(code), {
        codeVerifier: 'google-verifier',
        state: 'google-state',
      });

      await sharedPKCEStore.storeCodeVerifier((githubProvider as any).getProviderCodeKey(code), {
        codeVerifier: 'github-verifier',
        state: 'github-state',
      });

      // Verify both providers can see their codes
      expect(await googleProvider.hasStoredCodeForProvider(code)).toBe(true);
      expect(await githubProvider.hasStoredCodeForProvider(code)).toBe(true);

      // Clean up Google's code
      await (googleProvider as any).cleanupAfterTokenExchange(code);

      // Google's code should be gone, but GitHub's should remain
      expect(await googleProvider.hasStoredCodeForProvider(code)).toBe(false);
      expect(await githubProvider.hasStoredCodeForProvider(code)).toBe(true);

      // Verify GitHub's verifier is still intact
      const githubVerifier = await (githubProvider as any).getStoredCodeVerifier(code);
      expect(githubVerifier).toBe('github-verifier');
    });
  });

  describe('Multi-Provider Routing', () => {
    it('should correctly route token exchange to the right provider', async () => {
      const googleCode = 'google-routing-test';
      const githubCode = 'github-routing-test';

      // Store codes for different providers
      await sharedPKCEStore.storeCodeVerifier((googleProvider as any).getProviderCodeKey(googleCode), {
        codeVerifier: 'google-verifier',
        state: 'google-state',
      });

      await sharedPKCEStore.storeCodeVerifier((githubProvider as any).getProviderCodeKey(githubCode), {
        codeVerifier: 'github-verifier',
        state: 'github-state',
      });

      // Simulate multi-provider routing logic (from oauth-routes.ts)
      const providers = new Map<string, OAuthProvider>([
        ['google', googleProvider],
        ['github', githubProvider],
        ['microsoft', microsoftProvider],
      ]);

      // Route Google code - should find Google provider
      let foundProvider = null;
      for (const [type, provider] of providers.entries()) {
        if (await (provider as any).hasStoredCodeForProvider(googleCode)) {
          foundProvider = type;
          break;
        }
      }
      expect(foundProvider).toBe('google');

      // Route GitHub code - should find GitHub provider
      foundProvider = null;
      for (const [type, provider] of providers.entries()) {
        if (await (provider as any).hasStoredCodeForProvider(githubCode)) {
          foundProvider = type;
          break;
        }
      }
      expect(foundProvider).toBe('github');

      // Route unknown code - should not find any provider
      foundProvider = null;
      for (const [type, provider] of providers.entries()) {
        if (await (provider as any).hasStoredCodeForProvider('unknown-code')) {
          foundProvider = type;
          break;
        }
      }
      expect(foundProvider).toBeNull();
    });
  });

  describe('Regression Test: GitHub Selected, Google Code Found Bug', () => {
    it('should not use stale Google code when GitHub is selected', async () => {
      // Reproduce the bug scenario from the logs:
      // 1. User tries Google OAuth → fails with invalid_grant
      // 2. Google's PKCE data remains in store (not cleaned up on error)
      // 3. User selects GitHub → gets GitHub authorization code
      // 4. Token exchange checks Google first → finds stale Google PKCE data
      // 5. Uses Google provider with GitHub's code → invalid_grant

      const staleGoogleCode = 'f42379d251-old-google-attempt';
      const freshGithubCode = 'f42379d251-new-github-attempt';

      // Step 1: Simulate failed Google OAuth attempt that leaves PKCE data
      await sharedPKCEStore.storeCodeVerifier((googleProvider as any).getProviderCodeKey(staleGoogleCode), {
        codeVerifier: 'zbpWLx3zsh',
        state: 'old-google-state',
      });

      // Step 2: User selects GitHub, gets fresh GitHub code
      await sharedPKCEStore.storeCodeVerifier((githubProvider as any).getProviderCodeKey(freshGithubCode), {
        codeVerifier: 'github-fresh-verifier',
        state: 'github-state',
      });

      // Step 3: Token exchange routing should find GitHub, NOT Google
      const providers = [
        { name: 'google', provider: googleProvider },
        { name: 'github', provider: githubProvider },
      ];

      let correctProvider = null;
      for (const { name, provider } of providers) {
        if (await (provider as any).hasStoredCodeForProvider(freshGithubCode)) {
          correctProvider = name;
          break;
        }
      }

      // CRITICAL: Should route to GitHub, not Google
      expect(correctProvider).toBe('github');
      expect(correctProvider).not.toBe('google');

      // Verify Google doesn't incorrectly claim the GitHub code
      expect(await googleProvider.hasStoredCodeForProvider(freshGithubCode)).toBe(false);
      expect(await githubProvider.hasStoredCodeForProvider(freshGithubCode)).toBe(true);

      // Verify Google still has its own stale code
      expect(await googleProvider.hasStoredCodeForProvider(staleGoogleCode)).toBe(true);
      expect(await githubProvider.hasStoredCodeForProvider(staleGoogleCode)).toBe(false);
    });
  });
});
