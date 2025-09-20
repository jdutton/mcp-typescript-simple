#!/usr/bin/env node

/**
 * Example script demonstrating dual-mode MCP server usage
 */

import { spawn } from 'child_process';

console.log('🧪 Testing Dual-Mode MCP Server');
console.log('================================\n');

async function testStdioMode() {
  console.log('📝 Testing STDIO Mode (Default)');
  console.log('---------------------------------');

  return new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'src/index.ts'], {
      stdio: 'pipe',
      env: { ...process.env, MCP_MODE: 'stdio' }
    });

    let output = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('STDIO test timeout'));
    }, 10000);

    child.stderr.on('data', (data) => {
      output += data.toString();

      // Look for success indicators
      if (output.includes('running on stdio') && output.includes('LLM providers available')) {
        clearTimeout(timeout);
        child.kill();
        console.log('✅ STDIO mode working correctly');
        console.log('   - Server started successfully');
        console.log('   - Transport initialized');
        console.log('   - LLM providers detected\n');
        resolve();
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function testSSEMode() {
  console.log('🌐 Testing SSE Mode (with dev auth bypass)');
  console.log('-------------------------------------------');

  return new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'src/index.ts'], {
      stdio: 'pipe',
      env: {
        ...process.env,
        MCP_MODE: 'sse',
        MCP_DEV_SKIP_AUTH: 'true',
        HTTP_PORT: '3001' // Use different port to avoid conflicts
      }
    });

    let output = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('SSE test timeout'));
    }, 15000);

    child.stderr.on('data', (data) => {
      output += data.toString();

      // Look for success indicators
      if (output.includes('HTTP server listening') &&
          output.includes('SSE endpoint:') &&
          output.includes('without authentication')) {
        clearTimeout(timeout);
        child.kill();
        console.log('✅ SSE mode working correctly');
        console.log('   - HTTP server started on port 3001');
        console.log('   - SSE endpoints configured');
        console.log('   - Authentication bypassed for development');
        console.log('   - Transport layer initialized\n');
        resolve();
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function testOAuthMode() {
  console.log('🔐 Testing SSE Mode (with OAuth requirement)');
  console.log('----------------------------------------------');

  return new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'src/index.ts'], {
      stdio: 'pipe',
      env: {
        ...process.env,
        MCP_MODE: 'sse',
        MCP_DEV_SKIP_AUTH: 'false',
        HTTP_PORT: '3002',
        GOOGLE_CLIENT_ID: 'test-client-id',
        GOOGLE_CLIENT_SECRET: 'test-client-secret'
      }
    });

    let output = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('OAuth test timeout'));
    }, 15000);

    child.stderr.on('data', (data) => {
      output += data.toString();

      // Look for success indicators
      if (output.includes('HTTP server listening') &&
          output.includes('with OAuth authentication')) {
        clearTimeout(timeout);
        child.kill();
        console.log('✅ OAuth mode configuration working');
        console.log('   - HTTP server started on port 3002');
        console.log('   - OAuth authentication enabled');
        console.log('   - Google OAuth provider configured\n');
        resolve();
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function main() {
  try {
    await testStdioMode();
    await testSSEMode();
    await testOAuthMode();

    console.log('🎉 All dual-mode tests passed!');
    console.log('===============================');
    console.log('✅ STDIO mode: Ready for development');
    console.log('✅ SSE dev mode: Ready for web clients');
    console.log('✅ SSE OAuth mode: Ready for production');
    console.log('');
    console.log('🚀 Next steps:');
    console.log('   1. Set up Google OAuth credentials for production');
    console.log('   2. Configure HTTPS for production deployment');
    console.log('   3. Test with Claude Code integration');
    console.log('   4. Deploy to your preferred platform');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);