/**
 * Test utilities setup for system tests
 * Server management is now handled by Jest global setup/teardown
 */

import { jest } from '@jest/globals';
import { getCurrentEnvironment, isSTDIOEnvironment, waitForServer, createHttpClient } from './utils.js';

// Increase timeout for system tests
jest.setTimeout(30000);

const environment = getCurrentEnvironment();

// Global setup for all system tests - utilities only, no server management
beforeAll(async () => {
  console.log('📋 System Test Utilities Setup: Initializing test environment...');

  // For HTTP environments, wait for server to be ready (started by global setup)
  if (environment.name === 'express:ci' && !isSTDIOEnvironment(environment)) {
    console.log('⏳ System Test Utilities: Waiting for HTTP server readiness...');

    const client = createHttpClient();
    const isReady = await waitForServer(client);

    if (!isReady) {
      throw new Error(`System Test Utilities: Server not ready at ${environment.baseUrl}`);
    }

    console.log('✅ System Test Utilities: HTTP server is ready');
  } else {
    console.log(`📋 System Test Utilities: Environment ${environment.name} does not require HTTP server`);
  }

  console.log('✅ System Test Utilities Setup: Test environment ready');
});

afterAll(async () => {
  console.log('✅ System Test Utilities: Test cleanup complete');
});