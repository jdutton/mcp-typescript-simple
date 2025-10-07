/**
 * Token Expiration Bug Tests
 *
 * Regression tests for OAuth token validation bug where providers return AuthInfo
 * without expiresAt field when token is not in local store (e.g., after server restart).
 *
 * Bug: MCP SDK's requireBearerAuth middleware requires expiresAt to be a valid number,
 * but providers were returning undefined or missing expiresAt when validating against
 * provider APIs instead of local token store.
 *
 * Scenario: Server restart → token still in browser → not in server's token store →
 * provider validates against API → returns AuthInfo without expiresAt → 401 error
 */

import { GitHubOAuthProvider } from '../../../src/auth/providers/github-provider.js';
import { GoogleOAuthProvider } from '../../../src/auth/providers/google-provider.js';
import { MicrosoftOAuthProvider } from '../../../src/auth/providers/microsoft-provider.js';
import {
  GitHubOAuthConfig,
  GoogleOAuthConfig,
  MicrosoftOAuthConfig,
} from '../../../src/auth/providers/types.js';

// Mock fetch globally
global.fetch = jest.fn();

describe('Token Expiration Bug - Provider verifyAccessToken', () => {
  const githubConfig: GitHubOAuthConfig = {
    type: 'github',
    clientId: 'test-github-client-id',
    clientSecret: 'test-github-client-secret',
    redirectUri: 'http://localhost:3000/auth/github/callback',
    scopes: ['user:email'],
  };

  const googleConfig: GoogleOAuthConfig = {
    type: 'google',
    clientId: 'test-google-client-id',
    clientSecret: 'test-google-client-secret',
    redirectUri: 'http://localhost:3000/auth/google/callback',
    scopes: ['openid', 'email', 'profile'],
  };

  const microsoftConfig: MicrosoftOAuthConfig = {
    type: 'microsoft',
    clientId: 'test-microsoft-client-id',
    clientSecret: 'test-microsoft-client-secret',
    redirectUri: 'http://localhost:3000/auth/microsoft/callback',
    scopes: ['openid', 'email', 'profile'],
    tenantId: 'common',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GitHub Provider', () => {
    it('should return valid expiresAt when token not in local store', async () => {
      const { MemoryPKCEStore } = require('../../../src/auth/stores/memory-pkce-store.js');
      const provider = new GitHubOAuthProvider(githubConfig, undefined, undefined, new MemoryPKCEStore());

      // Mock GitHub user API response (token not in local store scenario)
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 123456,
          login: 'testuser',
          name: 'Test User',
          avatar_url: 'https://example.com/avatar.jpg',
        }),
      });

      // Mock GitHub emails API response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            email: 'test@example.com',
            primary: true,
            verified: true,
          },
        ],
      });

      const authInfo = await provider.verifyAccessToken('github-test-token');

      // Critical assertion: expiresAt must be a valid number
      expect(authInfo.expiresAt).toBeDefined();
      expect(typeof authInfo.expiresAt).toBe('number');
      if (authInfo.expiresAt !== undefined) {
        expect(isNaN(authInfo.expiresAt)).toBe(false);

        // Expiration should be in the future (Unix timestamp in seconds)
        const nowInSeconds = Math.floor(Date.now() / 1000);
        expect(authInfo.expiresAt).toBeGreaterThan(nowInSeconds);

        // Should be within reasonable range (e.g., 1 hour = 3600 seconds)
        const oneHourFromNow = nowInSeconds + 3600;
        expect(authInfo.expiresAt).toBeLessThanOrEqual(oneHourFromNow + 60); // +60s tolerance
      }
    });
  });

  describe('Microsoft Provider', () => {
    it('should return valid expiresAt when token not in local store', async () => {
      const { MemoryPKCEStore } = require('../../../src/auth/stores/memory-pkce-store.js');
      const provider = new MicrosoftOAuthProvider(microsoftConfig, undefined, undefined, new MemoryPKCEStore());

      // Mock Microsoft Graph API response (token not in local store scenario)
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'user-id-123',
          displayName: 'Test User',
          mail: 'test@example.com',
          userPrincipalName: 'test@example.com',
        }),
      });

      const authInfo = await provider.verifyAccessToken('microsoft-test-token');

      // Critical assertion: expiresAt must be a valid number
      expect(authInfo.expiresAt).toBeDefined();
      expect(typeof authInfo.expiresAt).toBe('number');
      if (authInfo.expiresAt !== undefined) {
        expect(isNaN(authInfo.expiresAt)).toBe(false);

        // Expiration should be in the future (Unix timestamp in seconds)
        const nowInSeconds = Math.floor(Date.now() / 1000);
        expect(authInfo.expiresAt).toBeGreaterThan(nowInSeconds);

        // Should be within reasonable range (e.g., 1 hour = 3600 seconds)
        const oneHourFromNow = nowInSeconds + 3600;
        expect(authInfo.expiresAt).toBeLessThanOrEqual(oneHourFromNow + 60); // +60s tolerance
      }
    });
  });

  describe('Google Provider', () => {
    it('should return valid expiresAt when expiry_date unavailable', async () => {
      const { MemoryPKCEStore } = require('../../../src/auth/stores/memory-pkce-store.js');
      const provider = new GoogleOAuthProvider(googleConfig, undefined, undefined, new MemoryPKCEStore());

      // Mock Google userinfo endpoint (fallback when tokeninfo fails)
      // This scenario returns no expiry_date
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'user-id-123',
          email: 'test@example.com',
          name: 'Test User',
          picture: 'https://example.com/photo.jpg',
        }),
      });

      const authInfo = await provider.verifyAccessToken('google-test-token');

      // Critical assertion: expiresAt must be a valid number (not undefined)
      expect(authInfo.expiresAt).toBeDefined();
      expect(typeof authInfo.expiresAt).toBe('number');
      if (authInfo.expiresAt !== undefined) {
        expect(isNaN(authInfo.expiresAt)).toBe(false);

        // Expiration should be in the future (Unix timestamp in seconds)
        const nowInSeconds = Math.floor(Date.now() / 1000);
        expect(authInfo.expiresAt).toBeGreaterThan(nowInSeconds);

        // Should be within reasonable range (e.g., 1 hour = 3600 seconds)
        const oneHourFromNow = nowInSeconds + 3600;
        expect(authInfo.expiresAt).toBeLessThanOrEqual(oneHourFromNow + 60); // +60s tolerance
      }
    });

    it('should use provider expiry_date when available', async () => {
      const { MemoryPKCEStore } = require('../../../src/auth/stores/memory-pkce-store.js');
      const provider = new GoogleOAuthProvider(googleConfig, undefined, undefined, new MemoryPKCEStore());

      // Mock expiry_date 30 minutes from now (in milliseconds)
      const expiryDateMs = Date.now() + (30 * 60 * 1000);
      const expectedExpiresAt = Math.floor(expiryDateMs / 1000);

      // We need to mock the oauth2Client.getTokenInfo method
      // This requires accessing the private oauth2Client property
      const oauth2Client = (provider as any).oauth2Client;
      oauth2Client.setCredentials = jest.fn();
      oauth2Client.getTokenInfo = jest.fn().mockResolvedValue({
        sub: 'user-id-123',
        email: 'test@example.com',
        scopes: ['openid', 'email', 'profile'],
        expiry_date: expiryDateMs,
      });

      const authInfo = await provider.verifyAccessToken('google-test-token');

      // Should use the provider's expiry_date
      expect(authInfo.expiresAt).toBeDefined();
      expect(authInfo.expiresAt).toBe(expectedExpiresAt);
    });
  });

  describe('MCP SDK Compatibility', () => {
    it('should pass MCP SDK bearerAuth middleware validation check', async () => {
      const { MemoryPKCEStore } = require('../../../src/auth/stores/memory-pkce-store.js');
      const provider = new GitHubOAuthProvider(githubConfig, undefined, undefined, new MemoryPKCEStore());

      // Mock GitHub API responses
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 123456,
          login: 'testuser',
          name: 'Test User',
        }),
      });
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [{
          email: 'test@example.com',
          primary: true,
          verified: true,
        }],
      });

      const authInfo = await provider.verifyAccessToken('test-token');

      // Replicate the exact MCP SDK validation logic
      // From: node_modules/@modelcontextprotocol/sdk/dist/esm/server/auth/middleware/bearerAuth.js
      const isValidExpiration =
        typeof authInfo.expiresAt === 'number' &&
        !isNaN(authInfo.expiresAt);

      expect(isValidExpiration).toBe(true);

      // Should not throw "Token has no expiration time"
      if (typeof authInfo.expiresAt !== 'number' || isNaN(authInfo.expiresAt)) {
        throw new Error("Token has no expiration time");
      }

      // Should not be expired
      const nowInSeconds = Date.now() / 1000;
      if (authInfo.expiresAt !== undefined) {
        expect(authInfo.expiresAt).toBeGreaterThan(nowInSeconds);
      }
    });
  });
});
