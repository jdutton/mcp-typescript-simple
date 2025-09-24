#!/usr/bin/env npx tsx
/**
 * Parallel System Tests Runner
 *
 * Runs both Express HTTP and STDIO system tests in parallel for faster validation.
 * This is safe because:
 * - STDIO tests spawn their own server processes
 * - Express tests connect to external servers (configurable port)
 * - Tests don't share resources or state
 *
 * Usage:
 *   npx tsx tools/parallel-system-tests.ts          # Uses default port 3001
 *   npx tsx tools/parallel-system-tests.ts --port=3002  # Uses custom port
 */

import { spawn } from 'child_process';
import { promisify } from 'util';

interface TestResult {
  name: string;
  success: boolean;
  output: string;
  duration: number;
}

async function runCommand(command: string, args: string[], cwd: string = process.cwd(), extraEnv: Record<string, string> = {}): Promise<TestResult> {
  const startTime = Date.now();
  const testName = `${command} ${args.join(' ')}`;

  return new Promise((resolve) => {
    console.log(`🚀 Starting: ${testName}`);

    // Ensure clean environment isolation for parallel execution
    const cleanEnv = { ...process.env };
    // Remove any existing TEST_ENV and HTTP_TEST_PORT to prevent conflicts
    delete cleanEnv.TEST_ENV;
    delete cleanEnv.HTTP_TEST_PORT;

    const child = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...cleanEnv, ...extraEnv }
    });

    let output = '';
    let errorOutput = '';

    child.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;
      // Stream live output with prefix
      process.stdout.write(text.split('\n').map(line =>
        line.trim() ? `[${testName.split(' ')[1]}] ${line}` : line
      ).join('\n'));
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      errorOutput += text;
      // Stream live error output with prefix
      process.stderr.write(text.split('\n').map(line =>
        line.trim() ? `[${testName.split(' ')[1]}] ${line}` : line
      ).join('\n'));
    });

    child.on('close', (code) => {
      const duration = Date.now() - startTime;
      const success = code === 0;

      resolve({
        name: testName,
        success,
        output: output + errorOutput,
        duration
      });

      const status = success ? '✅' : '❌';
      const durationStr = `${(duration / 1000).toFixed(1)}s`;
      console.log(`${status} Completed: ${testName} (${durationStr})`);
    });

    child.on('error', (error) => {
      const duration = Date.now() - startTime;
      resolve({
        name: testName,
        success: false,
        output: `Process error: ${error.message}`,
        duration
      });
      console.log(`❌ Error: ${testName} - ${error.message}`);
    });
  });
}

async function killProcessOnPort(port: number): Promise<void> {
  return new Promise((resolve) => {
    const lsof = spawn('lsof', ['-ti', `:${port}`], { stdio: 'pipe' });
    let output = '';

    lsof.stdout?.on('data', (data) => {
      output += data.toString();
    });

    lsof.on('close', (code) => {
      if (code === 0 && output.trim()) {
        const pids = output.trim().split('\n').filter(pid => pid);
        if (pids.length > 0) {
          console.log(`🛑 Killing existing processes on port ${port}: ${pids.join(', ')}`);

          // Kill all processes
          pids.forEach(pid => {
            try {
              process.kill(parseInt(pid), 'SIGTERM');
            } catch (e) {
              // Process might already be dead, ignore
            }
          });

          // Wait a moment for graceful shutdown
          setTimeout(() => {
            // Force kill if still running
            pids.forEach(pid => {
              try {
                process.kill(parseInt(pid), 'SIGKILL');
              } catch (e) {
                // Process might already be dead, ignore
              }
            });
            resolve();
          }, 1000);
        } else {
          resolve();
        }
      } else {
        // No processes found on port
        resolve();
      }
    });

    lsof.on('error', () => {
      // lsof not available or failed, continue anyway
      resolve();
    });
  });
}

