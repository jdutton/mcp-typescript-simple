/**
 * Playwright Global Setup
 *
 * Runs once before all tests to set up the mock OAuth server
 * and any other global test infrastructure.
 */

import { FullConfig } from '@playwright/test';
import { OAuth2Server } from 'oauth2-mock-server';
import {
  createMockOAuthServer,
  startMockOAuthServer,
  MOCK_OAUTH_PORT
} from './helpers/mock-oauth-server.js';
import { checkPortsAvailable } from '../helpers/port-utils';

let mockOAuthServer: OAuth2Server | null = null;

/**
 * Global setup - runs before all tests
 */
export default async function globalSetup(_config: FullConfig) {
  console.log('\n🔧 Running Playwright global setup...\n');

  // Check if mock OAuth port is available (fail fast with helpful error)
  try {
    await checkPortsAvailable([MOCK_OAUTH_PORT]);
    console.log(`✅ Port ${MOCK_OAUTH_PORT} is available`);
  } catch (error) {
    console.error(`❌ Port ${MOCK_OAUTH_PORT} is already in use`);
    throw error;
  }

  try {
    // Create and start mock OAuth server
    mockOAuthServer = await createMockOAuthServer();
    await startMockOAuthServer(mockOAuthServer);

    // Store server instance for global teardown
    (global as any).__MOCK_OAUTH_SERVER__ = mockOAuthServer;

    console.log('\n✅ Global setup complete\n');
  } catch (error) {
    console.error('❌ Global setup failed:', error);
    throw error;
  }
}
