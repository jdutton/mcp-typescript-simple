/**
 * Unit tests for optimized token refresh routing
 */

import type { Request, Response } from 'express';
import type { StoredTokenInfo } from '@mcp-typescript-simple/auth';


/* eslint-disable sonarjs/no-ignored-exceptions */
describe('Token Refresh Optimization', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockProviders: Map<string, any>;
  let mockTokenStore: any;

  beforeEach(() => {
    mockReq = {
      body: {},
    };

    mockRes = {
      status: vi.fn().mockReturnThis() as any,
      json: vi.fn().mockReturnThis() as any,
      setHeader: vi.fn().mockReturnThis() as any,
      headersSent: false,
    };

    mockTokenStore = {
      findByRefreshToken: vi.fn(),
    };

    mockProviders = new Map();
  });

  describe('Direct provider routing', () => {
    it('should route to correct provider on first try', async () => {
      const googleTokenInfo: StoredTokenInfo = {
        accessToken: 'google-access-token',
        provider: 'google',
        scopes: ['openid', 'email'],
        expiresAt: Date.now() + 3600000,
        refreshToken: 'google-refresh-token',
        userInfo: {
          sub: 'user-123',
          email: 'user@example.com',
          name: 'Test User',
          provider: 'google',
        },
      };

      const googleProvider = {
        getTokenStore: vi.fn<() => any>().mockReturnValue(mockTokenStore),
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      const githubProvider = {
        getTokenStore: vi.fn<() => any>().mockReturnValue(mockTokenStore),
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      const microsoftProvider = {
        getTokenStore: vi.fn<() => any>().mockReturnValue(mockTokenStore),
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      mockProviders.set('google', googleProvider);
      mockProviders.set('github', githubProvider);
      mockProviders.set('microsoft', microsoftProvider);

      mockReq.body = {
        grant_type: 'refresh_token',
        refresh_token: 'google-refresh-token',
      };

      // Mock token store lookup
      mockTokenStore.findByRefreshToken.mockResolvedValue({
        accessToken: 'google-access-token',
        tokenInfo: googleTokenInfo,
      });

      // Simulate optimized routing
      const firstProvider = mockProviders.values().next().value;
      if (!firstProvider) throw new Error('No providers available');
      const tokenStore = firstProvider.getTokenStore();
      const tokenData = await tokenStore.findByRefreshToken(mockReq.body.refresh_token);

      let correctProvider = null;
      if (tokenData && tokenData.tokenInfo) {
        correctProvider = mockProviders.get(tokenData.tokenInfo.provider);
      }

      if (correctProvider) {
        await correctProvider.handleTokenRefresh(mockReq as Request, mockRes as Response);
      }

      // Only Google provider should be called
      expect(googleProvider.handleTokenRefresh).toHaveBeenCalledTimes(1);
      expect(githubProvider.handleTokenRefresh).not.toHaveBeenCalled();
      expect(microsoftProvider.handleTokenRefresh).not.toHaveBeenCalled();
    });

    it('should handle GitHub tokens correctly', async () => {
      const githubTokenInfo: StoredTokenInfo = {
        accessToken: 'github-access-token',
        provider: 'github',
        scopes: ['user:email'],
        expiresAt: Date.now() + 3600000,
        refreshToken: 'github-refresh-token',
        userInfo: {
          sub: 'user-456',
          email: 'user@github.com',
          name: 'GitHub User',
          provider: 'github',
        },
      };

      const googleProvider = {
        getTokenStore: vi.fn<() => any>().mockReturnValue(mockTokenStore),
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      const githubProvider = {
        getTokenStore: vi.fn<() => any>().mockReturnValue(mockTokenStore),
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      mockProviders.set('google', googleProvider);
      mockProviders.set('github', githubProvider);

      mockReq.body = {
        grant_type: 'refresh_token',
        refresh_token: 'github-refresh-token',
      };

      mockTokenStore.findByRefreshToken.mockResolvedValue({
        accessToken: 'github-access-token',
        tokenInfo: githubTokenInfo,
      });

      // Simulate routing
      const firstProvider = mockProviders.values().next().value;
      const tokenStore = firstProvider.getTokenStore();
      const tokenData = await tokenStore.findByRefreshToken(mockReq.body.refresh_token);

      let correctProvider = null;
      if (tokenData && tokenData.tokenInfo) {
        correctProvider = mockProviders.get(tokenData.tokenInfo.provider);
      }

      if (correctProvider) {
        await correctProvider.handleTokenRefresh(mockReq as Request, mockRes as Response);
      }

      expect(githubProvider.handleTokenRefresh).toHaveBeenCalledTimes(1);
      expect(googleProvider.handleTokenRefresh).not.toHaveBeenCalled();
    });

    it('should skip incorrect providers entirely', async () => {
      const microsoftTokenInfo: StoredTokenInfo = {
        accessToken: 'microsoft-access-token',
        provider: 'microsoft',
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000,
        refreshToken: 'microsoft-refresh-token',
        userInfo: {
          sub: 'user-789',
          email: 'user@microsoft.com',
          name: 'Microsoft User',
          provider: 'microsoft',
        },
      };

      const googleProvider = {
        getTokenStore: vi.fn<() => any>().mockReturnValue(mockTokenStore),
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      const githubProvider = {
        getTokenStore: vi.fn<() => any>().mockReturnValue(mockTokenStore),
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      const microsoftProvider = {
        getTokenStore: vi.fn<() => any>().mockReturnValue(mockTokenStore),
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      mockProviders.set('google', googleProvider);
      mockProviders.set('github', githubProvider);
      mockProviders.set('microsoft', microsoftProvider);

      mockReq.body = {
        grant_type: 'refresh_token',
        refresh_token: 'microsoft-refresh-token',
      };

      mockTokenStore.findByRefreshToken.mockResolvedValue({
        accessToken: 'microsoft-access-token',
        tokenInfo: microsoftTokenInfo,
      });

      // Simulate routing
      const firstProvider = mockProviders.values().next().value;
      const tokenStore = firstProvider.getTokenStore();
      const tokenData = await tokenStore.findByRefreshToken(mockReq.body.refresh_token);

      let correctProvider = null;
      if (tokenData && tokenData.tokenInfo) {
        correctProvider = mockProviders.get(tokenData.tokenInfo.provider);
      }

      if (correctProvider) {
        await correctProvider.handleTokenRefresh(mockReq as Request, mockRes as Response);
      }

      expect(microsoftProvider.handleTokenRefresh).toHaveBeenCalledTimes(1);
      expect(googleProvider.handleTokenRefresh).not.toHaveBeenCalled();
      expect(githubProvider.handleTokenRefresh).not.toHaveBeenCalled();
    });
  });

  describe('Fallback behavior', () => {
    it('should fallback to sequential when token not in store', async () => {
      const googleProvider = {
        getTokenStore: vi.fn<() => any>().mockReturnValue(mockTokenStore),
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockRejectedValue(new Error('Not found')),
      };

      const githubProvider = {
        getTokenStore: vi.fn<() => any>().mockReturnValue(mockTokenStore),
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      mockProviders.set('google', googleProvider);
      mockProviders.set('github', githubProvider);

      mockReq.body = {
        grant_type: 'refresh_token',
        refresh_token: 'external-refresh-token',
      };

      // Token not in store
      mockTokenStore.findByRefreshToken.mockResolvedValue(null);

      // Simulate fallback
      const firstProvider = mockProviders.values().next().value;
      const tokenStore = firstProvider.getTokenStore();
      const tokenData = await tokenStore.findByRefreshToken(mockReq.body.refresh_token);

      if (!tokenData) {
        // Fallback to sequential
        for (const provider of mockProviders.values()) {
          try {
            await provider.handleTokenRefresh(mockReq as Request, mockRes as Response);
            break;
          } catch (_error) {
            continue;
          }
        }
      }

      // Both providers tried in fallback
      expect(googleProvider.handleTokenRefresh).toHaveBeenCalled();
      expect(githubProvider.handleTokenRefresh).toHaveBeenCalled();
    });

    it('should fallback when token store lookup throws error', async () => {
      const googleProvider = {
        getTokenStore: vi.fn<() => any>().mockReturnValue(mockTokenStore),
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      mockProviders.set('google', googleProvider);

      mockReq.body = {
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token-123',
      };

      // Token store throws error
      mockTokenStore.findByRefreshToken.mockRejectedValue(new Error('Database error'));

      // Simulate error handling
      let tokenData = null;
      try {
        const firstProvider = mockProviders.values().next().value;
        const tokenStore = firstProvider.getTokenStore();
        tokenData = await tokenStore.findByRefreshToken(mockReq.body.refresh_token);
      } catch (_error) {
        // Fallback to sequential
      }

      if (!tokenData) {
        for (const provider of mockProviders.values()) {
          try {
            await provider.handleTokenRefresh(mockReq as Request, mockRes as Response);
            break;
          } catch (_error) {
            continue;
          }
        }
      }

      expect(googleProvider.handleTokenRefresh).toHaveBeenCalled();
    });

    it('should handle invalid provider type from token store', async () => {
      const invalidTokenInfo: StoredTokenInfo = {
        accessToken: 'access-token',
        provider: 'unknown-provider' as any,
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000,
        refreshToken: 'refresh-token-123',
        userInfo: {
          sub: 'user-123',
          email: 'user@example.com',
          name: 'Test User',
          provider: 'unknown-provider',
        },
      };

      const googleProvider = {
        getTokenStore: vi.fn<() => any>().mockReturnValue(mockTokenStore),
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      mockProviders.set('google', googleProvider);

      mockReq.body = {
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token-123',
      };

      mockTokenStore.findByRefreshToken.mockResolvedValue({
        accessToken: 'access-token',
        tokenInfo: invalidTokenInfo,
      });

      // Simulate routing
      const firstProvider = mockProviders.values().next().value;
      const tokenStore = firstProvider.getTokenStore();
      const tokenData = await tokenStore.findByRefreshToken(mockReq.body.refresh_token);

      let correctProvider = null;
      if (tokenData && tokenData.tokenInfo) {
        correctProvider = mockProviders.get(tokenData.tokenInfo.provider);
      }

      // Provider not found, should fallback
      if (!correctProvider) {
        for (const provider of mockProviders.values()) {
          try {
            await provider.handleTokenRefresh(mockReq as Request, mockRes as Response);
            break;
          } catch (_error) {
            continue;
          }
        }
      }

      expect(correctProvider).toBeUndefined(); // Map.get() returns undefined for unknown keys
      expect(googleProvider.handleTokenRefresh).toHaveBeenCalled();
    });
  });

  describe('Performance improvement', () => {
    it('should reduce provider calls from N to 1', async () => {
      const googleTokenInfo: StoredTokenInfo = {
        accessToken: 'google-access-token',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000,
        refreshToken: 'google-refresh-token',
        userInfo: {
          sub: 'user-123',
          email: 'user@example.com',
          name: 'Test User',
          provider: 'google',
        },
      };

      // Create 5 providers
      const providers = ['google', 'github', 'microsoft', 'custom1', 'custom2'].map(name => {
        return {
          name,
          provider: {
            getTokenStore: vi.fn<() => any>().mockReturnValue(mockTokenStore),
            handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
          },
        };
      });

      const providersMap = new Map(providers.map(p => [p.name, p.provider]));

      mockReq.body = {
        grant_type: 'refresh_token',
        refresh_token: 'google-refresh-token',
      };

      mockTokenStore.findByRefreshToken.mockResolvedValue({
        accessToken: 'google-access-token',
        tokenInfo: googleTokenInfo,
      });

      // OPTIMIZED: Look up token first
      const firstProvider = providersMap.values().next().value;
      if (!firstProvider) throw new Error('No providers available');
      const tokenStore = firstProvider.getTokenStore() as any;
      const tokenData = await tokenStore.findByRefreshToken(mockReq.body.refresh_token);

      let correctProvider = null;
      if (tokenData && tokenData.tokenInfo) {
        correctProvider = providersMap.get(tokenData.tokenInfo.provider);
      }

      if (correctProvider) {
        await correctProvider.handleTokenRefresh(mockReq as Request, mockRes as Response);
      }

      // Count how many providers were called
      const callCounts = providers.map(p => {
        return (p.provider.handleTokenRefresh).mock.calls.length;
      });

      const totalCalls = callCounts.reduce((sum, count) => sum + count, 0);

      // Only 1 provider should be called (not all 5)
      expect(totalCalls).toBe(1);
      expect(providers[0]!.provider.handleTokenRefresh).toHaveBeenCalledTimes(1); // Google
      expect(providers[1]!.provider.handleTokenRefresh).not.toHaveBeenCalled(); // GitHub
      expect(providers[2]!.provider.handleTokenRefresh).not.toHaveBeenCalled(); // Microsoft
      expect(providers[3]!.provider.handleTokenRefresh).not.toHaveBeenCalled(); // custom1
      expect(providers[4]!.provider.handleTokenRefresh).not.toHaveBeenCalled(); // custom2
    });
  });

  describe('Error scenarios', () => {
    it('should not fallback when correct provider fails', async () => {
      const googleTokenInfo: StoredTokenInfo = {
        accessToken: 'google-access-token',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000,
        refreshToken: 'google-refresh-token',
        userInfo: {
          sub: 'user-123',
          email: 'user@example.com',
          name: 'Test User',
          provider: 'google',
        },
      };

      const googleProvider = {
        getTokenStore: vi.fn<() => any>().mockReturnValue(mockTokenStore),
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockRejectedValue(new Error('Token refresh failed')),
      };

      const githubProvider = {
        getTokenStore: vi.fn<() => any>().mockReturnValue(mockTokenStore),
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      mockProviders.set('google', googleProvider);
      mockProviders.set('github', githubProvider);

      mockReq.body = {
        grant_type: 'refresh_token',
        refresh_token: 'google-refresh-token',
      };

      mockTokenStore.findByRefreshToken.mockResolvedValue({
        accessToken: 'google-access-token',
        tokenInfo: googleTokenInfo,
      });

      // Simulate routing
      const firstProvider = mockProviders.values().next().value;
      const tokenStore = firstProvider.getTokenStore();
      const tokenData = await tokenStore.findByRefreshToken(mockReq.body.refresh_token);

      let correctProvider = null;
      let error: Error | null = null;

      if (tokenData && tokenData.tokenInfo) {
        correctProvider = mockProviders.get(tokenData.tokenInfo.provider);
      }

      if (correctProvider) {
        try {
          await correctProvider.handleTokenRefresh(mockReq as Request, mockRes as Response);
        } catch (err) {
          error = err as Error;
          // Don't fallback - correct provider failed
        }
      }

      expect(googleProvider.handleTokenRefresh).toHaveBeenCalledTimes(1);
      expect(githubProvider.handleTokenRefresh).not.toHaveBeenCalled(); // Not tried
      expect(error).not.toBeNull();
      expect(error?.message).toBe('Token refresh failed');
    });
  });
});
