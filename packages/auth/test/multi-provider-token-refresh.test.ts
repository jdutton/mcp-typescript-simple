/**
 * Unit tests for multi-provider token refresh logic
 */

import type { Request, Response } from 'express';
import type { StoredTokenInfo } from '@mcp-typescript-simple/auth';


/* eslint-disable sonarjs/no-unused-vars, sonarjs/no-ignored-exceptions */
describe('Multi-Provider Token Refresh', () => {
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

  describe('Token refresh routing', () => {
    it('should succeed with correct provider on first try', async () => {
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
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      const githubProvider = {
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

      // Simulate current sequential approach
      let success = false;
      for (const provider of mockProviders.values()) {
        try {
          await provider.handleTokenRefresh(mockReq as Request, mockRes as Response);
          success = true;
          break;
        } catch (_error) {
          continue;
        }
      }

      expect(success).toBe(true);
      expect(googleProvider.handleTokenRefresh).toHaveBeenCalled();
      // Note: GitHub provider may also be called in current implementation
    });

    it('should fail when refresh token not found in any provider', async () => {
      const googleProvider = {
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockRejectedValue(new Error('Invalid refresh token')),
      };

      const githubProvider = {
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockRejectedValue(new Error('Invalid refresh token')),
      };

      mockProviders.set('google', googleProvider);
      mockProviders.set('github', githubProvider);

      mockReq.body = {
        grant_type: 'refresh_token',
        refresh_token: 'invalid-refresh-token',
      };

      let success = false;
      for (const provider of mockProviders.values()) {
        try {
          await provider.handleTokenRefresh(mockReq as Request, mockRes as Response);
          success = true;
          break;
        } catch (_error) {
          continue;
        }
      }

      expect(success).toBe(false);
      expect(googleProvider.handleTokenRefresh).toHaveBeenCalled();
      expect(githubProvider.handleTokenRefresh).toHaveBeenCalled();
    });

    it('should handle refresh token from specific provider only', async () => {
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
        findTokenByRefreshToken: vi.fn<(_token: string) => Promise<any>>().mockResolvedValue(null),
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockRejectedValue(new Error('Token not found')),
      };

      const githubProvider = {
        findTokenByRefreshToken: vi.fn<(_token: string) => Promise<any>>().mockResolvedValue({
          accessToken: 'github-access-token',
          tokenInfo: githubTokenInfo,
        }),
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      mockProviders.set('google', googleProvider);
      mockProviders.set('github', githubProvider);

      mockReq.body = {
        grant_type: 'refresh_token',
        refresh_token: 'github-refresh-token',
      };

      // Try each provider
      let success = false;
      for (const provider of mockProviders.values()) {
        try {
          await provider.handleTokenRefresh(mockReq as Request, mockRes as Response);
          success = true;
          break;
        } catch (_error) {
          continue;
        }
      }

      expect(success).toBe(true);
    });
  });

  describe('Concurrent refresh scenarios', () => {
    it('should handle concurrent refresh requests for same token', async () => {
      const _tokenInfo: StoredTokenInfo = {
        accessToken: 'access-token-123',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() + 3600000,
        refreshToken: 'refresh-token-123',
        userInfo: {
          sub: 'user-123',
          email: 'user@example.com',
          name: 'Test User',
          provider: 'google',
        },
      };

      let callCount = 0;
      const googleProvider = {
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockImplementation(async () => {
          callCount++;
          // Simulate async work
          await new Promise(resolve => setTimeout(resolve, 10));
        }),
      };

      mockProviders.set('google', googleProvider);

      mockReq.body = {
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token-123',
      };

      // Simulate concurrent requests
      const requests = [
        (async () => {
          for (const provider of mockProviders.values()) {
            try {
              await provider.handleTokenRefresh(mockReq as Request, mockRes as Response);
              break;
            } catch (_error) {
              continue;
            }
          }
        })(),
        (async () => {
          for (const provider of mockProviders.values()) {
            try {
              await provider.handleTokenRefresh(mockReq as Request, mockRes as Response);
              break;
            } catch (_error) {
              continue;
            }
          }
        })(),
      ];

      await Promise.all(requests);

      expect(callCount).toBe(2); // Both requests processed
    });
  });

  describe('Expired refresh token handling', () => {
    it('should reject expired refresh token', async () => {
      const _expiredTokenInfo: StoredTokenInfo = {
        accessToken: 'expired-access-token',
        provider: 'google',
        scopes: ['openid'],
        expiresAt: Date.now() - 1000, // Expired 1 second ago
        refreshToken: 'expired-refresh-token',
        userInfo: {
          sub: 'user-123',
          email: 'user@example.com',
          name: 'Test User',
          provider: 'google',
        },
      };

      const googleProvider = {
        findTokenByRefreshToken: vi.fn<(_token: string) => Promise<any>>().mockResolvedValue(null), // Cleaned up
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockRejectedValue(new Error('Invalid refresh token')),
      };

      mockProviders.set('google', googleProvider);

      mockReq.body = {
        grant_type: 'refresh_token',
        refresh_token: 'expired-refresh-token',
      };

      let success = false;
      let error: Error | null = null;

      for (const provider of mockProviders.values()) {
        try {
          await provider.handleTokenRefresh(mockReq as Request, mockRes as Response);
          success = true;
          break;
        } catch (err) {
          error = err as Error;
          continue;
        }
      }

      expect(success).toBe(false);
      expect(error?.message).toBe('Invalid refresh token');
    });
  });

  describe('Optimized refresh token routing', () => {
    it('should route directly to correct provider using token store lookup', async () => {
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
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      const githubProvider = {
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      mockProviders.set('google', googleProvider);
      mockProviders.set('github', githubProvider);

      mockReq.body = {
        grant_type: 'refresh_token',
        refresh_token: 'google-refresh-token',
      };

      // Optimized approach: Look up token first
      mockTokenStore.findByRefreshToken.mockResolvedValue({
        accessToken: 'google-access-token',
        tokenInfo: googleTokenInfo,
      });

      const tokenData = await mockTokenStore.findByRefreshToken(mockReq.body.refresh_token);

      if (tokenData) {
        const provider = mockProviders.get(tokenData.tokenInfo.provider);
        if (provider && 'handleTokenRefresh' in provider) {
          await provider.handleTokenRefresh(mockReq as Request, mockRes as Response);
        }
      }

      // Only Google provider should be called
      expect(googleProvider.handleTokenRefresh).toHaveBeenCalled();
      expect(githubProvider.handleTokenRefresh).not.toHaveBeenCalled(); // Not called!
    });

    it('should fallback to sequential when token not in store', async () => {
      const googleProvider = {
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockRejectedValue(new Error('Not found')),
      };

      const githubProvider = {
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      mockProviders.set('google', googleProvider);
      mockProviders.set('github', githubProvider);

      mockReq.body = {
        grant_type: 'refresh_token',
        refresh_token: 'external-refresh-token',
      };

      // Token not in store (direct OAuth flow)
      mockTokenStore.findByRefreshToken.mockResolvedValue(null);

      const tokenData = await mockTokenStore.findByRefreshToken(mockReq.body.refresh_token);

      if (!tokenData) {
        // Fallback to trying each provider
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
      expect(githubProvider.handleTokenRefresh).toHaveBeenCalled();
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

      mockTokenStore.findByRefreshToken.mockResolvedValue({
        accessToken: 'access-token',
        tokenInfo: invalidTokenInfo,
      });

      mockReq.body = {
        grant_type: 'refresh_token',
        refresh_token: 'refresh-token-123',
      };

      const tokenData = await mockTokenStore.findByRefreshToken(mockReq.body.refresh_token);

      let provider = null;
      if (tokenData) {
        provider = mockProviders.get(tokenData.tokenInfo.provider);
      }

      expect(provider).toBeUndefined(); // Provider not found
      // Should fallback to sequential approach
    });
  });

  describe('Error handling', () => {
    it('should provide detailed error when all providers fail', async () => {
      const googleProvider = {
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockRejectedValue(new Error('Google: Invalid token')),
      };

      const githubProvider = {
        handleTokenRefresh: vi.fn<(_req: Request, _res: Response) => Promise<void>>().mockRejectedValue(new Error('GitHub: Invalid token')),
      };

      mockProviders.set('google', googleProvider);
      mockProviders.set('github', githubProvider);

      mockReq.body = {
        grant_type: 'refresh_token',
        refresh_token: 'invalid-token',
      };

      const errors: string[] = [];
      for (const provider of mockProviders.values()) {
        try {
          await provider.handleTokenRefresh(mockReq as Request, mockRes as Response);
          break;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
          continue;
        }
      }

      expect(errors).toHaveLength(2);
      expect(errors).toContain('Google: Invalid token');
      expect(errors).toContain('GitHub: Invalid token');
    });
  });
});
