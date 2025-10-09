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

let mockOAuthServer: OAuth2Server | null = null;

/**
 * Global setup - runs before all tests
 */
export default async function globalSetup(_config: FullConfig) {
  console.log('\n🔧 Running Playwright global setup...\n');

  // Check if mock OAuth port is available
  const isPortAvailable = await checkPortAvailable(MOCK_OAUTH_PORT);
  if (!isPortAvailable) {
    console.error(`❌ Port ${MOCK_OAUTH_PORT} is already in use`);
    console.error(`   Kill the process using this port and try again`);
    throw new Error(`Port ${MOCK_OAUTH_PORT} is not available`);
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

/**
 * Check if a port is available
 */
async function checkPortAvailable(port: number): Promise<boolean> {
  const { createServer } = await import('net');

  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port);
  });
}
