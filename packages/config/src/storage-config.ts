/**
 * Storage/persistence configuration schema
 * Backend selection for storage layers
 */

import { z } from 'zod';

/**
 * Storage configuration schema
 */
export const StorageConfigSchema = z.object({
  // Redis connection
  REDIS_URL: z.string().url().optional(),

  // Redis key prefix for multi-app isolation (default: '' for backward compatibility)
  // Example: 'mcp-main:' or 'mcp-canary:' to run multiple apps on same Redis instance
  REDIS_KEY_PREFIX: z.string().optional().default(''),

  // Explicit storage type selection (optional - auto-detect if not set)
  STORAGE_TYPE: z.enum(['memory', 'file', 'redis']).optional(),

  // Storage-specific overrides
  SESSION_STORE_TYPE: z.enum(['memory', 'file', 'redis']).optional(),
  TOKEN_STORE_TYPE: z.enum(['memory', 'file', 'redis']).optional(),
  CLIENT_STORE_TYPE: z.enum(['memory', 'file', 'redis']).optional(),
  PKCE_STORE_TYPE: z.enum(['memory', 'redis']).optional(),
  MCP_METADATA_STORE_TYPE: z.enum(['memory', 'file', 'redis']).optional(),
});

export type StorageConfig = z.infer<typeof StorageConfigSchema>;
