/**
 * Production-safe logger with configurable log levels
 * Now delegates to observability logger for enhanced functionality
 */

import { logger as observabilityLogger } from '@mcp-typescript-simple/observability';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private static instance: Logger | null = null;

  constructor(logLevel?: LogLevel) {
    // Legacy constructor for backward compatibility
    // Note: logLevel parameter is ignored in favor of observability configuration
    if (logLevel) {
      console.debug(`Logger created with level ${logLevel} - now using observability configuration`);
    }
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  // Delegate all logging to the observability logger
  debug(message: string, data?: unknown): void {
    observabilityLogger.debug(message, data);
  }

  info(message: string, data?: unknown): void {
    observabilityLogger.info(message, data);
  }

  warn(message: string, data?: unknown): void {
    observabilityLogger.warn(message, data);
  }

  error(message: string, error?: Error | unknown): void {
    observabilityLogger.error(message, error);
  }

  // OAuth-specific logging methods (backward compatibility)
  oauthDebug(message: string, data?: unknown): void {
    observabilityLogger.oauthDebug(message, data);
  }

  oauthInfo(message: string, data?: unknown): void {
    observabilityLogger.oauthInfo(message, data);
  }

  oauthWarn(message: string, data?: unknown): void {
    observabilityLogger.oauthWarn(message, data);
  }

  oauthError(message: string, error?: Error | unknown): void {
    observabilityLogger.oauthError(message, error);
  }
}

// Export singleton instance
export const logger = Logger.getInstance();