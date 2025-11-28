/**
 * Vitest global setup - runs once per Vitest execution
 * Manages HTTP server startup for all system tests
 */

import { spawn, ChildProcess } from 'node:child_process';


/* eslint-disable sonarjs/no-ignored-exceptions */
let globalHttpServer: ChildProcess | null = null;

/**
 * Filter and conditionally log server output
 * Only shows fatal errors to reduce noise during tests
 * Set SYSTEM_TEST_VERBOSE=true to see all server output
 */
function filterAndLogServerOutput(text: string, isStderr: boolean = false): void {
  // Suppress all server logs (only show fatal startup errors)
  // Only log fatal errors that would prevent startup
  if (text.includes('FATAL') || text.includes('Cannot start server')) {
    console.error('[Server FATAL]:', text);
    return;
  }

  // Verbose mode: show all output
  if (process.env.SYSTEM_TEST_VERBOSE === 'true') {
    if (isStderr) {
      console.error('[Server stderr]:', text);
    } else {
      console.log('[Server stdout]:', text);
    }
    return;
  }

  // Quiet mode: only show errors and warnings
  const lines = text.split('\n').filter(line => line.trim());

  for (const line of lines) {
    // Try to parse as JSON (structured logs from pino/winston)
    try {
      const log = JSON.parse(line);
      // Only show error and warn levels (pino levels: 50=error, 40=warn)
      if (log.level === 'error' || log.level === 'warn' || log.level === 50 || log.level === 40) {
        console.error(`[Server ${log.level}]:`, log.msg || line);
      }
    } catch {
      // Not JSON - check for error keywords in plain text
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes('error') || lowerLine.includes('fail') ||
          lowerLine.includes('exception') || lowerLine.includes('warn')) {
        if (isStderr) {
          console.error('[Server stderr]:', line);
        } else {
          console.log('[Server]:', line);
        }
      }
      // Otherwise, silently collect in buffer (already being done)
    }
  }
}

// Inline utility functions to avoid module resolution issues in Vitest global setup
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

