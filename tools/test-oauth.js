#!/usr/bin/env node

/**
 * OAuth connectivity test script
 *
 * Usage:
 *   node test-oauth.js                    # Test server health
 *   node test-oauth.js --flow             # Test OAuth flow interactively
 *   node test-oauth.js --token <token>    # Test with existing token
 */

import { spawn } from 'child_process';
import fetch from 'node-fetch';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const PORT = process.env.HTTP_PORT || 3000;

async function testServerHealth() {
  console.log('🔍 Testing server health...');

  try {
    const response = await fetch(`${SERVER_URL}/health`);
    const data = await response.json();

    console.log('✅ Server health check passed');
    console.log('📊 Server info:', JSON.stringify(data, null, 2));

    if (data.auth === 'enabled') {
      console.log(`🔐 OAuth provider: ${data.oauth_provider || 'configured'}`);
      return data;
    } else {
      console.log('⚠️  OAuth authentication is disabled');
      return data;
    }
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    console.log('💡 Make sure the server is running with: npm start');
    throw error;
  }
}

async function testOAuthFlow() {
  console.log('🚀 Testing OAuth flow...');

  const healthData = await testServerHealth();
  const provider = process.env.OAUTH_PROVIDER || 'google';

  if (healthData.auth !== 'enabled') {
    console.log('❌ OAuth is not enabled. Set required environment variables.');
    return;
  }

  console.log(`\n🔗 OAuth Flow Test for ${provider}:`);
  console.log(`1. Open your browser to: ${SERVER_URL}/auth/${provider}`);
  console.log('2. Complete the OAuth authorization');
  console.log('3. Copy the access_token from the response');
  console.log('4. Run: node test-oauth.js --token <access_token>');
  console.log('\n💡 Tip: Check browser network tab for the token response');
}

async function testWithToken(token) {
  console.log('🔑 Testing with provided access token...');

  // Test token with MCP endpoint
  try {
    const response = await fetch(`${SERVER_URL}/mcp`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'text/event-stream'
      }
    });

    if (response.ok) {
      console.log('✅ Token is valid and accepted by MCP endpoint');
      console.log(`📡 Response status: ${response.status}`);
      console.log(`🎯 Content-Type: ${response.headers.get('content-type')}`);
    } else {
      console.log(`❌ Token rejected: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.log('Error details:', errorText);
    }
  } catch (error) {
    console.error('❌ Token test failed:', error.message);
  }

  // Check active sessions (if Streamable HTTP)
  try {
    const sessionsResponse = await fetch(`${SERVER_URL}/admin/sessions`);
    if (sessionsResponse.ok) {
      const sessions = await sessionsResponse.json();
      console.log('📋 Active sessions:', JSON.stringify(sessions, null, 2));
    }
  } catch (error) {
    console.log('ℹ️  Session endpoint not available (might be using SSE mode)');
  }
}

async function startServer() {
  console.log('🚀 Starting MCP server for testing...');

  return new Promise((resolve, reject) => {
    const server = spawn('npm', ['start'], {
      stdio: 'pipe',
      env: { ...process.env }
    });

    let output = '';
    server.stdout.on('data', (data) => {
      output += data.toString();
      process.stdout.write(data);

      // Wait for server to be ready
      if (output.includes('listening on') || output.includes('running on')) {
        setTimeout(() => resolve(server), 2000); // Give it 2 seconds to fully start
      }
    });

    server.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    server.on('error', reject);
    server.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Server exited with code ${code}`));
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      reject(new Error('Server start timeout'));
    }, 30000);
  });
}

function showUsage() {
  console.log('OAuth Connectivity Test Script');
  console.log('');
  console.log('Usage:');
  console.log('  node test-oauth.js              # Test server health');
  console.log('  node test-oauth.js --flow       # Test OAuth flow interactively');
  console.log('  node test-oauth.js --token <t>  # Test with existing token');
  console.log('  node test-oauth.js --start      # Start server and test');
  console.log('');
  console.log('Environment Variables:');
  console.log('  OAUTH_PROVIDER    - google|github|microsoft|generic');
  console.log('  SERVER_URL        - Server URL (default: http://localhost:3000)');
  console.log('  HTTP_PORT         - Server port (default: 3000)');
  console.log('');
  console.log('Example OAuth setup (Google):');
  console.log('  export OAUTH_PROVIDER=google');
  console.log('  export GOOGLE_CLIENT_ID=your_client_id');
  console.log('  export GOOGLE_CLIENT_SECRET=your_client_secret');
  console.log('  export MCP_MODE=streamable_http');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    showUsage();
    return;
  }

  try {
    if (args.includes('--start')) {
      console.log('🚀 Starting server...');
      const server = await startServer();

      // Test after server starts
      await new Promise(resolve => setTimeout(resolve, 3000));
      await testServerHealth();

      console.log('\n💡 Server is running. Press Ctrl+C to stop.');

      process.on('SIGINT', () => {
        console.log('\n🛑 Stopping server...');
        server.kill();
        process.exit(0);
      });

      return;
    }

    if (args.includes('--flow')) {
      await testOAuthFlow();
      return;
    }

    const tokenIndex = args.indexOf('--token');
    if (tokenIndex !== -1 && args[tokenIndex + 1]) {
      const token = args[tokenIndex + 1];
      await testWithToken(token);
      return;
    }

    // Default: just test health
    await testServerHealth();
    console.log('\n💡 Use --flow to test OAuth, or --token <token> to test with existing token');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

main();