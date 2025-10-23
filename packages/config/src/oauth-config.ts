/**
 * OAuth configuration schema
 * Multi-provider OAuth 2.0 settings
 */

import { z } from 'zod';

/**
 * OAuth configuration schema (non-secret redirect URIs and settings)
 */
export const OAuthConfigSchema = z.object({
  // Google OAuth
  GOOGLE_REDIRECT_URI: z.string().url().optional(),

  // GitHub OAuth
  GITHUB_REDIRECT_URI: z.string().url().optional(),

  // Microsoft OAuth
  MICROSOFT_REDIRECT_URI: z.string().url().optional(),
  MICROSOFT_TENANT_ID: z.string().optional(),

  // Generic OAuth
  OAUTH_REDIRECT_URI: z.string().url().optional(),
  OAUTH_AUTHORIZATION_URL: z.string().url().optional(),
  OAUTH_TOKEN_URL: z.string().url().optional(),
  OAUTH_USER_INFO_URL: z.string().url().optional(),
  OAUTH_REVOCATION_URL: z.string().url().optional(),
  OAUTH_PROVIDER_NAME: z.string().optional(),
  OAUTH_SCOPES: z.string().optional(),
});

export type OAuthConfig = z.infer<typeof OAuthConfigSchema>;

/**
 * OAuth secrets schema (client IDs and secrets)
 */
export const OAuthSecretsSchema = z.object({
  // Google OAuth secrets
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // GitHub OAuth secrets
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  // Microsoft OAuth secrets
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),

  // Generic OAuth secrets
  OAUTH_CLIENT_ID: z.string().optional(),
  OAUTH_CLIENT_SECRET: z.string().optional(),
});

export type OAuthSecrets = z.infer<typeof OAuthSecretsSchema>;
