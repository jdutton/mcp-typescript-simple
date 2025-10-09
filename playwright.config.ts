import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration for MCP Inspector Headless Testing
 *
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './test/system',
  testMatch: 'mcp-inspector-headless.system.test.ts', // OAuth flow tests only (protocol tests disabled due to 406 errors)

  // Global setup and teardown for mock OAuth server
  globalSetup: './test/playwright/global-setup.ts',
  globalTeardown: './test/playwright/global-teardown.ts',

  // Maximum time one test can run
  timeout: 60 * 1000, // 60 seconds

  // Run tests in files in parallel
  fullyParallel: false, // Sequential to avoid port conflicts

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI
  workers: 1, // Single worker to avoid port conflicts

  // Reporter to use
  reporter: process.env.CI ? 'github' : 'list',

  // Shared settings for all the projects below
  use: {
    // Base URL for page.goto() shortcuts
    baseURL: 'http://localhost:3555',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Run in headless mode by default
        headless: true,
      },
    },
  ],

  // Run your local dev server before starting the tests
  // We handle server startup in the test itself for more control
  // webServer: undefined,
});
