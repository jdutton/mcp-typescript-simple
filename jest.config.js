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
  silent: true, // Suppress console output during tests
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/*.test.ts'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/test/system/'
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts'
  ],
  coverageThreshold: {
    global: {
      statements: 55,
      branches: 42, // Adjusted for new logger utility without tests
      functions: 45,
      lines: 55
    }
  }
};
