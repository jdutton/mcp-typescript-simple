import { Logger, logger, type LogLevel } from '../../../src/utils/logger.js';

describe('Logger', () => {
  let consoleSpy: {
    debug: jest.SpyInstance;
    log: jest.SpyInstance;
    warn: jest.SpyInstance;
    error: jest.SpyInstance;
  };
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    // Mock console methods
    consoleSpy = {
      debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
      log: jest.spyOn(console, 'log').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
    };

    // Store original NODE_ENV
    originalNodeEnv = process.env.NODE_ENV;

    // Clear singleton instance for fresh tests
    (Logger as any).instance = null;
  });

  afterEach(() => {
    // Restore console methods
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());

    // Restore NODE_ENV
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  describe('Constructor and Log Level Management', () => {
    it('creates logger with default info level', () => {
      const testLogger = new Logger();

      testLogger.info('test message');
      testLogger.debug('debug message'); // Should not log

      expect(consoleSpy.log).toHaveBeenCalledWith('[INFO] test message');
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    it('creates logger with custom log level', () => {
      const testLogger = new Logger('debug');

      testLogger.debug('debug message');
      testLogger.info('info message');

      expect(consoleSpy.debug).toHaveBeenCalledWith('[DEBUG] debug message');
      expect(consoleSpy.log).toHaveBeenCalledWith('[INFO] info message');
    });

    it('respects log level hierarchy', () => {
      const testLogger = new Logger('warn');

      testLogger.debug('debug message'); // Should not log
      testLogger.info('info message');   // Should not log
      testLogger.warn('warn message');   // Should log
      testLogger.error('error message'); // Should log

      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalledWith('[WARN] warn message');
      expect(consoleSpy.error).toHaveBeenCalledWith('[ERROR] error message');
    });
  });

  describe('Singleton Pattern', () => {
    it('returns same instance on multiple calls', () => {
      const instance1 = Logger.getInstance();
      const instance2 = Logger.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('uses warn level in production environment', () => {
      process.env.NODE_ENV = 'production';

      const instance = Logger.getInstance();

      instance.info('info message'); // Should not log in production with warn level
      instance.warn('warn message'); // Should log

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalledWith('[WARN] warn message');
    });

    it('uses info level in non-production environment', () => {
      process.env.NODE_ENV = 'development';

      const instance = Logger.getInstance();

      instance.info('info message'); // Should log
      instance.debug('debug message'); // Should not log with info level

      expect(consoleSpy.log).toHaveBeenCalledWith('[INFO] info message');
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });
  });

  describe('Production Sanitization', () => {
    it('sanitizes sensitive information in production', () => {
      // Create logger AFTER setting NODE_ENV to production
      process.env.NODE_ENV = 'production';
      const testLogger = new Logger('info');

      testLogger.info('User email is user@example.com and token Bearer abc123def456');

      expect(consoleSpy.log).toHaveBeenCalledWith('[INFO] User email is [EMAIL] and token Bearer [TOKEN]');
    });

    it('does not sanitize in non-production', () => {
      process.env.NODE_ENV = 'development';
      const testLogger = new Logger('info');

      testLogger.info('User email is user@example.com and token Bearer abc123def456');

      expect(consoleSpy.log).toHaveBeenCalledWith('[INFO] User email is user@example.com and token Bearer abc123def456');
    });

    it('sanitizes sensitive data objects in production', () => {
      // Create logger AFTER setting NODE_ENV to production
      process.env.NODE_ENV = 'production';
      const testLogger = new Logger('info');

      const sensitiveData = {
        username: 'john',
        password: 'secret123',
        apiKey: 'key-abc-123',
        token: 'token-xyz-789',
        publicInfo: 'this is fine'
      };

      testLogger.info('Login attempt', sensitiveData);

      expect(consoleSpy.log).toHaveBeenCalledWith('[INFO] Login attempt', {
        username: 'john',
        password: '[REDACTED]',
        apiKey: '[REDACTED]',
        token: '[REDACTED]',
        publicInfo: 'this is fine'
      });
    });

    it('sanitizes nested objects recursively', () => {
      // Clear any previous console spy calls
      consoleSpy.log.mockClear();

      // Create logger AFTER setting NODE_ENV to production
      process.env.NODE_ENV = 'production';
      const testLogger = new Logger('info');

      const nestedData = {
        user: {
          name: 'john',
          credentials: {
            password: 'secret123',
            apiKey: 'key-abc-123',
            profile: {
              email: 'john@example.com',
              token: 'nested-token-456'
            }
          },
          publicInfo: 'this is fine'
        },
        metadata: {
          safe: 'data',
          auth: {
            secret: 'deeply-nested-secret'
          }
        }
      };

      testLogger.info('Nested test', nestedData);

      expect(consoleSpy.log).toHaveBeenCalledWith('[INFO] Nested test', {
        user: {
          name: 'john',
          credentials: '[REDACTED]', // Entire credentials object is redacted because key contains "credential"
          publicInfo: 'this is fine'
        },
        metadata: {
          safe: 'data',
          auth: '[REDACTED]' // Entire auth object is redacted because key is "auth"
        }
      });
    });

    it('handles non-object data types', () => {
      // Create logger AFTER setting NODE_ENV to production
      process.env.NODE_ENV = 'production';
      const testLogger = new Logger('info');

      testLogger.info('String data', 'simple string');
      testLogger.info('Number data', 42);
      testLogger.info('Null data', null);

      expect(consoleSpy.log).toHaveBeenNthCalledWith(1, '[INFO] String data', 'simple string');
      expect(consoleSpy.log).toHaveBeenNthCalledWith(2, '[INFO] Number data', 42);
      // Null data doesn't get logged as second parameter if null
      expect(consoleSpy.log).toHaveBeenNthCalledWith(3, '[INFO] Null data');
    });
  });

  describe('Logging Methods', () => {
    let testLogger: Logger;

    beforeEach(() => {
      testLogger = new Logger('debug'); // Allow all log levels
    });

    it('logs debug messages with data', () => {
      const testData = { key: 'value' };
      testLogger.debug('debug message', testData);

      expect(consoleSpy.debug).toHaveBeenCalledWith('[DEBUG] debug message', testData);
    });

    it('logs debug messages without data', () => {
      testLogger.debug('debug message');

      expect(consoleSpy.debug).toHaveBeenCalledWith('[DEBUG] debug message');
    });

    it('logs info messages with data', () => {
      const testData = { key: 'value' };
      testLogger.info('info message', testData);

      expect(consoleSpy.log).toHaveBeenCalledWith('[INFO] info message', testData);
    });

    it('logs info messages without data', () => {
      testLogger.info('info message');

      expect(consoleSpy.log).toHaveBeenCalledWith('[INFO] info message');
    });

    it('logs warn messages with data', () => {
      const testData = { key: 'value' };
      testLogger.warn('warn message', testData);

      expect(consoleSpy.warn).toHaveBeenCalledWith('[WARN] warn message', testData);
    });

    it('logs warn messages without data', () => {
      testLogger.warn('warn message');

      expect(consoleSpy.warn).toHaveBeenCalledWith('[WARN] warn message');
    });
  });

  describe('Error Logging', () => {
    let testLogger: Logger;

    beforeEach(() => {
      testLogger = new Logger('error');
    });

    it('logs Error objects in development', () => {
      process.env.NODE_ENV = 'development';

      const testError = new Error('Test error');
      testError.stack = 'Error stack trace';

      testLogger.error('Error occurred', testError);

      expect(consoleSpy.error).toHaveBeenCalledWith('[ERROR] Error occurred', {
        name: 'Error',
        message: 'Test error',
        stack: 'Error stack trace'
      });
    });

    it('logs Error objects in production with sanitized message', () => {
      // Create logger AFTER setting NODE_ENV to production
      process.env.NODE_ENV = 'production';
      const testLogger = new Logger('error');

      const testError = new Error('Sensitive error details');
      testLogger.error('Error occurred', testError);

      expect(consoleSpy.error).toHaveBeenCalledWith('[ERROR] Error occurred', expect.objectContaining({
        name: 'Error',
        message: 'Internal server error'
      }));
    });

    it('logs non-Error objects', () => {
      const errorData = { code: 500, message: 'Server error' };
      testLogger.error('Custom error', errorData);

      expect(consoleSpy.error).toHaveBeenCalledWith('[ERROR] Custom error', errorData);
    });

    it('logs error messages without error object', () => {
      testLogger.error('Simple error message');

      expect(consoleSpy.error).toHaveBeenCalledWith('[ERROR] Simple error message');
    });
  });

  describe('OAuth-specific Methods', () => {
    let testLogger: Logger;

    beforeEach(() => {
      testLogger = new Logger('debug');
    });

    it('logs OAuth debug messages', () => {
      const testData = { state: 'abc123' };
      testLogger.oauthDebug('OAuth flow started', testData);

      expect(consoleSpy.debug).toHaveBeenCalledWith('[DEBUG] [OAuth] OAuth flow started', testData);
    });

    it('logs OAuth info messages', () => {
      const testData = { provider: 'google' };
      testLogger.oauthInfo('OAuth provider configured', testData);

      expect(consoleSpy.log).toHaveBeenCalledWith('[INFO] [OAuth] OAuth provider configured', testData);
    });

    it('logs OAuth warn messages', () => {
      const testData = { issue: 'token expiring' };
      testLogger.oauthWarn('OAuth token issue', testData);

      expect(consoleSpy.warn).toHaveBeenCalledWith('[WARN] [OAuth] OAuth token issue', testData);
    });

    it('logs OAuth error messages', () => {
      const testError = new Error('OAuth failed');
      testLogger.oauthError('OAuth authentication failed', testError);

      expect(consoleSpy.error).toHaveBeenCalledWith('[ERROR] [OAuth] OAuth authentication failed', {
        name: 'Error',
        message: 'OAuth failed',
        stack: testError.stack
      });
    });
  });

  describe('Exported Logger Instance', () => {
    it('exports a singleton logger instance', () => {
      expect(logger).toBeDefined();
      expect(logger).toBeInstanceOf(Logger);
    });

    it('exported logger works correctly', () => {
      logger.info('test message from exported logger');

      expect(consoleSpy.log).toHaveBeenCalledWith('[INFO] test message from exported logger');
    });
  });

  describe('Edge Cases', () => {
    let testLogger: Logger;

    beforeEach(() => {
      testLogger = new Logger('debug');
    });

    it('handles undefined and null values in data sanitization', () => {
      // Create logger AFTER setting NODE_ENV to production
      process.env.NODE_ENV = 'production';
      const testLogger = new Logger('debug');

      testLogger.info('Test message', undefined);
      testLogger.info('Test message', null);

      // Undefined and null values don't get logged as second parameter
      expect(consoleSpy.log).toHaveBeenNthCalledWith(1, '[INFO] Test message');
      expect(consoleSpy.log).toHaveBeenNthCalledWith(2, '[INFO] Test message');
    });

    it('handles circular references by catching errors', () => {
      // Create logger AFTER setting NODE_ENV to production
      process.env.NODE_ENV = 'production';
      const testLogger = new Logger('info');

      const circularObj: any = {
        name: 'test',
        data: 'some data',
        password: 'secret123'
      };
      circularObj.self = circularObj; // Create circular reference

      // This should not crash and should handle the circular reference gracefully
      expect(() => {
        testLogger.info('Circular reference test', circularObj);
      }).not.toThrow();

      expect(consoleSpy.log).toHaveBeenCalledWith('[INFO] Circular reference test', {
        name: 'test',
        data: 'some data',
        password: '[REDACTED]',
        self: '[Circular Reference]'
      });
    });

    it('handles circular references in arrays', () => {
      // Create logger AFTER setting NODE_ENV to production
      process.env.NODE_ENV = 'production';
      const testLogger = new Logger('info');

      const arrayWithCircularRef: any[] = ['item1', 'item2'];
      arrayWithCircularRef.push(arrayWithCircularRef); // Create circular reference in array

      const dataWithCircularArray = {
        name: 'test',
        items: arrayWithCircularRef,
        password: 'secret123'
      };

      // This should not crash and should handle the circular reference gracefully
      expect(() => {
        testLogger.info('Circular array test', dataWithCircularArray);
      }).not.toThrow();

      expect(consoleSpy.log).toHaveBeenCalledWith('[INFO] Circular array test', {
        name: 'test',
        items: ['item1', 'item2', '[Circular Reference]'],
        password: '[REDACTED]'
      });
    });

    it('properly identifies sensitive keys case-insensitive', () => {
      // Create logger AFTER setting NODE_ENV to production
      process.env.NODE_ENV = 'production';
      const testLogger = new Logger('debug');

      const testData = {
        PASSWORD: 'should-be-redacted',
        Secret: 'also-redacted',
        TOKEN: 'redacted-too',
        normalField: 'not-redacted'
      };

      testLogger.info('Sensitive key test', testData);

      const loggedData = consoleSpy.log.mock.calls[0][1];
      expect(loggedData.PASSWORD).toBe('[REDACTED]');
      expect(loggedData.Secret).toBe('[REDACTED]');
      expect(loggedData.TOKEN).toBe('[REDACTED]');
      expect(loggedData.normalField).toBe('not-redacted');
    });

    it('handles arrays with nested sensitive data', () => {
      // Create logger AFTER setting NODE_ENV to production
      process.env.NODE_ENV = 'production';
      const testLogger = new Logger('debug');

      const arrayData = [
        { name: 'user1', password: 'secret1' },
        { name: 'user2', token: 'secret2' }
      ];

      testLogger.info('Array data', arrayData);

      const loggedData = consoleSpy.log.mock.calls[0][1];
      expect(Array.isArray(loggedData)).toBe(true);
      expect(loggedData[0].name).toBe('user1');
      expect(loggedData[0].password).toBe('[REDACTED]');
      expect(loggedData[1].name).toBe('user2');
      expect(loggedData[1].token).toBe('[REDACTED]');
    });
  });
});