/**
 * Playwright Global Teardown
 *
 * Runs once after all tests to clean up the mock OAuth server
 * and any other global test infrastructure.
 */

import { FullConfig } from '@playwright/test';
import { OAuth2Server } from 'oauth2-mock-server';
import { stopMockOAuthServer } from '@mcp-typescript-simple/testing/mock-oauth-server';

/**
 * Global teardown - runs after all tests
 */
export default async function globalTeardown(_config: FullConfig) {
  console.log('\n🧹 Running Playwright global teardown...\n');

  try {
    // Retrieve mock OAuth server instance from global setup
    const mockOAuthServer = (global as any).__MOCK_OAUTH_SERVER__ as OAuth2Server | null;

    if (mockOAuthServer) {
      await stopMockOAuthServer(mockOAuthServer);
      delete (global as any).__MOCK_OAUTH_SERVER__;
    }

    console.log('\n✅ Global teardown complete\n');
  } catch (error) {
    console.error('❌ Global teardown failed:', error);
    // Don't throw - allow tests to complete even if cleanup fails
  }
}
