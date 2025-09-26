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
      statements: 70, // Increased from 55 to reflect 71.33% achieved
      branches: 55,   // Increased from 42 to reflect 57.53% achieved
      functions: 70,  // Increased from 45 to reflect 73.49% achieved
      lines: 70       // Increased from 55 to reflect 71.72% achieved
    }
  }
};
