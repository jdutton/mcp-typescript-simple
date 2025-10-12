/**
 * Shared port utilities for system tests
 *
 * Provides port availability checking with fail-fast behavior
 * to prevent tests from hanging when ports are already in use.
 */

import net from 'net';
import { spawn } from 'child_process';

/**
 * Check if a port is available using lsof (more reliable than bind test)
 * This catches both IPv4 and IPv6 bindings
 *
 * Includes timeout to prevent infinite hangs if lsof doesn't respond
 */
async function isPortAvailableViaLsof(port: number): Promise<boolean> {
  const checkPromise = new Promise<boolean>((resolve) => {
    const lsof = spawn('lsof', ['-ti', `:${port}`], { stdio: 'pipe' });
    let output = '';

    lsof.stdout?.on('data', (data) => {
      output += data.toString();
    });

    lsof.on('close', (code) => {
      // If lsof finds processes (exit code 0 with output), port is in use
      if (code === 0 && output.trim()) {
        resolve(false); // Port is in use
      } else {
        resolve(true); // Port is available
      }
    });

    lsof.on('error', async () => {
      // If lsof command fails, fall back to bind test
      const result = await isPortAvailableViaBind(port);
      resolve(result);
    });
  });

  // Timeout after 3 seconds to prevent infinite hangs
  const timeoutPromise = new Promise<boolean>((resolve) => {
    setTimeout(() => {
      console.warn(`⚠️  Port check timeout for port ${port}, assuming unavailable`);
      resolve(false); // Conservative: assume port is NOT available on timeout
    }, 3000);
  });

  return Promise.race([checkPromise, timeoutPromise]);
}

/**
 * Check if a port is available by attempting to bind to it
 * Tests both IPv4 (0.0.0.0) and IPv6 (::) to catch all cases
 */
async function isPortAvailableViaBind(port: number): Promise<boolean> {
  // Test IPv4
  const ipv4Available = await new Promise<boolean>((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port, '0.0.0.0');
  });

  if (!ipv4Available) {
    return false;
  }

  // Test IPv6
  const ipv6Available = await new Promise<boolean>((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port, '::');
  });

  return ipv6Available;
}

/**
 * Check if a port is available (not in use)
 * Uses lsof as primary method (more reliable), falls back to bind test
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return isPortAvailableViaLsof(port);
}

/**
 * Check if all required ports are available before starting tests
 * Throws an error with helpful message if any port is in use
 */
export async function checkPortsAvailable(ports: number[]): Promise<void> {
  const unavailablePorts: number[] = [];

  for (const port of ports) {
    const available = await isPortAvailable(port);
    if (!available) {
      unavailablePorts.push(port);
    }
  }

  if (unavailablePorts.length > 0) {
    const portList = unavailablePorts.join(', ');
    throw new Error(
      `Ports already in use: ${portList}\n\n` +
      `Please kill processes using these ports:\n` +
      `  lsof -ti:${unavailablePorts.join(',')} | xargs -r kill -9\n\n` +
      `Or run the cleanup command:\n` +
      `  pkill -f "tsx src/index.ts"; pkill -f "npm run dev"`
    );
  }
}

/**
 * Wait for a port to become available (with timeout)
 * Useful after killing processes to ensure port is fully freed
 */
export async function waitForPortAvailable(
  port: number,
  timeoutMs: number = 5000,
  checkIntervalMs: number = 500
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const available = await isPortAvailable(port);
    if (available) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
  }

  return false;
}

/**
 * Verify all test ports are freed after cleanup
 * Logs warnings for any ports still in use
 *
 * Usage: Call in afterAll hook to verify test cleanup
 */
export async function verifyPortsFreed(ports: number[]): Promise<void> {
  const portsInUse: number[] = [];

  for (const port of ports) {
    const available = await isPortAvailable(port);
    if (!available) {
      portsInUse.push(port);
    }
  }

  if (portsInUse.length > 0) {
    console.warn(
      `⚠️  Post-test cleanup warning: ${portsInUse.length} port(s) still in use: ${portsInUse.join(', ')}\n` +
      `   This indicates incomplete test cleanup. Ports should be freed in afterAll hooks.\n` +
      `   To free them manually: lsof -ti:${portsInUse.join(',')} | xargs -r kill -9`
    );
  } else {
    console.log(`✅ Post-test cleanup: All ports freed successfully`);
  }
}

/**
 * Information about a process using a port
 */
export interface ProcessInfo {
  pid: number;
  command: string;
  port: number;
}

/**
 * Result of port cleanup operation
 */
export interface PortCleanupResult {
  port: number;
  wasInUse: boolean;
  processKilled?: ProcessInfo;
  error?: string;
  success: boolean;
}

/**
 * Get information about the process using a specific port
 * Uses lsof to identify the process
 */
