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
 */
async function isPortAvailableViaLsof(port: number): Promise<boolean> {
  return new Promise((resolve) => {
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

    lsof.on('error', () => {
      // If lsof command fails, fall back to bind test
      resolve(isPortAvailableViaBind(port));
    });
  });
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
