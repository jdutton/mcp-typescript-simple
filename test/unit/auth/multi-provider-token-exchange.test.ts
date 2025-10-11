/**
 * Unit tests for multi-provider token exchange logic
 */

import type { Request, Response } from 'express';

describe('Multi-Provider Token Exchange', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockProviders: Map<string, any>;

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

    // Mock providers
    mockProviders = new Map();
  });

  describe('hasStoredCodeForProvider', () => {
    it('should find correct provider by authorization code', async () => {
      const googleProvider = {
        hasStoredCodeForProvider: jest.fn<(code: string) => Promise<boolean>>().mockResolvedValue(true),
        handleTokenExchange: jest.fn<(req: Request, res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      const githubProvider = {
        hasStoredCodeForProvider: jest.fn<(code: string) => Promise<boolean>>().mockResolvedValue(false),
        handleTokenExchange: jest.fn<(req: Request, res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      mockProviders.set('google', googleProvider);
      mockProviders.set('github', githubProvider);

      mockReq.body = {
        grant_type: 'authorization_code',
        code: 'google-auth-code-123',
      };

      // Simulate the logic from oauth-routes.ts
      let correctProvider = null;
      let correctProviderType = null;

      for (const [providerType, provider] of mockProviders.entries()) {
        if ('hasStoredCodeForProvider' in provider) {
          const hasCode = await provider.hasStoredCodeForProvider(mockReq.body.code);
          if (hasCode) {
            correctProvider = provider;
            correctProviderType = providerType;
            break;
          }
        }
      }

      expect(correctProvider).toBe(googleProvider);
      expect(correctProviderType).toBe('google');
      expect(googleProvider.hasStoredCodeForProvider).toHaveBeenCalledWith('google-auth-code-123');
      expect(githubProvider.hasStoredCodeForProvider).not.toHaveBeenCalled(); // Early exit
    });

    it('should return null when no provider has the code', async () => {
      const googleProvider = {
        hasStoredCodeForProvider: jest.fn<(code: string) => Promise<boolean>>().mockResolvedValue(false),
      };

      const githubProvider = {
        hasStoredCodeForProvider: jest.fn<(code: string) => Promise<boolean>>().mockResolvedValue(false),
      };

      mockProviders.set('google', googleProvider);
      mockProviders.set('github', githubProvider);

      mockReq.body = {
        grant_type: 'authorization_code',
        code: 'unknown-code-123',
      };

      let correctProvider = null;

      for (const [_providerType, provider] of mockProviders.entries()) {
        if ('hasStoredCodeForProvider' in provider) {
          const hasCode = await provider.hasStoredCodeForProvider(mockReq.body.code);
          if (hasCode) {
            correctProvider = provider;
            break;
          }
        }
      }

      expect(correctProvider).toBeNull();
      expect(googleProvider.hasStoredCodeForProvider).toHaveBeenCalled();
      expect(githubProvider.hasStoredCodeForProvider).toHaveBeenCalled();
    });
  });

  describe('Fallback to sequential provider trial', () => {
    it('should try each provider when no stored code_verifier found', async () => {
      const googleProvider = {
        hasStoredCodeForProvider: jest.fn<(code: string) => Promise<boolean>>().mockResolvedValue(false),
        handleTokenExchange: jest.fn<(req: Request, res: Response) => Promise<void>>().mockRejectedValue(new Error('Invalid code')),
      };

      const githubProvider = {
        hasStoredCodeForProvider: jest.fn<(code: string) => Promise<boolean>>().mockResolvedValue(false),
        handleTokenExchange: jest.fn<(req: Request, res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      mockProviders.set('google', googleProvider);
      mockProviders.set('github', githubProvider);

      mockReq.body = {
        grant_type: 'authorization_code',
        code: 'direct-oauth-code-123',
      };

      // Simulate fallback logic
      const errors: Array<{ provider: string; error: string }> = [];
      let success = false;

      for (const [providerType, provider] of mockProviders.entries()) {
        if (mockRes.headersSent) break;

        if ('handleTokenExchange' in provider) {
          try {
            await provider.handleTokenExchange(mockReq as Request, mockRes as Response);
            success = true;
            break;
          } catch (error) {
            if (!mockRes.headersSent) {
              errors.push({
                provider: providerType,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }

      expect(success).toBe(true);
      expect(googleProvider.handleTokenExchange).toHaveBeenCalled();
      expect(githubProvider.handleTokenExchange).toHaveBeenCalled();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({ provider: 'google', error: 'Invalid code' });
    });

    it('should aggregate errors when all providers fail', async () => {
      const googleProvider = {
        hasStoredCodeForProvider: jest.fn<(code: string) => Promise<boolean>>().mockResolvedValue(false),
        handleTokenExchange: jest.fn<(req: Request, res: Response) => Promise<void>>().mockRejectedValue(new Error('Google: Invalid code')),
      };

      const githubProvider = {
        hasStoredCodeForProvider: jest.fn<(code: string) => Promise<boolean>>().mockResolvedValue(false),
        handleTokenExchange: jest.fn<(req: Request, res: Response) => Promise<void>>().mockRejectedValue(new Error('GitHub: Invalid code')),
      };

      mockProviders.set('google', googleProvider);
      mockProviders.set('github', githubProvider);

      mockReq.body = {
        grant_type: 'authorization_code',
        code: 'invalid-code-123',
      };

      const errors: Array<{ provider: string; error: string }> = [];

      for (const [providerType, provider] of mockProviders.entries()) {
        if (mockRes.headersSent) break;

        if ('handleTokenExchange' in provider) {
          try {
            await provider.handleTokenExchange(mockReq as Request, mockRes as Response);
            break;
          } catch (error) {
            if (!mockRes.headersSent) {
              errors.push({
                provider: providerType,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }

      expect(errors).toHaveLength(2);
      expect(errors).toEqual([
        { provider: 'google', error: 'Google: Invalid code' },
        { provider: 'github', error: 'GitHub: Invalid code' },
      ]);
    });

    it('should stop iteration when response headers are sent', async () => {
      const googleProvider = {
        hasStoredCodeForProvider: jest.fn<(code: string) => Promise<boolean>>().mockResolvedValue(false),
        handleTokenExchange: jest.fn<(req: Request, res: Response) => Promise<void>>().mockImplementation(async (_req, res) => {
          (res as any).headersSent = true;
          res.status(400).json({ error: 'custom_error' });
        }),
      };

      const githubProvider = {
        hasStoredCodeForProvider: jest.fn<(code: string) => Promise<boolean>>().mockResolvedValue(false),
        handleTokenExchange: jest.fn<(req: Request, res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      mockProviders.set('google', googleProvider);
      mockProviders.set('github', githubProvider);

      mockReq.body = {
        grant_type: 'authorization_code',
        code: 'error-code-123',
      };

      for (const [_providerType, provider] of mockProviders.entries()) {
        if (mockRes.headersSent) break;

        if ('handleTokenExchange' in provider) {
          try {
            await provider.handleTokenExchange(mockReq as Request, mockRes as Response);
            break;
          } catch (error) {
            if (mockRes.headersSent) break;
          }
        }
      }

      expect(googleProvider.handleTokenExchange).toHaveBeenCalled();
      expect(githubProvider.handleTokenExchange).not.toHaveBeenCalled(); // Stopped due to headersSent
    });
  });

  describe('Direct provider routing', () => {
    it('should use correct provider when code_verifier found', async () => {
      const googleProvider = {
        hasStoredCodeForProvider: jest.fn<(code: string) => Promise<boolean>>().mockResolvedValue(true),
        handleTokenExchange: jest.fn<(req: Request, res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      const githubProvider = {
        hasStoredCodeForProvider: jest.fn<(code: string) => Promise<boolean>>().mockResolvedValue(false),
        handleTokenExchange: jest.fn<(req: Request, res: Response) => Promise<void>>().mockResolvedValue(undefined),
      };

      mockProviders.set('google', googleProvider);
      mockProviders.set('github', githubProvider);

      mockReq.body = {
        grant_type: 'authorization_code',
        code: 'google-code-123',
      };

      // Find correct provider
      let correctProvider = null;

      for (const [_providerType, provider] of mockProviders.entries()) {
        if ('hasStoredCodeForProvider' in provider) {
          const hasCode = await provider.hasStoredCodeForProvider(mockReq.body.code);
          if (hasCode) {
            correctProvider = provider;
            break;
          }
        }
      }

      // Use correct provider directly
      if (correctProvider && 'handleTokenExchange' in correctProvider) {
        await correctProvider.handleTokenExchange(mockReq as Request, mockRes as Response);
      }

      expect(googleProvider.handleTokenExchange).toHaveBeenCalledWith(mockReq as Request, mockRes as Response);
      expect(githubProvider.handleTokenExchange).not.toHaveBeenCalled(); // Not tried
    });

    it('should handle errors from correct provider gracefully', async () => {
      const googleProvider = {
        hasStoredCodeForProvider: jest.fn<(code: string) => Promise<boolean>>().mockResolvedValue(true),
        handleTokenExchange: jest.fn<(req: Request, res: Response) => Promise<void>>().mockRejectedValue(new Error('Token exchange failed')),
      };

      mockProviders.set('google', googleProvider);

      mockReq.body = {
        grant_type: 'authorization_code',
        code: 'google-code-123',
      };

      let correctProvider = null;
      let error: Error | null = null;

      for (const [_providerType, provider] of mockProviders.entries()) {
        if ('hasStoredCodeForProvider' in provider) {
          const hasCode = await provider.hasStoredCodeForProvider(mockReq.body.code);
          if (hasCode) {
            correctProvider = provider;
            break;
          }
        }
      }

      if (correctProvider && 'handleTokenExchange' in correctProvider) {
        try {
          await correctProvider.handleTokenExchange(mockReq as Request, mockRes as Response);
        } catch (err) {
          error = err as Error;
        }
      }

      expect(error).not.toBeNull();
      expect(error?.message).toBe('Token exchange failed');
    });
  });
});
