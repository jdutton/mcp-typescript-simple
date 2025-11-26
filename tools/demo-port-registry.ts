#!/usr/bin/env npx tsx
/**
 * Port Registry Self-Healing Demonstration
 *
 * This demo shows how the centralized port registry helps track and clean up leaked ports.
 *
 * Demonstrates:
 * 1. Port registry tracking all test ports
 * 2. Intentional port leaking (simulating interrupted tests)
 * 3. Self-healing cleanup with detailed reporting
 * 4. Port status monitoring
 */

import { spawn, ChildProcess } from 'node:child_process';
import {
  getAllTestPorts,
  getHeadlessPorts,
  getEnvironmentPorts,
  TEST_PORTS,
  getPortDescription,
  isRegisteredPort
} from '../test/helpers/port-registry.js';
import {
  isPortAvailable,
  cleanupLeakedTestPorts,
  getProcessUsingPort,
  type PortCleanupResult
} from '../test/helpers/port-utils.js';

/**
 * Start a fake server on a port (to simulate leaked test process)
 */
async function leakPort(port: number): Promise<ChildProcess> {
  console.log(`   📍 Leaking port ${port} (${getPortDescription(port)})...`);

  const server = spawn('npx', ['tsx', '-e', `
    import { createServer } from 'http';
    const server = createServer((req, res) => {
      res.writeHead(200);
      res.end('Leaked test server');
    });
    server.listen(${port}, () => {
      console.log('Leaked server running on ${port}');
    });
  `], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: {
      ...process.env
    }
  });

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 1000));

  return server;
}

/**
 * Check port status and display details
 */
async function checkPortStatus(port: number): Promise<void> {
  const available = await isPortAvailable(port);
  const registered = isRegisteredPort(port);

  if (available) {
    console.log(`   ✅ Port ${port}: Available (${registered ? 'Tracked' : 'Untracked'})`);
  } else {
    const processInfo = await getProcessUsingPort(port);
    if (processInfo) {
      console.log(`   ⚠️  Port ${port}: IN USE by ${processInfo.command} (PID ${processInfo.pid}) - ${registered ? 'Tracked' : 'Untracked'}`);
    } else {
      console.log(`   ⚠️  Port ${port}: IN USE (process unknown) - ${registered ? 'Tracked' : 'Untracked'}`);
    }
  }
}

/**
 * Display cleanup results summary
 */
function displayCleanupSummary(results: PortCleanupResult[]): void {
  console.log('\n📊 Cleanup Summary:');
  console.log('   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const cleaned = results.filter(r => r.wasInUse && r.success);
  const alreadyFree = results.filter(r => !r.wasInUse);
  const failed = results.filter(r => r.wasInUse && !r.success);

  console.log(`   ✅ Ports cleaned:     ${cleaned.length}`);
  console.log(`   ℹ️  Already free:      ${alreadyFree.length}`);
  console.log(`   ❌ Cleanup failed:    ${failed.length}`);
  console.log('   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (cleaned.length > 0) {
    console.log('\n   Cleaned ports:');
    for (const result of cleaned) {
      console.log(`   • Port ${result.port}: ${getPortDescription(result.port)}`);
      if (result.processKilled) {
        console.log(`     └─ Killed: ${result.processKilled.command} (PID ${result.processKilled.pid})`);
      }
    }
  }

  if (failed.length > 0) {
    console.log('\n   Failed cleanups:');
    for (const result of failed) {
      console.log(`   • Port ${result.port}: ${result.error}`);
    }
  }
}

/**
 * Main demo function
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                   ║');
  console.log('║   Port Registry Self-Healing Demonstration                        ║');
  console.log('║                                                                   ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Show port registry inventory
  console.log('📋 Step 1: Port Registry Inventory');
  console.log('   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const allPorts = getAllTestPorts();
  console.log(`   Total tracked ports: ${allPorts.length}`);
  console.log(`   Ports: ${allPorts.join(', ')}\n`);

  console.log('   Port categories:');
  console.log(`   • Express tests:  ${getEnvironmentPorts('express').join(', ')}`);
  console.log(`   • Express CI:     ${getEnvironmentPorts('express:ci').join(', ')}`);
  console.log(`   • STDIO tests:    ${getEnvironmentPorts('stdio').join(', ')}`);
  console.log(`   • Headless tests: ${getHeadlessPorts().join(', ')}\n`);

  console.log('   Port descriptions:');
  for (const port of allPorts) {
    console.log(`   • ${port}: ${getPortDescription(port)}`);
  }

  // Step 2: Check initial port status
  console.log('\n\n📡 Step 2: Initial Port Status Check');
  console.log('   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const port of allPorts) {
    await checkPortStatus(port);
  }

  // Step 3: Intentionally leak some ports
  console.log('\n\n🔥 Step 3: Simulating Leaked Test Ports');
  console.log('   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('   (This simulates what happens when tests are interrupted with CTRL-C)\n');

  const portsToLeak = [
    TEST_PORTS.ALTERNATIVE_HTTP,  // 3001
    TEST_PORTS.HEADLESS_TEST,     // 3555
    TEST_PORTS.MOCK_OAUTH,        // 4001
  ];

  const leakedServers: ChildProcess[] = [];

  for (const port of portsToLeak) {
    const server = await leakPort(port);
    leakedServers.push(server);
  }

  console.log(`\n   ✅ Successfully leaked ${portsToLeak.length} ports`);

  // Step 4: Check port status after leaking
  console.log('\n\n📡 Step 4: Port Status After Leaking');
  console.log('   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const port of allPorts) {
    await checkPortStatus(port);
  }

  // Step 5: Self-healing cleanup
  console.log('\n\n🔧 Step 5: Self-Healing Port Cleanup');
  console.log('   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('   (This is what happens automatically in beforeAll hooks)\n');

  console.log('   Running cleanup on ALL registered ports...\n');

  const results = await cleanupLeakedTestPorts(allPorts, { waitMs: 3000 });

  displayCleanupSummary(results);

  // Step 6: Final port status verification
  console.log('\n\n📡 Step 6: Final Port Status Verification');
  console.log('   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  for (const port of allPorts) {
    await checkPortStatus(port);
  }

  // Cleanup any remaining servers
  for (const server of leakedServers) {
    if (!server.killed) {
      server.kill('SIGKILL');
    }
  }

  // Final summary
  console.log('\n\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                                                                   ║');
  console.log('║   ✅ Port Registry Demonstration Complete                         ║');
  console.log('║                                                                   ║');
  console.log('║   Key Benefits Demonstrated:                                      ║');
  console.log('║   • Single source of truth for all test ports                     ║');
  console.log('║   • Automatic port enumeration per test environment               ║');
  console.log('║   • Self-healing cleanup with detailed reporting                  ║');
  console.log('║   • Port tracking and validation                                  ║');
  console.log('║                                                                   ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');
}

// Run the demo
main().catch((error) => {
  console.error('❌ Demo failed:', error);
  process.exit(1);
});
