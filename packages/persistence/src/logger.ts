/**
 * Logger interface for persistence package
 *
 * Allows optional logging injection from the consuming application.
 * If no logger is provided, operations are silent (no-op).
 */

export interface PersistenceLogger {
  info(message: string, meta?: Record<string, any>): void;
  warn(message: string, meta?: Record<string, any>): void;
  error(message: string, meta?: Record<string, any>): void;
  debug(message: string, meta?: Record<string, any>): void;
  // Optional OAuth-specific logging methods
  oauthDebug?(message: string, meta?: Record<string, any>): void;
  oauthWarn?(message: string, meta?: Record<string, any>): void;
  oauthError?(message: string, meta?: Record<string, any>): void;
}

/**
 * No-op logger implementation (default)
 */
class NoOpLogger implements PersistenceLogger {
  info(_message: string, _meta?: Record<string, any>): void {
    // No-op
  }

  warn(_message: string, _meta?: Record<string, any>): void {
    // No-op
  }

  error(_message: string, _meta?: Record<string, any>): void {
    // No-op
  }

  debug(_message: string, _meta?: Record<string, any>): void {
    // No-op
  }
}

/**
 * Global logger instance (defaults to no-op)
 */
let loggerInstance: PersistenceLogger = new NoOpLogger();

/**
 * Set the logger implementation
 *
 * @param logger - Logger implementation to use
 */
export function setLogger(logger: PersistenceLogger): void {
  loggerInstance = logger;
}

/**
 * Get the current logger instance
 */
export function getLogger(): PersistenceLogger {
  return loggerInstance;
}

/**
 * Exported logger object that delegates to the current logger instance
 */
export const logger: PersistenceLogger = {
  info: (message: string, meta?: Record<string, any>) => loggerInstance.info(message, meta),
  warn: (message: string, meta?: Record<string, any>) => loggerInstance.warn(message, meta),
  error: (message: string, meta?: Record<string, any>) => loggerInstance.error(message, meta),
  debug: (message: string, meta?: Record<string, any>) => loggerInstance.debug(message, meta),
};
