/**
 * Unit tests for DCR Authentication Middleware
 */

import { Request, Response, NextFunction } from 'express';
import { requireInitialAccessToken, requireAdminToken } from '../../../src/middleware/dcr-auth.js';
import { InitialAccessTokenStore, InitialAccessToken, TokenValidationResult } from '../../../src/auth/stores/token-store-interface.js';

// Mock logger
vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('DCR Authentication Middleware', () => {
  let mockTokenStore: Mocked<InitialAccessTokenStore>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    // Create mock token store
    mockTokenStore = {
      validateAndUseToken: vi.fn(),
      createToken: vi.fn(),
      revokeToken: vi.fn(),
      getToken: vi.fn(),
      getTokenByValue: vi.fn(),
      deleteToken: vi.fn(),
      listTokens: vi.fn(),
      cleanup: vi.fn(),
      dispose: vi.fn(),
    } as jest.Mocked<InitialAccessTokenStore>;

    // Create mock request
    mockRequest = {
      headers: {},
      path: '/register',
      method: 'POST',
    };

    // Create mock response
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    // Create mock next function
    nextFunction = vi.fn();
  });

  describe('requireInitialAccessToken', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const middleware = requireInitialAccessToken(mockTokenStore);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'invalid_token',
        error_description: 'Missing Authorization header. Use: Authorization: Bearer <token>',
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('returns 401 when Authorization header format is invalid', async () => {
      mockRequest.headers = { authorization: 'InvalidFormat token123' };
      const middleware = requireInitialAccessToken(mockTokenStore);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'invalid_token',
        error_description: 'Invalid Authorization header format. Use: Authorization: Bearer <token>',
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('returns 401 when Authorization header is missing token value', async () => {
      mockRequest.headers = { authorization: 'Bearer ' };
      const middleware = requireInitialAccessToken(mockTokenStore);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'invalid_token',
        error_description: 'Invalid Authorization header format. Use: Authorization: Bearer <token>',
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('returns 401 when token validation fails', async () => {
      mockRequest.headers = { authorization: 'Bearer invalid-token-123' };
      const middleware = requireInitialAccessToken(mockTokenStore);

      const validationResult: TokenValidationResult = {
        valid: false,
        reason: 'Token not found',
      };

      mockTokenStore.validateAndUseToken.mockResolvedValueOnce(validationResult);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockTokenStore.validateAndUseToken).toHaveBeenCalledWith('invalid-token-123');
      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'invalid_token',
        error_description: 'Token not found',
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('returns 401 when token is expired', async () => {
      mockRequest.headers = { authorization: 'Bearer expired-token-456' };
      const middleware = requireInitialAccessToken(mockTokenStore);

      const validationResult: TokenValidationResult = {
        valid: false,
        reason: 'Token has expired',
      };

      mockTokenStore.validateAndUseToken.mockResolvedValueOnce(validationResult);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'invalid_token',
        error_description: 'Token has expired',
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('calls next() when token is valid', async () => {
      mockRequest.headers = { authorization: 'Bearer valid-token-789' };
      const middleware = requireInitialAccessToken(mockTokenStore);

      const validToken: InitialAccessToken = {
        id: 'token-id-123',
        token: 'valid-token-789',
        description: 'Test token',
        created_at: Date.now() - 60000,
        expires_at: Date.now() + 3600000,
        usage_count: 1,
        max_uses: 10,
        revoked: false,
      };

      const validationResult: TokenValidationResult = {
        valid: true,
        token: validToken,
      };

      mockTokenStore.validateAndUseToken.mockResolvedValueOnce(validationResult);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockTokenStore.validateAndUseToken).toHaveBeenCalledWith('valid-token-789');
      expect(mockRequest.initialAccessToken).toEqual(validToken);
      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });

    it('handles Bearer token with case-insensitive header', async () => {
      mockRequest.headers = { authorization: 'bearer lowercase-token' };
      const middleware = requireInitialAccessToken(mockTokenStore);

      const validToken: InitialAccessToken = {
        id: 'token-id-456',
        token: 'lowercase-token',
        description: 'Lowercase test',
        created_at: Date.now() - 60000,
        expires_at: Date.now() + 3600000,
        usage_count: 0,
        max_uses: 5,
        revoked: false,
      };

      const validationResult: TokenValidationResult = {
        valid: true,
        token: validToken,
      };

      mockTokenStore.validateAndUseToken.mockResolvedValueOnce(validationResult);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockTokenStore.validateAndUseToken).toHaveBeenCalledWith('lowercase-token');
      expect(nextFunction).toHaveBeenCalled();
    });

    it('returns 500 when token store throws an error', async () => {
      mockRequest.headers = { authorization: 'Bearer error-token' };
      const middleware = requireInitialAccessToken(mockTokenStore);

      mockTokenStore.validateAndUseToken.mockRejectedValueOnce(new Error('Database connection failed'));

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'server_error',
        error_description: 'Internal server error during token validation',
      });
      expect(nextFunction).not.toHaveBeenCalled();
    });

    it('increments token usage count on successful validation', async () => {
      mockRequest.headers = { authorization: 'Bearer multi-use-token' };
      const middleware = requireInitialAccessToken(mockTokenStore);

      const validToken: InitialAccessToken = {
        id: 'token-id-multi',
        token: 'multi-use-token',
        description: 'Multi-use test',
        created_at: Date.now() - 120000,
        expires_at: Date.now() + 3600000,
        usage_count: 3,
        max_uses: 10,
        revoked: false,
      };

      const validationResult: TokenValidationResult = {
        valid: true,
        token: validToken,
      };

      mockTokenStore.validateAndUseToken.mockResolvedValueOnce(validationResult);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockTokenStore.validateAndUseToken).toHaveBeenCalledWith('multi-use-token');
      expect(mockRequest.initialAccessToken?.usage_count).toBe(3);
      expect(nextFunction).toHaveBeenCalled();
    });
  });

  describe('requireAdminToken', () => {
    // NOTE: requireAdminToken wraps requireInitialAccessToken.
    // Authorization header validation and 401 error scenarios are covered by
    // requireInitialAccessToken tests above. Only testing the success path here.

    it('calls next() when valid admin token is provided', async () => {
      mockRequest.headers = { authorization: 'Bearer valid-admin-token' };
      const middleware = requireAdminToken(mockTokenStore);

      const validToken: InitialAccessToken = {
        id: 'admin-token-id',
        token: 'valid-admin-token',
        description: 'Admin token',
        created_at: Date.now() - 60000,
        expires_at: Date.now() + 3600000,
        usage_count: 0,
        max_uses: 100,
        revoked: false,
      };

      const validationResult: TokenValidationResult = {
        valid: true,
        token: validToken,
      };

      mockTokenStore.validateAndUseToken.mockResolvedValueOnce(validationResult);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockRequest.initialAccessToken).toEqual(validToken);
      expect(nextFunction).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalledWith(403);
    });

    it('attaches token to request for downstream handlers', async () => {
      mockRequest.headers = { authorization: 'Bearer metadata-token' };
      const middleware = requireAdminToken(mockTokenStore);

      const validToken: InitialAccessToken = {
        id: 'metadata-id',
        token: 'metadata-token',
        description: 'Metadata test',
        created_at: Date.now() - 30000,
        expires_at: Date.now() + 7200000,
        usage_count: 5,
        max_uses: 50,
        revoked: false,
      };

      const validationResult: TokenValidationResult = {
        valid: true,
        token: validToken,
      };

      mockTokenStore.validateAndUseToken.mockResolvedValueOnce(validationResult);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(mockRequest.initialAccessToken).toEqual(validToken);
      expect(mockRequest.initialAccessToken?.id).toBe('metadata-id');
      expect(nextFunction).toHaveBeenCalled();
    });
  });
});
