/**
 * Tests for session correlation
 */

// Mock OpenTelemetry API first
const mockSpan = {
  setAttributes: jest.fn(),
  end: jest.fn(),
  recordException: jest.fn(),
  setStatus: jest.fn()
};

const mockTrace = {
  getActiveSpan: jest.fn(() => mockSpan),
  getTracer: jest.fn(() => ({
    startActiveSpan: jest.fn((name, callback) => callback(mockSpan))
  }))
};

jest.mock('@opentelemetry/api', () => ({
  trace: mockTrace
}));

import {
  extractSessionContext,
  addSessionToSpan
} from '../../../src/observability/session-correlation.js';
import type { SessionInfo } from '../../../src/session/session-manager.js';

describe('Session Correlation', () => {
  describe('extractSessionContext', () => {
    it('should extract safe session context from SessionInfo', () => {
      const mockSession: SessionInfo = {
        sessionId: 'test-uuid-12345',
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authInfo: { user: { id: 'user123' } } as any,
        metadata: { test: true }
      };

      const context = extractSessionContext(mockSession);

      expect(context.sessionId).toBe('test-uuid-12345');
      expect(context.createdAt).toBe(1234567890000);
      expect(context.lastActivity).toBe(1234567890100);
      expect(context.authenticated).toBe(true);
    });

    it('should handle session without auth info', () => {
      const mockSession: SessionInfo = {
        sessionId: 'test-uuid-67890',
        createdAt: 1234567890000,
        lastActivity: 1234567890100
      };

      const context = extractSessionContext(mockSession);

      expect(context.sessionId).toBe('test-uuid-67890');
      expect(context.authenticated).toBe(false);
    });

    it('should only include safe technical identifiers', () => {
      const mockSession: SessionInfo = {
        sessionId: 'test-uuid-12345',
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authInfo: {
          user: { id: 'user123', email: 'user@example.com' }
        } as any
      };

      const context = extractSessionContext(mockSession);

      // Should not include PII from authInfo
      expect(context).not.toHaveProperty('user');
      expect(context).not.toHaveProperty('email');
      expect(context).toEqual({
        sessionId: 'test-uuid-12345',
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authenticated: true
      });
    });
  });

  describe('addSessionToSpan', () => {
    beforeEach(() => {
      mockSpan.setAttributes.mockClear();
      mockTrace.getActiveSpan.mockClear();
      mockTrace.getActiveSpan.mockReturnValue(mockSpan);
    });

    it('should add session attributes to active span', () => {
      const sessionContext = {
        sessionId: 'test-uuid-12345',
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authenticated: true
      };

      addSessionToSpan(sessionContext);

      expect(mockTrace.getActiveSpan).toHaveBeenCalled();
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'mcp.session.id': 'test-uuid-12345',
        'mcp.session.created_at': 1234567890000,
        'mcp.session.authenticated': true,
        'mcp.session.last_activity': 1234567890100
      });
    });

    it('should handle case when no active span exists', () => {
      (mockTrace.getActiveSpan as jest.Mock).mockReturnValue(undefined);

      const sessionContext = {
        sessionId: 'test-uuid-12345',
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authenticated: false
      };

      // Should not throw when no active span
      expect(() => addSessionToSpan(sessionContext)).not.toThrow();
      expect(mockSpan.setAttributes).not.toHaveBeenCalled();
    });

    it('should handle null or undefined span', () => {
      (mockTrace.getActiveSpan as jest.Mock).mockReturnValue(null);

      const sessionContext = {
        sessionId: 'test-uuid-67890',
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authenticated: true
      };

      expect(() => addSessionToSpan(sessionContext)).not.toThrow();
      expect(mockSpan.setAttributes).not.toHaveBeenCalled();
    });

    it('should handle unauthenticated sessions', () => {
      const sessionContext = {
        sessionId: 'unauth-session-123',
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authenticated: false
      };

      addSessionToSpan(sessionContext);

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'mcp.session.id': 'unauth-session-123',
        'mcp.session.created_at': 1234567890000,
        'mcp.session.authenticated': false,
        'mcp.session.last_activity': 1234567890100
      });
    });

    it('should handle sessions with minimal data', () => {
      const sessionContext = {
        sessionId: 'minimal-session',
        createdAt: 0,
        lastActivity: 0,
        authenticated: false
      };

      addSessionToSpan(sessionContext);

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'mcp.session.id': 'minimal-session',
        'mcp.session.created_at': 0,
        'mcp.session.authenticated': false,
        'mcp.session.last_activity': 0
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle extractSessionContext with partial SessionInfo', () => {
      const partialSession = {
        sessionId: 'partial-123',
        createdAt: 1234567890000,
        lastActivity: 1234567890100
        // Missing authInfo and metadata
      } as any;

      const context = extractSessionContext(partialSession);

      expect(context).toEqual({
        sessionId: 'partial-123',
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authenticated: false
      });
    });

    it('should handle extractSessionContext with null authInfo', () => {
      const sessionWithNullAuth = {
        sessionId: 'null-auth-123',
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authInfo: null,
        metadata: { test: true }
      } as any;

      const context = extractSessionContext(sessionWithNullAuth);

      expect(context).toEqual({
        sessionId: 'null-auth-123',
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authenticated: false
      });
    });

    it('should handle extractSessionContext with complex authInfo', () => {
      const sessionWithComplexAuth = {
        sessionId: 'complex-auth-123',
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authInfo: {
          user: {
            id: 'user123',
            email: 'user@example.com',
            profile: {
              name: 'Test User',
              avatar: 'avatar.jpg'
            }
          },
          provider: 'google',
          scopes: ['read', 'write'],
          token: 'secret-token'
        },
        metadata: {
          clientId: 'client123',
          userAgent: 'test-agent',
          ipAddress: '192.168.1.1'
        }
      } as any;

      const context = extractSessionContext(sessionWithComplexAuth);

      // Should only extract safe technical identifiers
      expect(context).toEqual({
        sessionId: 'complex-auth-123',
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authenticated: true
      });

      // Ensure no PII is included
      expect(context).not.toHaveProperty('user');
      expect(context).not.toHaveProperty('email');
      expect(context).not.toHaveProperty('profile');
      expect(context).not.toHaveProperty('token');
      expect(context).not.toHaveProperty('metadata');
    });
  });

  describe('Security and PII Protection', () => {
    it('should never expose sensitive user data in traces', () => {
      const sessionWithSensitiveData = {
        sessionId: 'security-test-123',
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authInfo: {
          user: {
            id: 'user123',
            email: 'sensitive@example.com',
            phoneNumber: '+1234567890',
            socialSecurityNumber: '123-45-6789',
            creditCard: '4111-1111-1111-1111',
            password: 'supersecret'
          },
          tokens: {
            accessToken: 'at_secret_token',
            refreshToken: 'rt_secret_token',
            idToken: 'id_secret_token'
          },
          provider: 'google',
          scopes: ['read', 'write']
        },
        metadata: {
          ipAddress: '192.168.1.100',
          userAgent: 'Mozilla/5.0...',
          sessionKey: 'secret_session_key',
          internalId: 'internal_12345'
        }
      } as any;

      const context = extractSessionContext(sessionWithSensitiveData);

      // Verify only safe technical identifiers are included
      expect(context).toEqual({
        sessionId: 'security-test-123',
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authenticated: true
      });

      // Verify no sensitive data is leaked
      const contextString = JSON.stringify(context);
      expect(contextString).not.toContain('sensitive@example.com');
      expect(contextString).not.toContain('123-45-6789');
      expect(contextString).not.toContain('4111-1111-1111-1111');
      expect(contextString).not.toContain('supersecret');
      expect(contextString).not.toContain('at_secret_token');
      expect(contextString).not.toContain('rt_secret_token');
      expect(contextString).not.toContain('192.168.1.100');
      expect(contextString).not.toContain('secret_session_key');
    });

    it('should sanitize span attributes to prevent PII leakage', () => {
      const sessionContext = {
        sessionId: 'test-uuid-12345',
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authenticated: true
      };

      addSessionToSpan(sessionContext);

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'mcp.session.id': 'test-uuid-12345',
        'mcp.session.created_at': 1234567890000,
        'mcp.session.authenticated': true,
        'mcp.session.last_activity': 1234567890100
      });

      // Verify no additional sensitive attributes are added
      const calls = mockSpan.setAttributes.mock.calls;
      const allAttributes = calls.reduce((acc, call) => ({ ...acc, ...call[0] }), {});

      // Check that only expected safe attributes are present
      const expectedAttributes = [
        'mcp.session.id',
        'mcp.session.created_at',
        'mcp.session.authenticated',
        'mcp.session.last_activity'
      ];

      Object.keys(allAttributes).forEach(key => {
        expect(expectedAttributes).toContain(key);
      });
    });

    it('should handle malicious input attempting to inject PII', () => {
      const maliciousSession = {
        sessionId: 'user@evil.com',  // Trying to inject email as session ID
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authInfo: null,  // No auth info means not authenticated
        // Attempting to add extra malicious fields
        'mcp.user.email': 'injected@evil.com',
        'user_email': 'another@evil.com'
      } as any;

      const context = extractSessionContext(maliciousSession);

      // Should only extract the expected safe fields
      expect(context).toEqual({
        sessionId: 'user@evil.com',  // Session ID is preserved as-is (application responsibility)
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authenticated: false  // No authInfo means false
      });

      // Should not contain injected fields
      expect(context).not.toHaveProperty('mcp.user.email');
      expect(context).not.toHaveProperty('user_email');
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle corrupted session data gracefully', () => {
      const corruptedSession = {
        sessionId: null,
        createdAt: 'invalid_date',
        lastActivity: undefined,
        authInfo: 'not_an_object'  // This is truthy, so authenticated will be true
      } as any;

      expect(() => extractSessionContext(corruptedSession)).not.toThrow();

      const context = extractSessionContext(corruptedSession);
      expect(context).toEqual({
        sessionId: null,
        createdAt: 'invalid_date',
        lastActivity: undefined,
        authenticated: true  // !!('not_an_object') is true
      });
    });


    it('should handle circular references in session data', () => {
      const circularSession: any = {
        sessionId: 'circular-test',
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authInfo: { user: { id: 'user123' } }
      };

      // Create circular reference
      circularSession.authInfo.session = circularSession;

      expect(() => extractSessionContext(circularSession)).not.toThrow();

      const context = extractSessionContext(circularSession);
      expect(context).toEqual({
        sessionId: 'circular-test',
        createdAt: 1234567890000,
        lastActivity: 1234567890100,
        authenticated: true
      });
    });
  });
});
