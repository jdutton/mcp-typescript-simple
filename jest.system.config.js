export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
    }],
  },
  testEnvironment: 'node',
  testMatch: [
    '**/test/system/**/*.test.ts'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts'
  ],
  // System tests may take longer than unit tests
  testTimeout: 30000,
  // System tests should run sequentially to avoid conflicts
  maxConcurrency: 1,
  // Separate coverage reporting for system tests
  coverageDirectory: 'coverage/system',
  // Global setup and teardown for HTTP server management
  globalSetup: '<rootDir>/test/system/jest-global-setup.ts',
  globalTeardown: '<rootDir>/test/system/jest-global-teardown.ts',
  // System test specific setup (test utilities only, no server management)
  setupFilesAfterEnv: ['<rootDir>/test/system/setup.ts'],
  // Clear mocks between tests to ensure clean state
  clearMocks: true,
  // Restore mocks after each test
  restoreMocks: true
};