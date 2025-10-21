/**
 * Environment configuration wrapper
 * Re-exports from @mcp-typescript-simple/config with logger integration
 */

import { EnvironmentConfig as BaseEnvironmentConfig } from '@mcp-typescript-simple/config';
import { logger } from '../utils/logger.js';

// Re-export everything from the config package
export * from '@mcp-typescript-simple/config';

// Set logger for configuration logging
BaseEnvironmentConfig.setLogger({
  debug: (message, data) => logger.debug(message, data),
  info: (message, data) => logger.info(message, data),
  warn: (message, data) => logger.warn(message, data),
  error: (message, error) => logger.error(message, error)
});

// Re-export EnvironmentConfig with logger already configured
export { BaseEnvironmentConfig as EnvironmentConfig };
