/**
 * Simple logger for tools-llm package
 * No dependencies - uses console methods directly
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class SimpleLogger {
  private logLevel: LogLevel;

  constructor() {
    const envLevel = process.env.LOG_LEVEL?.toLowerCase();
    this.logLevel = (envLevel === 'debug' || envLevel === 'info' || envLevel === 'warn' || envLevel === 'error')
      ? envLevel
      : 'info';
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog('debug')) {
      console.debug(`[llm:debug] ${message}`, data ? JSON.stringify(data) : '');
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog('info')) {
      console.info(`[llm:info] ${message}`, data ? JSON.stringify(data) : '');
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog('warn')) {
      console.warn(`[llm:warn] ${message}`, data ? JSON.stringify(data) : '');
    }
  }

  error(message: string, error?: Error | unknown): void {
    if (this.shouldLog('error')) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[llm:error] ${message}`, errorMessage);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }
}

export const logger = new SimpleLogger();