async function startHttpServer(port: number = 3001): Promise<{ stop: () => void }> {
  console.log(`🚀 Starting HTTP server for Express tests on port ${port}...`);

  // Kill any existing processes on the specified port
  await killProcessOnPort(port);

  return new Promise((resolve, reject) => {
    const server = spawn('npm', ['run', 'dev:http:ci'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HTTP_PORT: port.toString() }
    });

    let isReady = false;
    const timeout = setTimeout(() => {
      if (!isReady) {
        server.kill();
        reject(new Error('HTTP server startup timeout'));
      }
    }, 15000);

    server.stdout?.on('data', (data) => {
      const output = data.toString();
      if (output.includes('server running') || output.includes('listening on') || output.includes('server listening on')) {
        if (!isReady) {
          isReady = true;
          clearTimeout(timeout);
          console.log('✅ HTTP server ready for testing');

          // Wait a bit more for full initialization
          setTimeout(() => {
            resolve({
              stop: () => {
                console.log('🛑 Stopping HTTP server...');
                server.kill('SIGTERM');
                setTimeout(() => {
                  if (!server.killed) {
                    server.kill('SIGKILL');
                  }
                }, 2000);
              }
            });
          }, 2000);
        }
      }
    });

    server.stderr?.on('data', (data) => {
      const output = data.toString();
      console.error(`[server] ${output.trim()}`);

      // Check stderr for server ready message too
      if (!isReady && (output.includes('server running') || output.includes('listening on') || output.includes('server listening on'))) {
        isReady = true;
        clearTimeout(timeout);
        console.log('✅ HTTP server ready for testing');

        // Wait a bit more for full initialization
        setTimeout(() => {
          resolve({
            stop: () => {
              console.log('🛑 Stopping HTTP server...');
              server.kill('SIGTERM');
              setTimeout(() => {
                if (!server.killed) {
                  server.kill('SIGKILL');
                }
              }, 2000);
            }
          });
        }, 2000);
      }
    });

    server.on('exit', (code) => {
      if (!isReady) {
        clearTimeout(timeout);
        reject(new Error(`HTTP server exited early with code ${code}`));
      }
    });
  });
}

async function runParallelSystemTests(httpPort?: number): Promise<boolean> {
  const port = httpPort ?? 3002;  // Use port 3002 by default for parallel testing to avoid conflicts
  console.log(`🏃‍♂️ Running system tests in parallel...\n`);
  console.log(`ℹ️  Each test suite manages its own server lifecycle via Jest global setup/teardown\n`);

  try {
    // Clean up any existing processes on the test port before starting
    console.log(`🧹 Pre-cleaning any existing processes on port ${port}...`);
    await killProcessOnPort(port);

    const startTime = Date.now();

    // Run both test suites in parallel
    // Note: test:system:ci now uses Jest global setup to manage its own HTTP server
    // Note: test:system:stdio uses individual STDIOTestClient instances for each test
    // IMPORTANT: Let npm scripts set their own TEST_ENV, only pass HTTP_TEST_PORT
    const testPromises = [
      runCommand('npm', ['run', 'test:system:ci'], process.cwd(), {
        HTTP_TEST_PORT: port.toString()
        // TEST_ENV is set by the npm script itself: "TEST_ENV=express:ci npm run test:system"
      }),    // Express HTTP tests (Jest manages server)
      runCommand('npm', ['run', 'test:system:stdio'], process.cwd(), {
        // TEST_ENV is set by the npm script itself: "TEST_ENV=stdio npm run test:system"
      })   // STDIO tests (individual STDIOTestClient instances)
    ];

    const results = await Promise.all(testPromises);
    const totalDuration = Date.now() - startTime;

    console.log('\n' + '='.repeat(80));
    console.log('PARALLEL SYSTEM TEST RESULTS');
    console.log('='.repeat(80));

    let allPassed = true;
    for (const result of results) {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      const duration = `${(result.duration / 1000).toFixed(1)}s`;
      console.log(`${status} ${result.name.padEnd(40)} ${duration}`);

      if (!result.success) {
        allPassed = false;
      }
    }

    console.log('-'.repeat(80));
    const totalTime = `${(totalDuration / 1000).toFixed(1)}s`;
    const sequentialTime = results.reduce((sum, r) => sum + r.duration, 0);
    const speedup = `${(sequentialTime / totalDuration).toFixed(1)}x`;

    console.log(`Total parallel time: ${totalTime} (${speedup} speedup)`);
    console.log(`Sequential time would be: ${(sequentialTime / 1000).toFixed(1)}s`);

    if (allPassed) {
      console.log('🎉 All system tests passed!');
      return true;
    } else {
      console.log('💥 Some system tests failed!');
      return false;
    }

  } catch (error) {
    console.error('❌ Parallel test execution failed:', error);
    return false;
  } finally {
    // Clean up any remaining processes on the test port
    // (Jest global teardown should handle this, but let's be thorough)
    console.log(`🧹 Final cleanup of any remaining processes on port ${port}...`);
    await killProcessOnPort(port);
  }
}

// Run the tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // Parse port from command line arguments (optional)
  const portArg = process.argv.find(arg => arg.startsWith('--port='));
  const httpPort = portArg ? parseInt(portArg.split('=')[1], 10) : undefined;

  if (httpPort && (httpPort < 1024 || httpPort > 65535)) {
    console.error('❌ Invalid port number. Must be between 1024 and 65535.');
    process.exit(1);
  }

  runParallelSystemTests(httpPort)
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { runParallelSystemTests };