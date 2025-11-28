#!/usr/bin/env npx tsx
/**
 * Signal Handling Demonstration
 *
 * This demo shows how centralized signal handling prevents port leaks
 * when tests are interrupted with CTRL-C.
 *
 * Instructions:
 * 1. Run this script: `npx tsx tools/demo-signal-handling.ts`
 * 2. Wait for servers to start
 * 3. Press CTRL-C to interrupt
 * 4. Watch the cleanup happen automatically
 * 5. Verify all ports are freed
 *
 * What to look for:
 * - Servers start on ports 3001, 3555, 4001
 * - CTRL-C triggers graceful cleanup
 * - All child processes receive SIGTERM
 * - Ports are freed automatically
 * - No leaked ports remain
 */

import { spawn, ChildProcess } from 'node:child_process';
import { registerProcess, registerCleanup, getSignalHandlerState } from '../test/helpers/signal-handler.js';
import { TEST_PORTS, getPortDescription } from '../test/helpers/port-registry.js';
import { isPortAvailable } from '../test/helpers/port-utils.js';

const TEST_PORTS_TO_USE = [
  TEST_PORTS.ALTERNATIVE_HTTP,
  TEST_PORTS.HEADLESS_TEST,
  TEST_PORTS.MOCK_OAUTH,
];

/**
 * Start a test server on a port
 */
async function startServer(port: number): Promise<ChildProcess> {
  console.log(`📡 Starting server on port ${port} (${getPortDescription(port)})...`);

  const server = spawn('npx', ['tsx', '-e', `
    import { createServer } from 'http';
    const server = createServer((req, res) => {
      res.writeHead(200);
      res.end('Test server on port ${port}');
    });
    server.listen(${port}, () => {
      console.log('Server running on ${port}');
    });

    // Keep server alive
    setInterval(() => {}, 1000);
  `], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env
    }
  });

  // Register with signal handler for automatic cleanup
  registerProcess(server);

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 1500));

  return server;
}

/**
 * Check status of all test ports
 */
async function checkAllPorts(): Promise<void> {
  console.log('\n📊 Port Status:');
  console.log('   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (const port of TEST_PORTS_TO_USE) {
    const available = await isPortAvailable(port);
    const status = available ? '✅ Available' : '⚠️  IN USE';
    console.log(`   Port ${port}: ${status} - ${getPortDescription(port)}`);
  }
  console.log('   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

/**
 * Main demo function
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                   ║');
  console.log('║   Signal Handling Demonstration                                   ║');
  console.log('║                                                                   ║');
  console.log('║   Press CTRL-C at any time to see automatic cleanup              ║');
  console.log('║                                                                   ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Check initial port status
  console.log('📋 Step 1: Initial Port Status');
  await checkAllPorts();

  // Step 2: Register cleanup callback
  console.log('\n\n🔧 Step 2: Registering Cleanup Callback');
  console.log('   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  registerCleanup(async () => {
    console.log('   🧹 Custom cleanup callback running...');
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log('   ✅ Custom cleanup complete');
  });

  console.log('   ✅ Cleanup callback registered');

  // Step 3: Start servers
  console.log('\n\n🚀 Step 3: Starting Test Servers');
  console.log('   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const servers: ChildProcess[] = [];

  for (const port of TEST_PORTS_TO_USE) {
    const server = await startServer(port);
    servers.push(server);
  }

  console.log(`\n   ✅ Started ${servers.length} test servers`);

  // Step 4: Show signal handler state
  console.log('\n\n📊 Step 4: Signal Handler State');
  console.log('   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const state = getSignalHandlerState();
  console.log(`   Tracked processes:  ${state.processCount}`);
  console.log(`   Cleanup callbacks:  ${state.callbackCount}`);
  console.log(`   Handlers installed: ${state.handlersInstalled}`);
  console.log(`   Shutting down:      ${state.isShuttingDown}`);

  // Step 5: Check ports are in use
  console.log('\n\n📡 Step 5: Verify Ports Are In Use');
  await checkAllPorts();

  // Step 6: Wait for CTRL-C
  console.log('\n\n⏳ Step 6: Waiting for CTRL-C...');
  console.log('   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('   ⚡ Press CTRL-C to trigger automatic cleanup');
  console.log('   📝 Watch what happens:');
  console.log('      1. SIGINT signal is received');
  console.log('      2. Cleanup callback runs');
  console.log('      3. Child processes receive SIGTERM');
  console.log('      4. Ports are automatically freed');
  console.log('      5. Process exits gracefully');
  console.log('   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Keep the script alive
  await new Promise(() => {});
}

// Run the demo
try {
  await main();
} catch (error) {
  console.error('❌ Demo failed:', error);
  process.exit(1);
}
