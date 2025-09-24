/**
 * Global setup for system tests
 */

import { jest } from '@jest/globals';

// Increase timeout for system tests
jest.setTimeout(30000);

// Global setup for all system tests
beforeAll(() => {
  console.log('🚀 Starting system test suite...');
});

afterAll(() => {
  console.log('✅ System test suite completed');
});