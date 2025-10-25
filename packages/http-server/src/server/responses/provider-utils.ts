/**
 * Shared utilities for checking OAuth and LLM provider configuration
 *
 * These functions are used by both Express routes and Vercel serverless functions
 * to maintain consistent provider detection logic across all deployment modes.
 */

/**
 * Session statistics interface used across health and admin responses
 */
export interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  expiredSessions: number;
}

/**
 * Check if OAuth credentials are configured for a specific provider
 *
 * @param provider - The OAuth provider to check ('google', 'github', 'microsoft', 'generic')
 * @returns True if the provider has required credentials configured
 */
export function checkOAuthCredentials(provider: string): boolean {
  switch (provider) {
    case 'google':
      return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    case 'github':
      return !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    case 'microsoft':
      return !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
    case 'generic':
      return !!(
        process.env.OAUTH_CLIENT_ID &&
        process.env.OAUTH_CLIENT_SECRET &&
        process.env.OAUTH_AUTHORIZATION_URL &&
        process.env.OAUTH_TOKEN_URL &&
        process.env.OAUTH_USER_INFO_URL
      );
    default:
      return false;
  }
}

/**
 * Get list of all configured OAuth providers
 *
 * @returns Array of provider names that have valid credentials configured
 */
export function getConfiguredOAuthProviders(): string[] {
  const providers: string[] = [];

  if (checkOAuthCredentials('google')) {
    providers.push('google');
  }
  if (checkOAuthCredentials('github')) {
    providers.push('github');
  }
  if (checkOAuthCredentials('microsoft')) {
    providers.push('microsoft');
  }
  if (checkOAuthCredentials('generic')) {
    providers.push('generic');
  }

  return providers;
}

/**
 * Check which LLM providers have API keys configured
 *
 * @returns Array of LLM provider names ('claude', 'openai', 'gemini')
 */
export function getConfiguredLLMProviders(): string[] {
  const providers: string[] = [];

  if (process.env.ANTHROPIC_API_KEY) {
    providers.push('claude');
  }
  if (process.env.OPENAI_API_KEY) {
    providers.push('openai');
  }
  if (process.env.GOOGLE_API_KEY) {
    providers.push('gemini');
  }

  return providers;
}
