#!/usr/bin/env npx tsx

import { spawn } from 'child_process';

interface MCPRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params?: unknown;
}

async function testMCPServer(): Promise<void> {
  console.log('🧪 Testing MCP TypeScript Simple Server\n');

  const tests = [
    {
      name: 'List Tools',
      request: { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    },
    {
      name: 'Hello Tool',
      request: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'hello', arguments: { name: 'Test User' } }
      }
    },
    {
      name: 'Echo Tool',
      request: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'echo', arguments: { message: 'Hello MCP!' } }
      }
    },
    {
      name: 'Current Time Tool',
      request: {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'current-time', arguments: {} }
      }
    }
  ];

  for (const test of tests) {
    console.log(`📋 Testing: ${test.name}`);

    try {
      const response = await sendRequest(test.request);

      if (response.error) {
        console.log(`❌ Error: ${response.error.message}`);
      } else {
        if (test.name === 'List Tools') {
          const tools = response.result?.tools || [];
          console.log(`✅ Found ${tools.length} tools: ${tools.map((t: { name: string }) => t.name).join(', ')}`);
        } else {
          const content = response.result?.content?.[0]?.text;
          console.log(`✅ Result: ${content}`);
        }
      }
    } catch (error) {
      console.log(`❌ Failed: ${error}`);
    }

    console.log();
  }

  console.log('🎉 Test completed!');
}

async function sendRequest(request: MCPRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'src/index.ts'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let _stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      _stderr += data.toString();
    });

    child.on('close', () => {
      try {
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          if (line.trim().startsWith('{')) {
            const response = JSON.parse(line);
            if (response.id === request.id) {
              resolve(response);
              return;
            }
          }
        }
        reject(new Error('No valid response found'));
      } catch (error) {
        reject(new Error(`Failed to parse response: ${error}`));
      }
    });

    child.on('error', reject);

    child.stdin.write(JSON.stringify(request) + '\n');
    child.stdin.end();
  });
}

testMCPServer().catch(console.error);