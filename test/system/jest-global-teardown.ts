/**
 * Jest global teardown - runs once after all tests complete
 * Manages HTTP server cleanup for all system tests
 */

// Inline utility functions to avoid module resolution issues in Jest global teardown
interface TestEnvironment {
  name: string;
  baseUrl: string;
  description: string;
}

const TEST_ENVIRONMENTS: Record<string, TestEnvironment> = {
  express: {
    name: 'express',
    baseUrl: 'http://localhost:3000',
    description: 'Express HTTP server (npm run dev:http)'
  },
  'express:ci': {
    name: 'express:ci',
    baseUrl: `http://localhost:${process.env.HTTP_TEST_PORT || '3001'}`,
    description: 'Express HTTP server for CI testing (npm run dev:http:ci)'
  },
  stdio: {
    name: 'stdio',
    baseUrl: 'stdio://localhost',
    description: 'STDIO transport mode (npm run dev:stdio)'
  },
  'vercel:local': {
    name: 'vercel:local',
    baseUrl: 'http://localhost:3000',
    description: 'Local Vercel dev server (npm run dev:vercel)'
  },
  'vercel:preview': {
    name: 'vercel:preview',
    baseUrl: process.env.VERCEL_PREVIEW_URL || 'https://mcp-typescript-simple-preview.vercel.app',
    description: 'Vercel preview deployment'
  },
  'vercel:production': {
    name: 'vercel:production',
    baseUrl: process.env.VERCEL_PRODUCTION_URL || 'https://mcp-typescript-simple.vercel.app',
    description: 'Vercel production deployment'
  },
  docker: {
    name: 'docker',
    baseUrl: 'http://localhost:3000',
    description: 'Docker container (docker run with exposed port)'
  }
};

function getCurrentEnvironment(): TestEnvironment {
  const envName = process.env.TEST_ENV || 'vercel:local';
  const environment = TEST_ENVIRONMENTS[envName];

  if (!environment) {
    throw new Error(`Unknown test environment: ${envName}. Available: ${Object.keys(TEST_ENVIRONMENTS).join(', ')}`);
  }

  // Allow override of base URL for testing (useful for Docker with different port)
  if (process.env.TEST_BASE_URL) {
    return {
      ...environment,
      baseUrl: process.env.TEST_BASE_URL
    };
  }

  return environment;
}

function isSTDIOEnvironment(environment: TestEnvironment): boolean {
  return environment.name === 'stdio';
}

export default async function globalTeardown(): Promise<void> {
  const environment = getCurrentEnvironment();

  // Only cleanup HTTP server for express:ci environment
  if (environment.name === 'express:ci' && !isSTDIOEnvironment(environment)) {
    const serverPid = (global as any).__HTTP_SERVER_PID__;

    if (serverPid) {
      console.log(`🛑 Jest Global Teardown: Stopping HTTP server (PID: ${serverPid})...`);

      try {
        // Try graceful shutdown first
        process.kill(serverPid, 'SIGTERM');

        // Wait a moment for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check if process still exists
        try {
          process.kill(serverPid, 0); // Check if process exists
          // If we reach here, process still exists, force kill
          console.log('⚠️  Jest Global Teardown: Force killing HTTP server...');
          process.kill(serverPid, 'SIGKILL');
        } catch {
          // Process already dead, that's fine
        }

        console.log('✅ Jest Global Teardown: HTTP server stopped');

        // Also cleanup any remaining tsx processes
        const { spawn } = await import('child_process');
        spawn('pkill', ['-f', 'tsx src/index.ts'], { stdio: 'ignore' });

      } catch (error) {
        console.error(`⚠️  Jest Global Teardown: Error stopping server: ${(error as Error).message}`);
        // Try to kill any remaining processes on port 3001
        const { spawn } = await import('child_process');
        spawn('pkill', ['-f', 'tsx src/index.ts'], { stdio: 'ignore' });
      }
    } else {
      console.log('📋 Jest Global Teardown: No server PID found, skipping cleanup');
    }

    // Clean up global state
    delete (global as any).__HTTP_SERVER_PID__;

  } else {
    console.log(`📋 Jest Global Teardown: Skipping server cleanup for environment: ${environment.name}`);
  }
}