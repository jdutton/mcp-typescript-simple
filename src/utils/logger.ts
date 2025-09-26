/**
 * Production-safe logger with configurable log levels
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private static instance: Logger | null = null;
  private logLevel: LogLevel;
  private isProduction: boolean;

  constructor(logLevel: LogLevel = 'info') {
    this.logLevel = logLevel;
    this.isProduction = process.env.NODE_ENV === 'production';
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      const defaultLevel: LogLevel = process.env.NODE_ENV === 'production' ? 'warn' : 'info';
      Logger.instance = new Logger(defaultLevel);
    }
    return Logger.instance;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  private sanitizeForProduction(message: string, data?: unknown): { message: string; data?: unknown } {
    if (!this.isProduction) {
      return { message, data };
    }

    // In production, sanitize sensitive information
    const sanitizedMessage = message
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]')
      .replace(/\b\d{4,}\b/g, '[NUMBER]')
      .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [TOKEN]')
      .replace(/[A-Za-z0-9\-._~+/]{32,}/g, '[TOKEN]');

    // Sanitize data object
    let sanitizedData = data;
    if (data && typeof data === 'object') {
      sanitizedData = this.sanitizeObject(data);
    }

    return { message: sanitizedMessage, data: sanitizedData };
  }

  private sanitizeObject(obj: unknown, visited?: WeakSet<object>): unknown {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    // Initialize visited set on first call
    if (!visited) {
      visited = new WeakSet();
    }

    // Check for circular reference
    if (visited.has(obj as object)) {
      return '[Circular Reference]';
    }

    // Mark current object as visited
    visited.add(obj as object);

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeObject(item, visited));
    }

    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = ['password', 'secret', 'token', 'key', 'auth', 'credential'];

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();

      if (sensitiveKeys.some(sensitiveKey => lowerKey.includes(sensitiveKey))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeObject(value, visited);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  debug(message: string, data?: unknown): void {
    if (!this.shouldLog('debug')) return;

    const { message: sanitizedMessage, data: sanitizedData } = this.sanitizeForProduction(message, data);
    if (sanitizedData) {
      console.debug(`[DEBUG] ${sanitizedMessage}`, sanitizedData);
    } else {
      console.debug(`[DEBUG] ${sanitizedMessage}`);
    }
  }

  info(message: string, data?: unknown): void {
    if (!this.shouldLog('info')) return;

    const { message: sanitizedMessage, data: sanitizedData } = this.sanitizeForProduction(message, data);
    if (sanitizedData) {
      console.log(`[INFO] ${sanitizedMessage}`, sanitizedData);
    } else {
      console.log(`[INFO] ${sanitizedMessage}`);
    }
  }

  warn(message: string, data?: unknown): void {
    if (!this.shouldLog('warn')) return;

    const { message: sanitizedMessage, data: sanitizedData } = this.sanitizeForProduction(message, data);
    if (sanitizedData) {
      console.warn(`[WARN] ${sanitizedMessage}`, sanitizedData);
    } else {
      console.warn(`[WARN] ${sanitizedMessage}`);
    }
  }

  error(message: string, error?: Error | unknown): void {
    if (!this.shouldLog('error')) return;

    const { message: sanitizedMessage } = this.sanitizeForProduction(message);

    if (error instanceof Error) {
      const errorInfo = this.isProduction
        ? { name: error.name, message: 'Internal server error' }
        : { name: error.name, message: error.message, stack: error.stack };

      console.error(`[ERROR] ${sanitizedMessage}`, errorInfo);
    } else if (error) {
      const { data: sanitizedError } = this.sanitizeForProduction('', error);
      console.error(`[ERROR] ${sanitizedMessage}`, sanitizedError);
    } else {
      console.error(`[ERROR] ${sanitizedMessage}`);
    }
  }

  // OAuth-specific logging methods
  oauthDebug(message: string, data?: unknown): void {
    this.debug(`[OAuth] ${message}`, data);
  }

  oauthInfo(message: string, data?: unknown): void {
    this.info(`[OAuth] ${message}`, data);
  }

  oauthWarn(message: string, data?: unknown): void {
    this.warn(`[OAuth] ${message}`, data);
  }

  oauthError(message: string, error?: Error | unknown): void {
    this.error(`[OAuth] ${message}`, error);
  }
}

// Export singleton instance
export const logger = Logger.getInstance();