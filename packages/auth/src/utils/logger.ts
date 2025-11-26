/**
 * Simple console-based logger for auth package
 * Provides basic logging without external dependencies
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private static instance: Logger | null = null;
  private logLevel: LogLevel;

  constructor(logLevel: LogLevel = 'info') {
    this.logLevel = logLevel;
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      const level = (process.env.LOG_LEVEL as LogLevel) ?? 'info';
      Logger.instance = new Logger(level);
    }
    return Logger.instance;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3,
    };
    return levels[level] >= levels[this.logLevel];
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog('debug')) {
      console.debug(`[DEBUG] ${message}`, data !== undefined ? data : '');
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog('info')) {
      console.info(`[INFO] ${message}`, data !== undefined ? data : '');
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog('warn')) {
      console.warn(`[WARN] ${message}`, data !== undefined ? data : '');
    }
  }

  error(message: string, error?: Error | unknown): void {
    if (this.shouldLog('error')) {
      console.error(`[ERROR] ${message}`, error ?? '');
    }
  }

  // OAuth-specific logging methods (aliases for consistency with main logger)
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
