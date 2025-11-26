/**
 * Logger interface for persistence package
 *
 * Allows optional logging injection from the consuming application.
 * If no logger is provided, operations are silent (no-op).
 */

export interface PersistenceLogger {
  info(_message: string, _meta?: Record<string, unknown>): void;
  warn(_message: string, _meta?: Record<string, unknown>): void;
  error(_message: string, _meta?: Record<string, unknown>): void;
  debug(_message: string, _meta?: Record<string, unknown>): void;
  // Optional OAuth-specific logging methods
  oauthDebug?(_message: string, _meta?: Record<string, unknown>): void;
  oauthWarn?(_message: string, _meta?: Record<string, unknown>): void;
  oauthError?(_message: string, _meta?: Record<string, unknown>): void;
}

/**
 * No-op logger implementation (default)
 */
class NoOpLogger implements PersistenceLogger {
  info(_message: string, _meta?: Record<string, unknown>): void {
    // No-op
  }

  warn(_message: string, _meta?: Record<string, unknown>): void {
    // No-op
  }

  error(_message: string, _meta?: Record<string, unknown>): void {
    // No-op
  }

  debug(_message: string, _meta?: Record<string, unknown>): void {
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
  info: (message: string, meta?: Record<string, unknown>) => loggerInstance.info(message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => loggerInstance.warn(message, meta),
  error: (message: string, meta?: Record<string, unknown>) => loggerInstance.error(message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => loggerInstance.debug(message, meta),
};