export default async function globalSetup(): Promise<void> {
  const environment = getCurrentEnvironment();

  // Only start HTTP server for express:ci environment
  if (environment.name === 'express:ci' && !isSTDIOEnvironment(environment)) {
    // Use HTTP_TEST_PORT if set (for parallel testing), otherwise default to 3001
    const httpPort = process.env.HTTP_TEST_PORT || '3001';
    console.log(`🚀 Vitest Global Setup: Starting HTTP server for system tests on port ${httpPort}...`);

    // Kill any existing processes on the target port first
    await killProcessOnPort(parseInt(httpPort));

    // Wait for port cleanup
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Start the server process (suppress output to reduce test verbosity)
    globalHttpServer = spawn('npx', ['tsx', 'packages/example-mcp/src/index.ts'], {
      stdio: ['ignore', 'pipe', 'pipe'], // ignore stdin, capture stdout/stderr for readiness detection
      env: {
        ...process.env,
        NODE_ENV: 'test',  // Use test environment to enable InMemoryTestTokenStore (no encryption needed)
        MCP_MODE: 'streamable_http',
        MCP_DEV_SKIP_AUTH: 'true',
        HTTP_PORT: httpPort,
        HTTP_HOST: 'localhost',
        LOG_LEVEL: 'info',  // Need info level to see "server listening" message for readiness detection
        TOKEN_ENCRYPTION_KEY: 'Wp3suOcV+cleewUEOGUkE7JNgsnzwmiBMNqF7q9sQSI='  // Required for encryption infrastructure (even though test mode uses InMemoryTestTokenStore)
      }
    });

    if (!globalHttpServer) {
      throw new Error('Failed to start HTTP server process in global setup');
    }

    // Wait for server to be ready using health check polling (more reliable than log parsing)
    await new Promise<void>((resolve, reject) => {
      let startupOutput = '';
      let errorOutput = '';
      let healthCheckAttempts = 0;
      const maxHealthCheckAttempts = 30; // 30 attempts * 1 second = 30 seconds max
      let healthCheckInterval: NodeJS.Timeout;

      // Collect server output for debugging
      globalHttpServer!.stdout?.on('data', (data) => {
        const text = data.toString();
        startupOutput += text;
        filterAndLogServerOutput(text, false);
      });

      globalHttpServer!.stderr?.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        filterAndLogServerOutput(text, true);
      });

      globalHttpServer!.on('error', (error) => {
        clearInterval(healthCheckInterval);
        reject(new Error(`Global HTTP server process error: ${error.message}`));
      });

      globalHttpServer!.on('exit', (code, signal) => {
        if (code !== null && code !== 0) {
          clearInterval(healthCheckInterval);
          console.error('Global server output:', startupOutput);
          console.error('Global server errors:', errorOutput);
          reject(new Error(`Global HTTP server exited with code ${code}, signal ${signal}`));
        }
      });

      // Poll health endpoint to detect when server is ready
      const checkHealth = async () => {
        healthCheckAttempts++;

        try {
          const response = await fetch(`http://localhost:${httpPort}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(2000) // 2 second timeout per request
          });

          if (response.ok) {
            clearInterval(healthCheckInterval);
            console.log(`✅ Vitest Global Setup: HTTP server ready on port ${httpPort} (health check passed after ${healthCheckAttempts} attempts)`);
            resolve();
          }
        } catch (_error) {
          // Health check failed - server not ready yet, will retry
          // Only fail after max attempts to allow server startup time
          if (healthCheckAttempts >= maxHealthCheckAttempts) {
            clearInterval(healthCheckInterval);
            console.error('Global server output:', startupOutput);
            console.error('Global server errors:', errorOutput);
            reject(new Error(`Global HTTP server health check failed after ${healthCheckAttempts} attempts (${maxHealthCheckAttempts} seconds)`));
          }
        }
      };

      // Start health check polling (every 1 second)
      healthCheckInterval = setInterval(checkHealth, 1000);

      // Run first check immediately
      checkHealth();
    });

    // Store server process info for teardown
    (global as any).__HTTP_SERVER_PID__ = globalHttpServer.pid;
    console.log(`📋 Vitest Global Setup: Stored server PID ${globalHttpServer.pid}`);

  } else {
    console.log(`📋 Vitest Global Setup: Skipping server startup for environment: ${environment.name}`);
  }
}

/**
 * Kill any existing processes on the specified port
 */
async function killProcessOnPort(port: number): Promise<void> {
  console.log(`🔍 Vitest Global Setup: Checking for processes on port ${port}...`);

  return new Promise((resolve) => {
    const lsof = spawn('lsof', ['-ti', `:${port}`], { stdio: 'pipe' });
    let output = '';

    lsof.stdout?.on('data', (data) => {
      output += data.toString();
    });

    lsof.on('close', (code) => {
      if (code === 0 && output.trim()) {
        const pids = output.trim().split('\n').filter(pid => pid.trim());
        if (pids.length > 0) {
          console.log(`🛑 Vitest Global Setup: Found ${pids.length} processes on port ${port}, killing: ${pids.join(', ')}`);

          // Kill all processes with SIGKILL
          pids.forEach(pid => {
            try {
              const pidNum = parseInt(pid.trim());
              process.kill(pidNum, 'SIGKILL');
              console.log(`⚡ Vitest Global Setup: Killed process ${pidNum}`);
            } catch (e) {
              console.log(`⚠️  Vitest Global Setup: Failed to kill process ${pid}: ${(e as Error).message}`);
            }
          });

          // Also kill any tsx processes just to be sure
          spawn('pkill', ['-9', '-f', 'tsx src/index.ts'], { stdio: 'ignore' });

          // Wait for port to be fully freed
          console.log(`⏳ Vitest Global Setup: Waiting for port ${port} to be freed...`);
          setTimeout(() => {
            console.log(`✅ Vitest Global Setup: Port ${port} cleanup complete`);
            resolve();
          }, 3000);
        } else {
          console.log(`✅ Vitest Global Setup: No processes found on port ${port}`);
          resolve();
        }
      } else {
        console.log(`✅ Vitest Global Setup: Port ${port} is clear (lsof exit code: ${code})`);
        resolve();
      }
    });

    lsof.on('error', (error) => {
      console.log(`⚠️  Vitest Global Setup: lsof command failed: ${error.message}, continuing...`);
      resolve();
    });
  });
}