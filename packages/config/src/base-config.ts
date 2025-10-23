/**
 * Base configuration schema for MCP server
 * Core settings for transport, HTTP, and security
 */

import { z } from 'zod';

export enum TransportMode {
  STDIO = 'stdio',
  STREAMABLE_HTTP = 'streamable_http'
}

/**
 * Base configuration schema (non-secret settings)
 */
export const BaseConfigSchema = z.object({
  // Transport configuration
  MCP_MODE: z.enum(['stdio', 'streamable_http']).default('stdio'),
  MCP_DEV_SKIP_AUTH: z.boolean().default(false),

  // HTTP server configuration
  HTTP_PORT: z.number().int().min(1).max(65535).default(3000),
  HTTP_HOST: z.string().default('localhost'),

  // Legacy client compatibility
  MCP_LEGACY_CLIENT_SUPPORT: z.boolean().default(true),

  // OAuth mock mode (for testing)
  OAUTH_MOCK_MODE: z.boolean().default(false),

  // Security configuration (non-secret)
  REQUIRE_HTTPS: z.boolean().default(false),
  ALLOWED_ORIGINS: z.string().optional(),
  ALLOWED_HOSTS: z.string().optional(),

  // Environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type BaseConfig = z.infer<typeof BaseConfigSchema>;

/**
 * Session secret schema (separate for security)
 */
export const SessionSecretSchema = z.object({
  SESSION_SECRET: z.string().default('dev-session-secret-change-in-production'),
});

export type SessionSecret = z.infer<typeof SessionSecretSchema>;
