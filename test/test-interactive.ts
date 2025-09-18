#!/usr/bin/env npx tsx

import { spawn } from 'child_process';

async function testInteractiveClient(): Promise<void> {
  console.log('🧪 Testing Interactive MCP Client\n');

  const client = spawn('npx', ['tsx', 'test/interactive-client.ts'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let output = '';

  client.stdout.on('data', (data) => {
    output += data.toString();
    console.log(data.toString());
  });

  client.stderr.on('data', (data) => {
    console.error('STDERR:', data.toString());
  });

  // Give the client time to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('📋 Sending test commands...\n');

  // Send test commands
  const commands = [
    'list',
    'hello World',
    'echo This is a test message',
    'current-time',
    'describe hello',
    'quit'
  ];

  for (const command of commands) {
    console.log(`> ${command}`);
    client.stdin.write(command + '\n');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Wait for completion
  await new Promise(resolve => setTimeout(resolve, 2000));

  client.kill();
  console.log('\n✅ Interactive client test completed!');
}

testInteractiveClient().catch(console.error);