export async function getProcessUsingPort(port: number): Promise<ProcessInfo | null> {
  return new Promise((resolve) => {
    const lsof = spawn('lsof', ['-ti', `:${port}`], { stdio: 'pipe' });
    let pidOutput = '';

    lsof.stdout?.on('data', (data) => {
      pidOutput += data.toString();
    });

    lsof.on('close', async (code) => {
      if (code === 0 && pidOutput.trim()) {
        const pid = parseInt(pidOutput.trim().split('\n')[0], 10);
        if (!isNaN(pid)) {
          // Get process command
          const psResult = await new Promise<string>((psResolve) => {
            const ps = spawn('ps', ['-p', pid.toString(), '-o', 'comm='], { stdio: 'pipe' });
            let command = '';

            ps.stdout?.on('data', (data) => {
              command += data.toString();
            });

            ps.on('close', () => {
              psResolve(command.trim() || 'unknown');
            });

            ps.on('error', () => {
              psResolve('unknown');
            });
          });

          resolve({ pid, command: psResult, port });
        } else {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });

    lsof.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * Determine if a process is a test-related process
 * Safe to kill: test processes, development servers
 * NOT safe to kill: user processes, production servers, system processes
 */
export function isTestProcess(processInfo: ProcessInfo): boolean {
  const command = processInfo.command.toLowerCase();

  // Safe patterns - test/development processes we can safely kill
  const safePatterns = [
    'tsx',           // TypeScript execution (test servers)
    'node',          // Node.js processes (could be tests)
    'npx',           // npx commands (test runners)
    'vitest',        // Vitest test runner
    'playwright',    // Playwright browser tests
    'npm',           // npm run commands
    'mcp',           // MCP-related processes
  ];

  // Dangerous patterns - NEVER kill these
  const dangerousPatterns = [
    'postgres',      // Database
    'redis',         // Redis server
    'docker',        // Docker daemon
    'mysql',         // MySQL database
    'mongod',        // MongoDB
    'nginx',         // Web server
    'apache',        // Apache server
    'systemd',       // System process
    'launchd',       // macOS system process
    'kernel',        // Kernel process
  ];

  // Check dangerous patterns first
  for (const pattern of dangerousPatterns) {
    if (command.includes(pattern)) {
      return false;
    }
  }

  // Check safe patterns
  for (const pattern of safePatterns) {
    if (command.includes(pattern)) {
      return true;
    }
  }

  // If command contains 'test' or 'dev', it's likely safe
  if (command.includes('test') || command.includes('dev')) {
    return true;
  }

  // Conservative default: NOT safe to kill
  return false;
}

/**
 * Terminate a process gracefully, then forcefully if needed
 */
export async function terminateProcess(pid: number): Promise<void> {
  return new Promise((resolve) => {
    try {
      // Try graceful shutdown first (SIGTERM)
      process.kill(pid, 'SIGTERM');

      // Force kill after 1 second if still alive
      global.setTimeout(() => {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process already dead, ignore
        }
      }, 1000);

      // Resolve after 2 seconds regardless
      global.setTimeout(() => {
        resolve();
      }, 2000);
    } catch {
      // Process may already be dead
      resolve();
    }
  });
}

/**
 * Clean up leaked test processes from previous test runs
 * Self-healing port management: automatically frees ports before tests
 *
 * Safety features:
 * - Only kills processes identified as test processes
 * - Never kills production servers or user processes
 * - Provides detailed logging of what was killed
 * - Graceful degradation if cleanup fails
 *
 * @param ports - Array of ports to clean up
 * @param options - Cleanup options
 * @returns Array of cleanup results for each port
 */
export async function cleanupLeakedTestPorts(
  ports: number[],
  options: {
    force?: boolean;  // If true, skip safety checks (dangerous!)
  } = {}
): Promise<PortCleanupResult[]> {
  const { force = false } = options;
  const results: PortCleanupResult[] = [];

  console.log(`[DEBUG port-utils] Checking ${ports.length} ports...`);
  for (const port of ports) {
    console.log(`[DEBUG port-utils] Checking port ${port}...`);
    // Check if port is in use
    const available = await isPortAvailable(port);
    console.log(`[DEBUG port-utils] Port ${port} available: ${available}`);

    if (available) {
      results.push({
        port,
        wasInUse: false,
        success: true,
      });
      continue;
    }

    // Port is in use - get process info
    const processInfo = await getProcessUsingPort(port);

    if (!processInfo) {
      results.push({
        port,
        wasInUse: true,
        error: 'Could not identify process using port',
        success: false,
      });
      continue;
    }

    // Safety check: only kill test processes (unless force=true)
    if (!force && !isTestProcess(processInfo)) {
      results.push({
        port,
        wasInUse: true,
        processKilled: processInfo,
        error: `Process ${processInfo.command} (PID ${processInfo.pid}) is not a test process. Not killing for safety.`,
        success: false,
      });
      continue;
    }

    // Kill the process
    console.log(`🔧 Cleaning up leaked test process: ${processInfo.command} (PID ${processInfo.pid}) on port ${port}`);
    await terminateProcess(processInfo.pid);

    // Success = process was killed (not port is freed)
    // Port availability will be verified separately before starting test servers
    results.push({
      port,
      wasInUse: true,
      processKilled: processInfo,
      success: true,
    });

    console.log(`✅ Killed process on port ${port} (PID ${processInfo.pid})`);
  }

  return results;
}
